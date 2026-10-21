import os from "node:os";
import { createHash } from "node:crypto";
import { rm, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { onTestFinished, expect, it } from "vitest";
import { createLayerAppHandlers } from "./layerAppRuntime";
import { registerLayerIpcHandlers } from "./ipc/layerHandlers";
import { createProject } from "../../src/shared/projectOps";

const scratch = process.env.TMPDIR ?? os.tmpdir();
async function fixture() {
  const folderPath = await mkdtemp(path.join(scratch, "exclusive-red-"));
  onTestFinished(async () => { await rm(folderPath, { recursive: true, force: true }); });
  const bitmapPath = ".storyboard-workbench/layers/s/new.png";
  await mkdir(path.dirname(path.join(folderPath, bitmapPath)), { recursive: true });
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const old = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  const imagePath = path.join(folderPath, "s.tiff");
  await sharp(old).tiff({ compression: "none" }).toFile(imagePath);
  const project = createProject("exclusive-create");
  project.shots = [{ id: "s", fileName: "s.tiff", imagePath, order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 2, canvasHeight: 2 },
    layers: [{ id: "image", kind: "image", name: "Image", order: 0, visible: true, locked: false, opacity: 1, blendMode: "normal", width: 2, height: 2, bitmapPath: ".storyboard-workbench/layers/s/image.png" }] }];
  await writeFile(path.join(folderPath, project.shots[0].layers![0].bitmapPath), old);
  project.pendingBake = { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: createHash("sha256").update(await readFile(imagePath)).digest("hex") } } };
  const callbacks = new Map<string, (...args: any[]) => any>();
  registerLayerIpcHandlers({ handle: ((channel: string, callback: (...args: any[]) => any) => { callbacks.set(channel, callback); }) as any }, createLayerAppHandlers());
  const payload = { folderPath, bitmapPath, dataUrl: `data:image/png;base64,${png.toString("base64")}`, project, shotId: "s", layerId: "new", width: 2, height: 2 };
  const create = async (dataUrl = payload.dataUrl) => { const fn = callbacks.get("layers:createPng"); if (!fn) throw new Error("Explicit production layers:createPng port missing"); const result = await fn({}, { ...payload, dataUrl }); if (!result.ok) throw new Error(result.message); return result; };
  return { folderPath, bitmapPath, file: path.join(folderPath, bitmapPath), png, old, payload, create, callbacks };
}
it("exclusive port refuses existing final target, preserving byte/inode", async () => {
  const f = await fixture(); await writeFile(f.file, f.old); const before = await stat(f.file);
  await expect(Promise.resolve().then(() => f.create())).rejects.toThrow(/exist/i);
  expect(await readFile(f.file)).toEqual(f.old); expect((await stat(f.file)).ino).toBe(before.ino);
});
it("read absence followed by arrival is refused, not exists-then-write", async () => {
  const f = await fixture(); await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(f.file, f.old); const before = await stat(f.file);
  await expect(Promise.resolve().then(() => f.create())).rejects.toThrow(/exist/i);
  expect(await readFile(f.file)).toEqual(f.old); expect((await stat(f.file)).ino).toBe(before.ino);
});
it("concurrent actual creators have exactly one complete winner", async () => {
  const f = await fixture(); const other = `data:image/png;base64,${f.old.toString("base64")}`;
  const results = await Promise.allSettled([Promise.resolve().then(() => f.create()), Promise.resolve().then(() => f.create(other))]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<any>;
  expect(await readFile(f.file)).toEqual(Buffer.from(winner.value.dataUrl.split(",")[1], "base64"));
});
it("new complete transparent PNG dimensions/pixels match descriptor", async () => {
  const f = await fixture(); await f.create(); const { data, info } = await sharp(await readFile(f.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([2, 2]); expect([...data]).toEqual(Array(16).fill(0));
});
it("unknown ownership refuses before creating final target", async () => {
  const f = await fixture(); f.payload.project.pendingBake!.shots.s = { state: "unknown" };
  await expect(Promise.resolve().then(() => f.create())).rejects.toThrow(/unknown|certified/i);
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
});
it("approved finite brush replacement preserves complete bytes and ordinary permissions", async () => {
  const f = await fixture(); await writeFile(f.file, f.old); const before = await stat(f.file);
  await f.callbacks.get("layers:writePng")!({}, f.payload);
  expect(await readFile(f.file)).toEqual(f.png);
  const after = await stat(f.file);
  // The approved staging/replacement contract may change inode; the former
  // same-inode control described the unsafe in-place writer, not new safety.
  expect([after.mode, after.uid, after.gid]).toEqual([before.mode, before.uid, before.gid]);
});
