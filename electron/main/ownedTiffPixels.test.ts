import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { writeSwbImportWorkingTiff } from "./photoshopTiffImport.js";
import { createBlankShot } from "./blankShotService.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it("Import owned working output preserves rotated color/alpha and never changes the external source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "owned-import-exact-")); dirs.push(dir);
  const sourcePath = path.join(dir, "external.png"), outputPath = path.join(dir, "owned.tiff");
  const rgba = Buffer.from([30,110,190,255, 210,40,60,255, 27,93,151,128, 50,100,150,0]);
  await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).withMetadata({ orientation: 6, density: 144 }).png().toFile(sourcePath);
  const original = await readFile(sourcePath);
  const expected = await sharp(sourcePath, { unlimited: true }).rotate().ensureAlpha().raw().toBuffer();
  await writeSwbImportWorkingTiff({ sourcePath, outputPath, usePlaceholder: false });
  expect(await sharp(outputPath).ensureAlpha().raw().toBuffer()).toEqual(expected);
  expect(await readFile(sourcePath)).toEqual(original);
});
it("Import placeholder remains exactly transparent", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "owned-placeholder-exact-")); dirs.push(dir);
  const outputPath = path.join(dir, "owned.tiff");
  await writeSwbImportWorkingTiff({ sourcePath: "unused", outputPath, usePlaceholder: true });
  expect(await sharp(outputPath).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from([0,0,0,0]));
});
it("blank Add TIFF retains the existing exact white RGB and dimensions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "owned-blank-exact-")); dirs.push(dir);
  await mkdir(dir, { recursive: true });
  const outputPath = await createBlankShot(dir, "16:9");
  const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height, info.channels]).toEqual([1920,1080,3]);
  expect(data.length).toBe(1920*1080*3);
  expect(data.every(channel => channel === 255)).toBe(true);
});
