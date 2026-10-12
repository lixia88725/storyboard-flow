import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { applyFileReplacements, replaceFileWithTemp, FileReplacementRecoveryIncompleteError, applyFileMoves } from "./fileRenames.js";
import { recoverFailedSave } from "./saveRecovery.js";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
import { recoverFailedImport } from "./importRecovery.js";
import { moveShotsToVisiblePending } from "./pendingShotFilesService.js";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";
import sharp from "sharp";
import { bitmapLayersForShot } from "./bitmapLayerOrdering.js";
import { flattenBitmapLayerBuffersToTiff } from "./bitmapLayers.js";
import { pixelFingerprint } from "./imageFingerprintService.js";
import { resolveLayerAssetPath, sharpBlendMode } from "./layerAssetService.js";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport.js";
import * as preparation from "./tiffPreparation.js";
import { removeOwnedFile } from "./ownedFileCreation.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
// Execute the protected orchestration itself, without starting Electron. Synthetic
// writers exercise real filesystem recovery, not TIFF encoding or pixel fidelity.
const loadTiffWriter = async (bindings: Record<string, unknown>, helperNames: string[] = []) => {
  bindings = { ...preparation, removeOwnedFile, ...bindings };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const helpers = tree.statements.filter((statement) => ts.isVariableStatement(statement) && helperNames.includes(statement.declarationList.declarations[0].name.getText(tree))).map((statement) => statement.getText(tree)).join("\n");
  const block = source.slice(source.indexOf("const writeSwbMetadataToTiffs ="), source.indexOf("const createProjectPreviewsForShots =")) + helpers;
  const compiled = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return writeSwbMetadataToTiffs;`)(...Object.values(bindings));
};
const fixture = async (layered = false, failWriter = false, rename = fs.rename) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tiff-prepare-"));
  directories.push(root);
  const shots = ["single", layered ? "layered" : "second"].map((id) => ({ id, imagePath: path.join(root, `${id}.tiff`), fileName: `${id}.tiff` }));
  for (const shot of shots) await fs.writeFile(shot.imagePath, `old-${shot.id}`);
  const project = { id: "project", shots };
  const outputs: string[] = [];
  const write = async (output: string, id: string) => {
    outputs.push(output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `new-${id}`);
    if (failWriter && id !== "single") throw new Error("later writer failed");
  };
  let current = "";
  const writer = await loadTiffWriter({
    path, randomUUID, mkdir: fs.mkdir, rm: fs.rm, unlink: fs.unlink, rename,
    ensureDirectory: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); },
    applyFileReplacements, replaceFileWithTemp, withSuccessfulSaveArtifactCleanup,
    ensureProjectLayerAssets: async () => undefined,
    shouldWritePhotoshopLayeredTiffOnSave: (shot: { id: string }) => shot.id === "layered",
    shouldWriteSwbMetadata: () => true,
    bakeShotToWorkingTiff: async () => undefined,
    sharpSourceOptions: {},
    sharp: (input: string) => { current = path.basename(input, ".tiff"); return {
      metadata: async () => ({ width: 1, height: 1 }),
      withXmp: () => ({ tiff: () => ({ toFile: (output: string) => write(output, current) }) })
    }; },
    pixelFingerprint: async () => "fingerprint",
    swbMetadataForShot: () => ({}), swbMetadataXmp: () => "xmp",
    bitmapLayersForShot: () => [{ width: 1, height: 1 }],
    archiveStamp: () => "fixed-stamp",
    app: { getAppPath: () => root }, process,
    resolvePhotoshopTiffPythonDepsDir: () => root,
    writePhotoshopLayeredTiffsForInPlaceSave: async (p: typeof project, folder: string, options: { saveStamp: string; onJobWritten?: () => void }) => {
      const tempFolderPath = path.join(folder, ".storyboard-workbench", "save-tmp", options.saveStamp);
      const replacements = [];
      for (const shot of p.shots) {
        const fromPath = path.join(tempFolderPath, shot.fileName);
        await write(fromPath, shot.id);
        replacements.push({ fromPath, toPath: shot.imagePath });
        options.onJobWritten?.();
      }
      return { tempFolderPath, replacements };
    }
  });
  const originals = async () => {
    for (const shot of shots) expect(await fs.readFile(shot.imagePath, "utf8")).toBe(`old-${shot.id}`);
  };
  return { root, shots, project, writer, outputs, originals };
};
it.each([false, true])("later generation failure leaves every root unchanged; mixed=%s", async (mixed) => {
  const f = await fixture(mixed, true);
  await expect(f.writer(f.project, f.root)).rejects.toThrow("later writer failed");
  await f.originals();
});
it.each([false, true])("all layer counts return a reversible handle and keep prepared bytes after rollback; mixed=%s", async (mixed) => {
  const f = await fixture(mixed);
  const progress = vi.fn();
  const handle = await f.writer(f.project, f.root, progress);
  expect(handle).toBeDefined();
  expect(progress).toHaveBeenCalledTimes(2);
  for (const shot of f.shots) expect(await fs.readFile(shot.imagePath, "utf8")).toBe(`new-${shot.id}`);
  const operationDirs = new Set(f.outputs.map((file) => path.dirname(file).endsWith(`${path.sep}.ordinary`) ? path.dirname(path.dirname(file)) : path.dirname(file)));
  expect(operationDirs.size).toBe(1);
  expect([...operationDirs][0]).toContain(path.join(f.root, ".storyboard-workbench", "save-tmp"));
  await handle.rollback();
  await handle.rollback();
  await f.originals();
  for (const file of f.outputs) expect(await fs.readFile(file, "utf8")).toMatch(/^new-/);
});
it.each([1, 2, 3, 4])("mixed installation move %i failure restores all roots", async (failCall) => {
  let calls = 0;
  const failure = new Error("install failed");
  const f = await fixture(true, false, async (from, to) => {
    if (++calls === failCall) throw failure;
    await fs.rename(from, to);
  });
  await expect(f.writer(f.project, f.root)).rejects.toBe(failure);
  await f.originals();
});
it("no-handle incomplete installation restoration gates both Save and Import dependents", async () => {
  let calls = 0;
  const f = await fixture(true, false, async (from, to) => {
    if (++calls === 4 || calls === 5) throw new Error(`move ${calls} failed`);
    await fs.rename(from, to);
  });
  let error: unknown;
  try { await f.writer(f.project, f.root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError);
  const dependent = { rollback: vi.fn() };
  await expect(recoverFailedSave(error, { swbImport: dependent })).rejects.toMatchObject({ recoveryIncomplete: true });
  await expect(recoverFailedImport(error, [dependent])).rejects.toMatchObject({ recoveryIncomplete: true });
  expect(dependent.rollback).not.toHaveBeenCalled();
});
it("dirty selection excludes unselected and parked roots and preserves progress", async () => {
  const f = await fixture(true);
  const progress = vi.fn();
  const parked = { id: "parked", imagePath: path.join(f.root, "parked.tiff"), fileName: "parked.tiff" };
  await fs.writeFile(parked.imagePath, "parked-old");
  const handle = await f.writer({ ...f.project, parkedShots: [parked] }, f.root, progress, { shotIds: new Set(["single", "parked"]) });
  expect(progress).toHaveBeenCalledOnce();
  expect(await fs.readFile(f.shots[1].imagePath, "utf8")).toBe("old-layered");
  expect(await fs.readFile(parked.imagePath, "utf8")).toBe("parked-old");
  await handle.commit();
  expect(await fs.readdir(path.join(f.root, ".storyboard-workbench", "save-tmp"))).toEqual([]);
});
it.each([false, true])("Pending finalization failure restores materialized TIFFs after reversing moves; mixed=%s", async (mixed) => {
  const f = await fixture(mixed);
  const failure = new Error("Pending persistence failed");
  await expect(moveShotsToVisiblePending(f.root, f.project, f.shots.map((shot) => shot.id), {
    uniquePath: async (dir, name) => path.join(dir, name),
    fingerprint: async () => "new-fingerprint",
    materializeShots: async (project, shotIds) => f.writer(project, f.root, undefined, { shotIds }),
    moveFiles: (moves) => applyFileMoves(moves, { mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }); }, rename: fs.rename }),
    finalize: async () => { throw failure; }
  })).rejects.toBe(failure);
  await f.originals();
  expect(await fs.readdir(path.join(f.root, "Pending"))).toEqual([]);
});
it.each([false, true])("actual Save persistence uncertainty retains installed TIFFs and original backups; mixed=%s", async (mixed) => {
  const f = await fixture(mixed);
  const failure = new Error("Save persistence failed");
  const order: string[] = [];
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const saveWorkspace ="), source.indexOf("const assertRenamePlanSafe ="));
  const compiled = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const bindings = {
    withLayerFileOperation,
    stagePendingDeletedShotFiles: async () => ({ project: f.project }),
    importProjectToSwbFormat: async () => ({ project: f.project, tiffWriteShotIds: [], rollback: async () => { order.push("import"); await f.originals(); } }),
    saveProgressShotIds: () => undefined, countSaveProgressShots: () => 2,
    writeSwbMetadataToTiffs: async (...args: unknown[]) => {
      const handle = await f.writer(...args);
      return { commit: handle.commit, rollback: async () => { order.push("tiff"); await handle.rollback(); } };
    },
    clearSavedImageLayerEdits: (project: unknown) => project,
    syncSavedSwbBaseFingerprints: async (project: unknown) => project,
    writeProjectFiles: async () => { throw failure; }, recoverFailedSave
  };
  const save = new Function(...Object.keys(bindings), `${compiled}; return saveWorkspace;`)(...Object.values(bindings));
  await expect(save({ project: f.project, folderPath: f.root, metadataPath: "synthetic-json" })).rejects.toMatchObject({ recoveryIncomplete: true, errors: expect.arrayContaining([failure]) });
  expect(order).toEqual([]);
  const operations = await fs.readdir(path.join(f.root, ".storyboard-workbench/save-tmp"));
  expect(operations).toHaveLength(1);
  for (const [index, shot] of f.project.shots.entries()) {
    expect(await fs.readFile(shot.imagePath, "utf8")).toBe(`new-${shot.id}`);
    expect(await fs.readFile(path.join(f.root, ".storyboard-workbench/save-tmp", operations[0], ".backups", `${index}.tiff`), "utf8")).toBe(`old-${shot.id}`);
  }
});
it("repeated operations use distinct directories even with the same clock stamp", async () => {
  const f = await fixture(true);
  const first = await f.writer(f.project, f.root);
  await first.rollback();
  const second = await f.writer(f.project, f.root);
  expect(path.dirname(f.outputs[0])).not.toBe(path.dirname(f.outputs[2]));
  await second.rollback();
});
it.each([
  ["rollback", "layered.tiff"], ["commit", "layered.tiff"], ["generation-failure", "layered.tiff"],
  ["rollback", "single-metadata.tiff"], ["commit", "single-metadata.tiff"],
  ["rollback", "single-bake.tiff"], ["commit", "single-bake.tiff"],
  ["rollback", ".ordinary.tiff"], ["commit", ".ordinary.tiff"]
])("real sharp/Python mixed TIFF batch: %s, layered filename=%s", async (outcome, layeredFileName) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tiff-real-mixed-"));
  directories.push(root);
  const shots = [];
  const oldBytes: Buffer[] = [];
  for (const [index, id] of ["single", "layered"].entries()) {
    const fileName = id === "single" ? "single.tiff" : layeredFileName;
    const imagePath = path.join(root, fileName);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: id === "single" ? "white" : "black" } }).tiff().toFile(imagePath);
    oldBytes.push(await fs.readFile(imagePath));
    const layers = [];
    for (let layerIndex = 0; layerIndex <= index; layerIndex++) {
      const bitmapPath = `.storyboard-workbench/layers/${id}/${layerIndex}.png`;
      const asset = path.join(root, bitmapPath);
      await fs.mkdir(path.dirname(asset), { recursive: true });
      await sharp({ create: { width: 2, height: 2, channels: 4, background: id === "single" ? "#ff0000" : "#0000ff" } }).png().toFile(asset);
      if (outcome === "generation-failure" && id === "layered" && layerIndex === 1) await fs.unlink(asset);
      layers.push({ id: `${id}-${layerIndex}`, name: `Layer ${layerIndex}`, kind: "paint", bitmapPath, width: 2, height: 2, visible: true, locked: false, opacity: 1, blendMode: "normal", order: layerIndex });
    }
    shots.push({ id, imagePath, fileName, order: index, layers, swb: { status: "owned", canvasWidth: 2, canvasHeight: 2 } });
  }
  const writer = await loadTiffWriter({
    path, randomUUID, mkdir: fs.mkdir, rm: fs.rm, unlink: fs.unlink, rename: fs.rename, writeFile: fs.writeFile,
    ensureDirectory: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); },
    applyFileReplacements, withSuccessfulSaveArtifactCleanup,
    ensureProjectLayerAssets: async () => undefined,
    sharp, bitmapLayersForShot, flattenBitmapLayerBuffersToTiff, pixelFingerprint,
    resolveLayerAssetPath, sharpBlendMode,
    pathExists: async (file: string) => { try { await fs.stat(file); return true; } catch { return false; } },
    app: { getAppPath: () => process.cwd() }, process,
    resolvePhotoshopTiffPythonDepsDir: () => path.join(process.cwd(), "vendor/python/photoshop-tiff"),
    writePhotoshopLayeredTiffsForInPlaceSave
  }, ["sharpSourceOptions", "swbFormatVersion", "swbXmpTag", "archiveStamp", "shouldWriteSwbMetadata", "shouldWritePhotoshopLayeredTiffOnSave", "bakeShotToWorkingTiff", "bakeBitmapLayersToTiff", "bakeSketchOverlayToTiff", "sketchLayersForShot", "swbMetadataForShot", "swbMetadataXmp"]);
  const action = writer({ id: "project", name: "Synthetic", shots }, root);
  if (outcome === "generation-failure") {
    await expect(action).rejects.toThrow("Photoshop TIFF export failed");
  } else {
    const handle = await action;
    const operationRoot = path.join(root, ".storyboard-workbench", "save-tmp");
    const operations = await fs.readdir(operationRoot);
    expect(operations).toHaveLength(1);
    const operation = operations[0];
    for (const [index, original] of oldBytes.entries()) {
      expect(await fs.readFile(path.join(operationRoot, operation, ".backups", `${index}.tiff`))).toEqual(original);
    }
    const installedBytes = await Promise.all(shots.map((shot) => fs.readFile(shot.imagePath)));
    for (const shot of shots) {
      const { data, info } = await sharp(shot.imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([2, 2]);
      // Both the single-layer metadata rewrite and Python composite are lossless.
      for (let pixel = 0; pixel < data.length; pixel += 3) {
        expect([...data.subarray(pixel, pixel + 3)]).toEqual(shot.id === "single" ? [255, 0, 0] : [0, 0, 255]);
      }
      const metadata = await sharp(shot.imagePath).metadata();
      const encoded = metadata.xmp?.toString().match(/<swb:metadata>([^<]+)<\/swb:metadata>/u)?.[1];
      expect(encoded).toBeDefined();
      const swb = JSON.parse(Buffer.from(encoded!, "base64").toString());
      expect(swb).toMatchObject({ app: "Storyboard Flow", shotId: shot.id, canvasWidth: 2, canvasHeight: 2 });
      // Preserve the existing single-layer fingerprint input (pre-XMP bake).
      const fingerprintInput = shot.id === "single" ? path.join(operationRoot, operation, ".ordinary", "single-bake.tiff") : shot.imagePath;
      expect(swb.baseFingerprint).toBe(await pixelFingerprint(fingerprintInput));
      expect(swb.layers).toHaveLength(shot.layers.length);
    }
    await handle[outcome]();
    if (outcome === "commit") {
      for (const [index, shot] of shots.entries()) expect(await fs.readFile(shot.imagePath)).toEqual(installedBytes[index]);
      expect(await fs.readdir(operationRoot)).toEqual([]);
    }
  }
  if (outcome !== "commit") {
    for (const [index, shot] of shots.entries()) expect(await fs.readFile(shot.imagePath)).toEqual(oldBytes[index]);
  }
});

// Regression: execute the actual bake + metadata + replacement chain with real
// sharp and filesystem ports; no encoder mock and no pixel tolerance.
it.each(["bitmap", "metadata-only", "legacy"])("owned single TIFF %s preserves exact prepared pixels through XMP rewrite", async (mode) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tiff-exact-"));
  directories.push(root);
  const imagePath = path.join(root, "single.tiff");
  const bitmapPath = ".storyboard-workbench/layers/single/base.png";
  const asset = path.join(root, bitmapPath);
  await fs.mkdir(path.dirname(asset), { recursive: true });
  // Include spatial color variation and alpha, not only saturated primaries.
  const rgba = Buffer.from([30,110,190,255, 210,40,60,255, 27,93,151,128, 0,0,0,0]);
  await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toFile(asset);
  await sharp(asset).tiff({ compression: "none" }).toFile(imagePath);
  const original = await fs.readFile(imagePath);
  const sentinel = path.join(root, "unchanged.tiff");
  await fs.writeFile(sentinel, original);
  const layer = { id: "base", kind: "image", name: "Base", visible: true, locked: false, opacity: 1, blendMode: "normal", order: 0, bitmapPath, width: 2, height: 2 };
  const shot = { id: "single", imagePath, fileName: "single.tiff", layers: mode === "bitmap" ? [layer] : [], swb: { status: "owned", canvasWidth: 2, canvasHeight: 2 },
    ...(mode === "legacy" ? { sketchLayers: [{ id: "legacy", visible: true, opacity: 1, blendMode: "normal", strokes: [{ points: [0, 0] }] }] } : {}) };
  const writer = await loadTiffWriter({
    path, randomUUID, mkdir: fs.mkdir, rm: fs.rm, unlink: fs.unlink, rename: fs.rename, writeFile: fs.writeFile,
    ensureDirectory: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); },
    applyFileReplacements, withSuccessfulSaveArtifactCleanup,
    ensureProjectLayerAssets: async () => undefined,
    sharp, bitmapLayersForShot, flattenBitmapLayerBuffersToTiff, pixelFingerprint,
    resolveLayerAssetPath, sharpBlendMode,
    pathExists: async (file: string) => { try { await fs.stat(file); return true; } catch { return false; } },
  }, ["sharpSourceOptions", "swbFormatVersion", "swbXmpTag", "archiveStamp", "shouldWriteSwbMetadata", "shouldWritePhotoshopLayeredTiffOnSave", "bakeShotToWorkingTiff", "bakeBitmapLayersToTiff", "bakeSketchOverlayToTiff", "sketchLayersForShot", "swbMetadataForShot", "swbMetadataXmp"]);
  const handle = await writer({ id: "project", shots: [shot, { ...shot, id: "untouched", imagePath: sentinel, fileName: "unchanged.tiff" }] }, root, undefined, { shotIds: new Set(["single"]) });
  const decode = (input: string | Buffer) => sharp(input).ensureAlpha().raw().toBuffer();
  // Bitmap output uses the established white matte; metadata-only and the
  // legacy one-point (non-drawing) stroke retain the source alpha.
  const expected = mode !== "bitmap" ? await decode(original) : await decode(await sharp(asset).flatten({ background: "white" }).png().toBuffer());
  expect(await decode(imagePath)).toEqual(expected);
  const metadata = await sharp(imagePath).metadata();
  expect([metadata.width, metadata.height]).toEqual([2, 2]);
  const encoded = metadata.xmp!.toString().match(/<swb:metadata>([^<]+)<\/swb:metadata>/u)![1];
  expect(JSON.parse(Buffer.from(encoded, "base64").toString())).toMatchObject({ app: "Storyboard Flow", shotId: "single", canvasWidth: 2, canvasHeight: 2 });
  expect(await fs.readFile(sentinel)).toEqual(original);
  await handle.rollback();
  expect(await fs.readFile(imagePath)).toEqual(original);
});
