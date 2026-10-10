import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { cleanupMergedLayerSources } from "./mergeSourceCleanup";

it("cleans only unreferenced exact merge inputs after matching disk metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "durable-merge-cleanup-"));
  try {
    const dir = ".storyboard-workbench/layers/s";
    await mkdir(path.join(root, dir), { recursive: true });
    const source = Buffer.from("captured source"), target = Buffer.from("complete target");
    const sourcePath = `${dir}/source.png`, targetPath = `${dir}/merged.png`;
    await writeFile(path.join(root, sourcePath), source);
    await writeFile(path.join(root, targetPath), target);
    const project = { id: "project", shots: [{ id: "s", layers: [{ bitmapPath: targetPath }] }] };
    const metadata = path.join(root, ".storyboard-workbench/storyboard.project.json");
    await writeFile(metadata, JSON.stringify(project));
    const run = cleanupMergedLayerSources;
    expect(run, "durable merge cleanup port missing").toBeTypeOf("function");
    const payload = { folderPath: root, project, targetBitmapPath: targetPath,
      targetDataUrl: `data:image/png;base64,${target.toString("base64")}`,
      sources: [{ bitmapPath: sourcePath, dataUrl: `data:image/png;base64,${source.toString("base64")}`,
        dev: (await lstat(path.join(root, sourcePath))).dev, ino: (await lstat(path.join(root, sourcePath))).ino }] };
    await writeFile(metadata, JSON.stringify({ ...project, shots: [{ id: "s", layers: [{ bitmapPath: sourcePath }] }] }));
    const refused = await run(payload);
    expect(refused.deleted).toEqual([]);
    expect(await readFile(path.join(root, sourcePath))).toEqual(source);
    await writeFile(metadata, JSON.stringify(project));
    const completed = await run(payload);
    expect(completed.deleted).toEqual([sourcePath]);
    await expect(readFile(path.join(root, sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(root, targetPath))).toEqual(target);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("retains durable merged metadata and the remaining source on a second unlink failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "merge-cleanup-partial-"));
  try {
    const dir = ".storyboard-workbench/layers/s";
    await mkdir(path.join(root, dir), { recursive: true });
    const targetPath = `${dir}/target.png`, sourcePaths = [`${dir}/a.png`, `${dir}/b.png`];
    const data = Buffer.from("complete captured bytes");
    for (const file of [targetPath, ...sourcePaths]) await writeFile(path.join(root, file), data);
    const project = { id: "p", shots: [{ id: "s", layers: [{ bitmapPath: targetPath }] }] };
    const metadata = path.join(root, ".storyboard-workbench/storyboard.project.json");
    const json = JSON.stringify(project);
    await writeFile(metadata, json);
    const sources = await Promise.all(sourcePaths.map(async bitmapPath => ({ bitmapPath,
      dataUrl: `data:image/png;base64,${data.toString("base64")}`,
      dev: (await lstat(path.join(root, bitmapPath))).dev, ino: (await lstat(path.join(root, bitmapPath))).ino })));
    let removals = 0;
    const result = await cleanupMergedLayerSources({ folderPath: root, project, targetBitmapPath: targetPath,
      targetDataUrl: sources[0].dataUrl, sources }, { remove: async file => {
      if (++removals === 2) throw Error("Injected unlink EIO");
      await unlink(file);
    } });
    expect(result.deleted).toEqual([sourcePaths[0]]);
    expect(result.retained).toEqual([sourcePaths[1]]);
    expect(await readFile(metadata, "utf8")).toBe(json);
    expect(await readFile(path.join(root, sourcePaths[1]))).toEqual(data);
    expect(await readFile(path.join(root, targetPath))).toEqual(data);
  } finally { await rm(root, { recursive: true, force: true }); }
});
