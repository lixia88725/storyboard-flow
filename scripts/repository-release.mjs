import { readFile, readdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const assetNames = ["Storyboard-Flow-Windows-x64.zip", "Storyboard-Flow-macOS-arm64.zip", "update.json"];
export function compareVersions(a, b) {
  const parse = v => {
    if (typeof v !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)) throw new Error("Invalid numeric version");
    return v.split(".").map(BigInt);
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function resolveVersion({ event, ref, input, runNumber }) {
  let version;
  if (event === "workflow_dispatch" && ref === "refs/heads/main") version = input;
  else if (event === "push" && ref.startsWith("refs/tags/v")) version = ref.slice(11);
  else if (event === "push" && ["refs/heads/main", "refs/heads/infra/public-repository"].includes(ref)) {
    if (!/^[1-9]\d*$/.test(runNumber ?? "")) throw new Error("Invalid run number");
    version = `0.1.${30n + BigInt(runNumber)}`;
  } else throw new Error("Unsupported release event/ref");
  if (compareVersions(version, "0.1.30") <= 0) throw new Error("Version must exceed legacy 0.1.30");
  return version;
}
export function manifest(version, repo) {
  const tag = `v${version}`, base = `https://github.com/${repo}/releases`;
  return Buffer.from(JSON.stringify({ latest: version, notes: `Storyboard Flow ${version}`, releaseUrl: `${base}/tag/${tag}`, downloads: {
    windowsPortable: `${base}/download/${tag}/${assetNames[0]}`,
    macosAppleSilicon: `${base}/download/${tag}/${assetNames[1]}`
  } }, null, 2) + "\n");
}
const digest = data => `sha256:${createHash("sha256").update(data).digest("hex")}`;

// API is the explicit remote seam; a draft is the staging boundary, never latest.
export async function publishRelease(api, { version, sha, repo, files }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Exact commit SHA required");
  if (compareVersions(version, "0.1.30") <= 0) throw new Error("Legacy version forbidden");
  if (repo !== "lixia88725/storyboard-flow") throw new Error("Unexpected repository");
  const tag = `v${version}`;
  const releases = await api.listReleases();
  let release = releases.find(r => r.tag_name === tag);
  let highest = "0.1.30";
  for (const r of releases.filter(r => !r.draft && !r.prerelease)) {
    const v = r.tag_name.replace(/^v/, "");
    if (compareVersions(v, highest) > 0) highest = v;
  }
  const buffers = new Map(files);
  buffers.set("update.json", manifest(version, repo));
  if (buffers.size !== 3 || assetNames.some(n => !buffers.get(n)?.length)) throw new Error("Both package assets required");
  const existingSha = await api.tagCommit(tag);
  if (existingSha && existingSha !== sha) throw new Error("Tag target mismatch; never replace tags");
  if (release && !existingSha) throw new Error("Release tag missing");
  if ((!release || release.draft) && compareVersions(version, highest) <= 0) throw new Error("Stale release refused");
  if (!existingSha) {
    await api.createTag(tag, sha);
    if (await api.tagCommit(tag) !== sha) throw new Error("Tag creation readback mismatch");
  }
  if (!release) release = await api.createRelease({ tag_name: tag, target_commitish: sha, name: `Storyboard Flow ${version}`, body: `Storyboard Flow ${version}`, draft: true, prerelease: false, make_latest: "false" });
  if (release.draft) {
    for (const [name, data] of buffers) {
      const old = (await api.getRelease(release.id)).assets.find(a => a.name === name);
      if (old) await api.deleteAsset(old.id);
      await api.upload(release, name, data);
    }
  }
  const verifyUploadedBytes = release.draft;
  const verify = r => {
    if (r.prerelease || r.assets.length !== 3) throw new Error("Release is not complete/stable");
    for (const [name, data] of buffers) {
      const a = r.assets.find(a => a.name === name);
      if (!a || a.state !== "uploaded" || a.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(a.digest ?? "")) throw new Error(`Asset readback mismatch: ${name}`);
      // Published packages are immutable. Repackaging can change ZIP timestamps;
      // a rerun verifies completeness/identity, not equality to a newly rebuilt ZIP.
      if ((verifyUploadedBytes || name === "update.json") && (a.size !== data.length || a.digest !== digest(data))) throw new Error(`Asset readback mismatch: ${name}`);
    }
  };
  verify(await api.getRelease(release.id));
  // Serialized by the publish job. Older reruns are read-only, never re-promote latest.
  if (release.draft) {
    await api.updateRelease(release.id, { draft: false, prerelease: false, make_latest: "true" });
    const result = await api.getRelease(release.id);
    verify(result);
    if (result.draft || (await api.latest()).id !== release.id) throw new Error("Publication readback mismatch");
  }
  if ((await api.latest()).id === release.id) await api.updateManifest(buffers.get("update.json"));
  return tag;
}

// An orphan updates branch contains only update.json, never source or credentials.
export async function advanceManifest(api, data) {
  const next = JSON.parse(data.toString("utf8"));
  const current = await api.readUpdates();
  if (current) {
    const old = JSON.parse(current.data.toString("utf8"));
    const order = compareVersions(next.latest, old.latest);
    if (order < 0) throw new Error("Stale update manifest refused");
    if (order === 0) {
      if (!data.equals(current.data)) throw new Error("Same-version manifest mismatch");
      return;
    }
  }
  const tree = await api.manifestTree(data);
  const commit = await api.manifestCommit(tree, current?.sha);
  if ((await api.readUpdates())?.sha !== current?.sha) throw new Error("Updates branch changed during publication");
  await api.moveUpdates(commit, Boolean(current));
  const result = await api.readUpdates();
  if (result?.sha !== commit || !data.equals(result.data)) throw new Error("Updates readback mismatch");
}

export function githubApi(repo, token) {
  if (repo !== "lixia88725/storyboard-flow" || !token) throw new Error("Repository/token required");
  const base = `https://api.github.com/repos/${repo}`;
  async function request(url, method = "GET", body, binary = false, allow404 = false) {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : {}) }, body: body ? (binary ? body : JSON.stringify(body)) : undefined });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  const api = {
    async readUpdates() {
      const ref = await request(`${base}/git/ref/heads/updates`, "GET", undefined, false, true);
      if (!ref) return null;
      const commit = await request(`${base}/git/commits/${ref.object.sha}`);
      const tree = await request(`${base}/git/trees/${commit.tree.sha}`);
      if (tree.truncated || tree.tree.length !== 1 || tree.tree[0].path !== "update.json" || tree.tree[0].type !== "blob") throw new Error("Updates branch must contain only update.json");
      const blob = await request(`${base}/git/blobs/${tree.tree[0].sha}`);
      return { sha: ref.object.sha, data: Buffer.from(blob.content, "base64") };
    },
    async manifestTree(data) {
      const blob = await request(`${base}/git/blobs`, "POST", { content: data.toString("base64"), encoding: "base64" });
      return (await request(`${base}/git/trees`, "POST", { tree: [{ path: "update.json", mode: "100644", type: "blob", sha: blob.sha }] })).sha;
    },
    async manifestCommit(tree, parent) {
      return (await request(`${base}/git/commits`, "POST", { message: "Update Storyboard Flow release manifest", tree, parents: parent ? [parent] : [] })).sha;
    },
    moveUpdates: (sha, exists) => exists
      ? request(`${base}/git/refs/heads/updates`, "PATCH", { sha, force: false })
      : request(`${base}/git/refs`, "POST", { ref: "refs/heads/updates", sha }),
    async updateManifest(data) { await advanceManifest(api, data); },
    async listReleases() {
      const all = [];
      for (let page = 1; ; page++) {
        const batch = await request(`${base}/releases?per_page=100&page=${page}`);
        all.push(...batch);
        if (batch.length < 100) return all;
      }
    },
    async tagCommit(tag) {
      const ref = await request(`${base}/git/ref/tags/${encodeURIComponent(tag)}`, "GET", undefined, false, true);
      if (!ref) return null;
      let object = ref.object;
      const visited = new Set();
      while (object.type === "tag") {
        if (visited.has(object.sha)) throw new Error("Cyclic annotated tag");
        visited.add(object.sha);
        object = (await request(`${base}/git/tags/${object.sha}`)).object;
      }
      if (object.type !== "commit") throw new Error("Tag must identify a commit");
      return object.sha;
    },
    createTag: (tag, sha) => request(`${base}/git/refs`, "POST", { ref: `refs/tags/${tag}`, sha }),
    createRelease: body => request(`${base}/releases`, "POST", body),
    getRelease: id => request(`${base}/releases/${id}`),
    deleteAsset: id => request(`${base}/releases/assets/${id}`, "DELETE"),
    upload: (r, name, data) => request(`${r.upload_url.split("{")[0]}?name=${encodeURIComponent(name)}`, "POST", data, true),
    updateRelease: (id, body) => request(`${base}/releases/${id}`, "PATCH", body),
    latest: () => request(`${base}/releases/latest`)
  };
  return api;
}
async function packages(dir) {
  const found = [];
  async function walk(p) {
    for (const e of await readdir(p, { withFileTypes: true })) {
      const full = `${p}/${e.name}`;
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".zip")) found.push([e.name, await readFile(full)]);
    }
  }
  await walk(dir);
  if (found.length !== 2 || new Set(found.map(([n]) => n)).size !== 2 || assetNames.slice(0, 2).some(n => !found.some(([name]) => name === n))) throw new Error("Unexpected package set");
  return found;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "resolve") {
    const version = resolveVersion({ event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, input: process.env.INPUT_VERSION, runNumber: process.env.GITHUB_RUN_NUMBER });
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  } else if (process.argv[2] === "publish") {
    await publishRelease(githubApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN), { repo: process.env.GITHUB_REPOSITORY, version: process.env.STORYBOARD_FLOW_VERSION, sha: process.env.TARGET_SHA, files: await packages(process.argv[3]) });
  } else throw new Error("Expected resolve or publish");
}
