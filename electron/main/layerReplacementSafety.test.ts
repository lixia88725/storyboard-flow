import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { onTestFinished, expect, it } from "vitest";
import { createLayerAppHandlers } from "./layerAppRuntime";

const run = promisify(execFile);
async function fixture() {
  const folderPath = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "layer-replacement-bridge-"));
  onTestFinished(async () => { await rm(folderPath, { recursive: true, force: true }); });
  const sourceBitmapPath = ".storyboard-workbench/layers/s/source.png";
  const targetBitmapPath = ".storyboard-workbench/layers/s/target.png";
  const source = path.join(folderPath, sourceBitmapPath), target = path.join(folderPath, targetBitmapPath);
  await mkdir(path.dirname(target), { recursive: true });
  const [sourceBytes, targetBytes] = await Promise.all(["red", "blue"].map(background =>
    sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer()));
  await writeFile(source, sourceBytes); await writeFile(target, targetBytes);
  return { folderPath, sourceBitmapPath, targetBitmapPath, source, target, sourceBytes, targetBytes, handlers: createLayerAppHandlers() };
}

it("actual main layer write/copy/Merge refuse special target permissions without deleting or damaging either asset", async () => {
  const f = await fixture();
  const user = (await run("/usr/bin/id", ["-un"])).stdout.trim();
  await run("/bin/chmod", ["+a", `user:${user} deny write`, f.target]);
  const before = await stat(f.target);
  const cases = [
    () => f.handlers.writePng({ folderPath: f.folderPath, bitmapPath: f.targetBitmapPath, dataUrl: `data:image/png;base64,${f.sourceBytes.toString("base64")}` }),
    () => f.handlers.copyPng({ folderPath: f.folderPath, sourceBitmapPath: f.sourceBitmapPath, targetBitmapPath: f.targetBitmapPath }),
    () => f.handlers.mergeDown({ folderPath: f.folderPath, sourceBitmapPath: f.sourceBitmapPath, targetBitmapPath: f.targetBitmapPath, width: 2, height: 2, sourceOpacity: 1, targetOpacity: 1, sourceBlendMode: "normal", targetBlendMode: "normal" })
  ];
  for (const operation of cases) {
    await expect(operation()).rejects.toThrow(/PNG_REFUSED/);
    expect(await readFile(f.target)).toEqual(f.targetBytes);
    expect(await readFile(f.source)).toEqual(f.sourceBytes);
    const after = await stat(f.target);
    expect([after.ino, after.mode, after.uid, after.gid, after.ctimeMs]).toEqual([before.ino, before.mode, before.uid, before.gid, before.ctimeMs]);
  }
});

it("Merge Visible rejects a differently-cased cleanup alias of its target", async ({ skip }) => {
  const f = await fixture();
  const alias = path.join(path.dirname(f.target), "TARGET.PNG");
  try { if ((await stat(alias)).ino !== (await stat(f.target)).ino) return skip(); }
  catch { return skip(); } // N/A on a case-sensitive fixture filesystem.
  await expect(f.handlers.mergeVisible({ folderPath: f.folderPath, targetBitmapPath: f.targetBitmapPath, width: 2, height: 2,
    layers: [{ bitmapPath: f.sourceBitmapPath, opacity: 1, blendMode: "normal" }, { bitmapPath: f.targetBitmapPath, opacity: 1, blendMode: "normal" }],
    deleteBitmapPaths: [".storyboard-workbench/layers/s/TARGET.PNG"] })).rejects.toThrow(/target|alias/);
  expect(await readFile(f.target)).toEqual(f.targetBytes);
});

it("Merge Down rejects the same physical source/target instead of deleting the completed target", async () => {
  const f = await fixture();
  await expect(f.handlers.mergeDown({ folderPath: f.folderPath, sourceBitmapPath: f.targetBitmapPath, targetBitmapPath: f.targetBitmapPath,
    width: 2, height: 2, sourceOpacity: 1, targetOpacity: 1, sourceBlendMode: "normal", targetBlendMode: "normal" })).rejects.toThrow(/distinct|same|alias/);
  expect(await readFile(f.target)).toEqual(f.targetBytes);
});
