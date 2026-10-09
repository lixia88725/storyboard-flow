import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Node release helper is intentionally outside TS compile targets.
import { resolveVersion, publishRelease, manifest, advanceManifest, githubApi } from "../../scripts/repository-release.mjs";
import { createHash } from "node:crypto";

const sha = "a".repeat(40);
function fixture() {
  const calls: string[] = [];
  let release: any;
  let tag: string | null = null;
  const api = {
    listReleases: async () => release ? [release] : [],
    tagCommit: async () => tag,
    createTag: async () => { calls.push("tag"); tag = sha; },
    createRelease: async (body: any) => { calls.push("draft"); release = { ...body, id: 1, assets: [] }; return release; },
    getRelease: async () => release,
    deleteAsset: async (id: string) => { release.assets = release.assets.filter((a: any) => a.id !== id); },
    upload: async (_r: any, name: string, data: Buffer) => { calls.push(name); release.assets.push({ id: name, name, size: data.length, state: "uploaded", digest: `sha256:${createHash("sha256").update(data).digest("hex")}` }); },
    updateRelease: async (_id: number, body: any) => { calls.push("publish"); Object.assign(release, body); },
    latest: async () => release,
    updateManifest: async () => { calls.push("manifest-branch"); }
  };
  const args = { version: "0.1.31", sha, repo: "lixia88725/storyboard-flow", files: [["Storyboard-Flow-Windows-x64.zip", Buffer.from("windows")], ["Storyboard-Flow-macOS-arm64.zip", Buffer.from("mac")]] };
  return { api, args, calls, getRelease: () => release };
}

describe("complete release staging", () => {
  it("stages both packages and manifest before publication; reruns never recreate tags or mutate completed assets", async () => {
    const f = fixture();
    await publishRelease(f.api, f.args);
    expect(f.calls).toEqual(["tag", "draft", "Storyboard-Flow-Windows-x64.zip", "Storyboard-Flow-macOS-arm64.zip", "update.json", "publish", "manifest-branch"]);
    f.calls.length = 0;
    const rebuilt = { ...f.args, files: f.args.files.map(([name]) => [name, Buffer.from("repacked nondeterministic ZIP bytes")]) };
    await publishRelease(f.api, rebuilt);
    expect(f.calls).toEqual(["manifest-branch"]);
  });
  it("keeps a failed asset upload draft and can retry without deleting tags", async () => {
    const f = fixture(), upload = f.api.upload;
    f.api.upload = async (r, n, d) => { if (n === "update.json") throw new Error("network"); await upload(r, n, d); };
    await expect(publishRelease(f.api, f.args)).rejects.toThrow("network");
    expect(f.getRelease().draft).toBe(true);
    expect(f.calls).not.toContain("publish");
    f.api.upload = upload;
    await publishRelease(f.api, f.args);
    expect(f.calls.filter(c => c === "tag")).toHaveLength(1);
  });
  it("rejects missing assets and mismatched tags before publication", async () => {
    const f = fixture();
    await expect(publishRelease(f.api, { ...f.args, files: [] })).rejects.toThrow("Both package assets");
    f.api.tagCommit = async () => "b".repeat(40);
    await expect(publishRelease(f.api, f.args)).rejects.toThrow("Tag target mismatch");
    expect(f.calls).toEqual([]);
  });
  it("prevents delayed older builds from replacing a newer latest", async () => {
    const f = fixture();
    f.api.listReleases = async () => [{ tag_name: "v0.1.32", draft: false, prerelease: false }] as any;
    await expect(publishRelease(f.api, f.args)).rejects.toThrow("Stale release");
    expect(f.calls).toEqual([]);
  });
});

