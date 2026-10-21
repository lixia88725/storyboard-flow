import { it, expect } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createWorkspaceAssetAppHandlers } from "./workspaceAssetAppRuntime";
import { createLayerAppHandlers } from "./layerAppRuntime";
import ts from "typescript";
import { pathEntryExists, pathExists } from "./pathSafety";
import { createOwnedFile, removeOwnedFile } from "./ownedFileCreation";

it("default Copy name allocation preserves an existing dangling root image entry", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "copy-root-entry-"));
  const image = path.join(root, "source.tiff"), occupied = path.join(root, "copy-source.tiff"), missing = path.join(root, "missing.tiff");
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).tiff().toFile(image);
  await fs.symlink(missing, occupied);
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source.slice(source.indexOf("const uniquePath =")) + ";return uniquePath;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const uniquePath = new Function("path", "pathExists", "pathEntryExists", compiled)(path, pathExists, pathEntryExists);
  try {
    const result = await createWorkspaceAssetAppHandlers({ uniquePath }).copyShotAssets({ folderPath: root,
      sourceImagePath: image, fileName: "source.tiff", layerCopies: [] }) as { imagePath: string };
    expect(result.imagePath).not.toBe(occupied);
    expect((await fs.lstat(occupied)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(occupied)).toBe(missing);
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 15000);

// Preserve the independent Reviewer's failure assertions at the real handler seam.
it("Copy never publishes over an occupied root destination or cleans that unowned entry", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "copy-root-publication-"));
  const image = path.join(root, "source.tiff"), target = path.join(root, "copy-source.tiff"), missing = path.join(root, "missing.tiff");
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).tiff().toFile(image);
  await fs.symlink(missing, target);
  try {
    const copy = createWorkspaceAssetAppHandlers({ uniquePath: async (dir, name) => path.join(dir, name) });
    await expect(copy.copyShotAssets({ folderPath: root, sourceImagePath: image, fileName: "source.tiff", layerCopies: [] })).rejects.toThrow();
    expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(target)).toBe(missing);
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("workspace Copy owns the whole operation through failure cleanup and preserves a queued later edit", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "copy-whole-operation-"));
  const source = ".storyboard-workbench/layers/s/source.png", target = ".storyboard-workbench/layers/s/copy.png";
  await fs.mkdir(path.dirname(path.join(root, source)), { recursive: true });
  const [bytes, edit] = await Promise.all(["red", "blue"].map(background => sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer()));
  await fs.writeFile(path.join(root, source), bytes);
  const image = path.join(root, "image.tiff"); await sharp(bytes).tiff().toFile(image);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const copy = createWorkspaceAssetAppHandlers({ uniquePath: async (dir, name) => path.join(dir, name),
    createPreview: async (_image, _previewRoot, _readOnly, onReceipt) => {
      onReceipt({ previewPath: path.join(root, "synthetic-preview.png"), effect: "unmodified", retainedPaths: [],
        rollback: async () => {}, commit: async () => {} });
      entered(); await gate; throw new Error("synthetic preview failure");
    } });
  const copying = Promise.resolve(copy.copyShotAssets({ folderPath: root, sourceImagePath: image, fileName: "image.tiff",
    layerCopies: [{ sourceBitmapPath: source, targetBitmapPath: target }] })).catch((e: unknown) => e);
  await ready;
  let writeFinished = false;
  const writing = Promise.resolve(createLayerAppHandlers().writePng({ folderPath: root, bitmapPath: target,
    dataUrl: `data:image/png;base64,${edit.toString("base64")}` })).then(() => { writeFinished = true; });
  await Promise.race([writing, new Promise<void>(r => setTimeout(r, 1000))]);
  const overlapped = writeFinished;
  release(); const failure = await copying; await writing;
  let final: Buffer | undefined; try { final = await fs.readFile(path.join(root, target)); } catch { /* assertion below keeps absence a failure */ }
  expect.soft(overlapped).toBe(false);
  expect.soft(final).toEqual(edit);
  expect(String(failure)).toContain("synthetic preview failure");
}, 15000);