describe("manifest branch compare-and-advance", () => {
  function branch(oldVersion?: string) {
    let current = oldVersion ? { sha, data: manifest(oldVersion, "lixia88725/storyboard-flow") } : null;
    let pending: Buffer;
    const calls: string[] = [];
    const api = {
      readUpdates: async () => current,
      manifestTree: async (data: Buffer) => { pending = data; calls.push("tree"); return "tree"; },
      manifestCommit: async (_tree: string, parent?: string) => { calls.push(parent ?? "orphan"); return "b".repeat(40); },
      moveUpdates: async (commit: string, exists: boolean) => { calls.push(exists ? "advance" : "create"); current = { sha: commit, data: pending }; }
    };
    return { api, calls };
  }
  it("creates manifest-only history, advances against pinned parent, and is idempotent", async () => {
    const f = branch();
    const data = manifest("0.1.31", "lixia88725/storyboard-flow");
    await advanceManifest(f.api, data);
    expect(f.calls).toEqual(["tree", "orphan", "create"]);
    f.calls.length = 0;
    await advanceManifest(f.api, data);
    expect(f.calls).toEqual([]);
    const g = branch("0.1.31");
    await advanceManifest(g.api, manifest("0.1.32", "lixia88725/storyboard-flow"));
    expect(g.calls).toEqual(["tree", sha, "advance"]);
  });
  it("rejects older, conflicting equal-version, and concurrent branch movement", async () => {
    const f = branch("0.1.32");
    await expect(advanceManifest(f.api, manifest("0.1.31", "lixia88725/storyboard-flow"))).rejects.toThrow("Stale");
    const equal = JSON.parse(manifest("0.1.32", "lixia88725/storyboard-flow").toString());
    equal.notes = "changed";
    await expect(advanceManifest(f.api, Buffer.from(JSON.stringify(equal)))).rejects.toThrow("Same-version");
    const g = branch("0.1.31");
    let reads = 0;
    const original = g.api.readUpdates;
    g.api.readUpdates = async () => ++reads === 1 ? original() : { sha: "c".repeat(40), data: Buffer.from("{}") };
    await expect(advanceManifest(g.api, manifest("0.1.32", "lixia88725/storyboard-flow"))).rejects.toThrow("changed during");
    expect(g.calls).not.toContain("advance");
  });
});

describe("GitHub transport identity", () => {
  it("resolves an exact tag ref, including annotated tags, without confusing same-name branches", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.endsWith("/git/ref/tags/v0.1.31")) return new Response(JSON.stringify({ object: { type: "tag", sha: "b".repeat(40) } }));
      if (path.endsWith(`/git/tags/${"b".repeat(40)}`)) return new Response(JSON.stringify({ object: { type: "commit", sha } }));
      return new Response("{}", { status: 404 });
    });
    try {
      expect(await githubApi("lixia88725/storyboard-flow", "test-token").tagCommit("v0.1.31")).toBe(sha);
      expect(paths).toEqual(["/repos/lixia88725/storyboard-flow/git/ref/tags/v0.1.31", `/repos/lixia88725/storyboard-flow/git/tags/${"b".repeat(40)}`]);
    } finally { vi.unstubAllGlobals(); }
  });
  it("paginates releases and sends non-forcing manifest ref updates only", async () => {
    const requests: { url: string; options: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, options: any) => {
      requests.push({ url, options });
      if (new URL(url).searchParams.get("page") === "1") return new Response(JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ id }))));
      if (new URL(url).searchParams.get("page") === "2") return new Response(JSON.stringify([{ id: 100 }]));
      return new Response(JSON.stringify({}));
    });
    try {
      const api = githubApi("lixia88725/storyboard-flow", "test-token");
      expect(await api.listReleases()).toHaveLength(101);
      await api.moveUpdates(sha, true);
      expect(requests[2].url).toBe("https://api.github.com/repos/lixia88725/storyboard-flow/git/refs/heads/updates");
      expect(requests[2].options.method).toBe("PATCH");
      expect(JSON.parse(requests[2].options.body)).toEqual({ sha, force: false });
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("release version admission", () => {
  it("allocates main versions above the legacy 0.1.30 floor and rejects unsafe manual/tag input", () => {
    expect(resolveVersion({ event: "push", ref: "refs/heads/main", runNumber: "1" })).toBe("0.1.31");
    expect(resolveVersion({ event: "workflow_dispatch", ref: "refs/heads/main", input: "1.2.3" })).toBe("1.2.3");
    for (const input of ["0.1.30", "01.2.3", "1.2.3-beta", "1.2.3\n", "$(id)"]) {
      expect(() => resolveVersion({ event: "workflow_dispatch", ref: "refs/heads/main", input })).toThrow();
    }
    expect(() => resolveVersion({ event: "workflow_dispatch", ref: "refs/heads/other", input: "1.2.3" })).toThrow();
    expect(resolveVersion({ event: "push", ref: "refs/tags/v1.2.3" })).toBe("1.2.3");
  });
});