it("workspace Copy refuses an existing layer destination without overwriting or cleaning it", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "copy-existing-layer-"));
  const source = ".storyboard-workbench/layers/s/source.png", target = ".storyboard-workbench/layers/s/existing.png";
  await fs.mkdir(path.dirname(path.join(root, source)), { recursive: true });
  const [bytes, original] = await Promise.all(["red", "blue"].map(background => sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer()));
  await fs.writeFile(path.join(root, source), bytes);
  await fs.writeFile(path.join(root, target), original);
  const before = await fs.stat(path.join(root, target));
  const image = path.join(root, "image.tiff"); await sharp(bytes).tiff().toFile(image);
  const copy = createWorkspaceAssetAppHandlers({ uniquePath: async (dir, name) => path.join(dir, name),
    createPreview: async () => { throw new Error("synthetic preview failure"); } });
  await expect(copy.copyShotAssets({ folderPath: root, sourceImagePath: image, fileName: "image.tiff",
    layerCopies: [{ sourceBitmapPath: source, targetBitmapPath: target }] })).rejects.toThrow();
  let final: Buffer | undefined; try { final = await fs.readFile(path.join(root, target)); } catch { /* absence must fail */ }
  expect(final).toEqual(original);
  const after = await fs.stat(path.join(root, target));
  expect({ ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid }).toEqual({ ino: before.ino, mode: before.mode, uid: before.uid, gid: before.gid });
}, 15000);

it("workspace Copy reports committed assets when cleanup itself fails", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "copy-cleanup-failure-"));
  const source = ".storyboard-workbench/layers/s/source.png", target = ".storyboard-workbench/layers/s/copy.png";
  await fs.mkdir(path.dirname(path.join(root, source)), { recursive: true });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  await fs.writeFile(path.join(root, source), bytes);
  const image = path.join(root, "image.tiff"); await sharp(bytes).tiff().toFile(image);
  let refusedCleanup = false;
  const copy = createWorkspaceAssetAppHandlers({ uniquePath: async (dir, name) => path.join(dir, name),
    createPreview: async (_image, _previewRoot, _readOnly, onReceipt) => {
      onReceipt({ previewPath: path.join(root, "synthetic-preview.png"), effect: "unmodified", retainedPaths: [],
        rollback: async () => {}, commit: async () => {} });
      throw new Error("synthetic preview failure");
    },
    unlink: async (filePath: string) => {
      if (filePath === path.join(root, target)) {
        refusedCleanup = true;
        const error = new Error("synthetic unlink EPERM") as NodeJS.ErrnoException; error.code = "EPERM"; throw error;
      }
      await fs.rm(filePath, { force: true });
    } });
  const failure = await Promise.resolve(copy.copyShotAssets({ folderPath: root, sourceImagePath: image, fileName: "image.tiff",
    layerCopies: [{ sourceBitmapPath: source, targetBitmapPath: target }] })).catch((error: unknown) => error);
  expect(String(failure)).toContain("[PNG_COMMITTED]");
  expect(String(failure)).toContain("cleanup incomplete");
  expect(refusedCleanup).toBe(true);
  expect(await fs.readFile(path.join(root, target))).toEqual(bytes);
}, 15000);

it("Copy compensates a receipted partial preview before removing its owned root image", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "copy-partial-preview-"));
  const image = path.join(root, "source.tiff"), partial = path.join(root, "partial-preview.png");
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).tiff().toFile(image);
  const failure = new Error("synthetic preview short write");
  try {
    const copy = createWorkspaceAssetAppHandlers({ uniquePath: async (dir, name) => path.join(dir, name),
      createPreview: async (_image, _previewRoot, _readOnly, onReceipt) => {
        const receipt = await createOwnedFile(partial, Buffer.from("partial PNG"));
        onReceipt({ previewPath: partial, effect: "created", retainedPaths: [partial],
          rollback: () => removeOwnedFile(receipt), commit: async () => {} });
        throw failure;
      } });
    await expect(copy.copyShotAssets({ folderPath: root, sourceImagePath: image, fileName: "source.tiff", layerCopies: [] })).rejects.toBe(failure);
    expect(await pathEntryExists(partial)).toBe(false);
    expect(await pathEntryExists(path.join(root, "copy-source.tiff"))).toBe(false);
    expect(await pathEntryExists(image)).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
