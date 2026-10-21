import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { applyFileReplacements, FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import { createOwnedFile, removeOwnedFile } from "./ownedFileCreation.js";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";
import { ProtectedLayerWriteError, writeProtectedLayerFile } from "./protectedLayerFileWriter.js";
import { recoverFailedSave } from "./saveRecovery.js";
import { recoverFailedImport } from "./importRecovery.js";
import sharp from "sharp";
import { bitmapLayersForShot } from "./bitmapLayerOrdering.js";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport.js";
import * as preparation from "./tiffPreparation.js";
import { moveShotsToVisiblePending } from "./pendingShotFilesService.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const fixture = async (overrides: Record<string, unknown> = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "preparation-effects-")); roots.push(root);
  const imagePath = path.join(root, "shot.tiff"); await fs.writeFile(imagePath, "old-root");
  const outputs: string[] = [];
  const failure = new Error("native partial staging failure");
  const write = async (output: string) => {
    outputs.push(output);
    const handle = await fs.open(output, "w");
    try { await handle.writeFile("partial-native-output"); } finally { await handle.close(); }
    throw failure;
  };
  const bindings = {
    path, randomUUID, mkdir: fs.mkdir, rm: fs.rm, unlink: fs.unlink, rename: fs.rename,
    ensureDirectory: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); },
    ensureProjectLayerAssets: async () => undefined,
    shouldWritePhotoshopLayeredTiffOnSave: () => false, shouldWriteSwbMetadata: () => true,
    bakeShotToWorkingTiff: async () => undefined, pixelFingerprint: async () => "fingerprint",
    swbMetadataForShot: () => ({}), swbMetadataXmp: () => "xmp", sharpSourceOptions: {},
    sharp: () => ({ metadata: async () => ({ width: 1, height: 1 }), withXmp: () => ({ tiff: () => ({ toFile: write }) }) }),
    archiveStamp: () => "fixed", applyFileReplacements, withSuccessfulSaveArtifactCleanup,
    removeOwnedFile, bitmapLayersForShot, writePhotoshopLayeredTiffsForInPlaceSave,
    app: { getAppPath: () => root }, process,
    resolvePhotoshopTiffPythonDepsDir: () => root,
    ...preparation, ...overrides
  };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const writeSwbMetadataToTiffs ="), source.indexOf("const createProjectPreviewsForShots ="));
  const compiled = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const writer = new Function(...Object.keys(bindings), `${compiled}; return writeSwbMetadataToTiffs;`)(...Object.values(bindings));
  const project = { id: "project", shots: [{ id: "shot", imagePath, fileName: "shot.tiff" }] };
  return { root, imagePath, project, writer, outputs, failure };
};
it("native partial staging is drained and removed before a no-handle ordinary failure", async () => {
  const f = await fixture();
  await expect(f.writer(f.project, f.root)).rejects.toBe(f.failure);
  expect(await fs.readFile(f.imagePath, "utf8")).toBe("old-root");
  expect(f.outputs).toHaveLength(1);
  await expect(fs.lstat(f.outputs[0])).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readdir(path.join(f.root, ".storyboard-workbench/save-tmp"))).toEqual([]);
});
it("ensure unknown PNG effect becomes typed incomplete and stops Save/Import dependents", async () => {
  let unknownPath = "";
  const f = await fixture({ ensureProjectLayerAssets: async (_p: unknown, root: string) => {
    unknownPath = path.join(root, "unknown.png");
    await fs.writeFile(unknownPath, "unknown-native-effect");
    throw new ProtectedLayerWriteError("unknown", unknownPath, "native response unavailable");
  } });
  let error: unknown;
  try { await f.writer(f.project, f.root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError);
  expect(error).toMatchObject({ retainedPaths: [unknownPath] });
  expect(await fs.readFile(unknownPath, "utf8")).toBe("unknown-native-effect");
  const dependent = { rollback: vi.fn() };
  await expect(recoverFailedSave(error, { swbImport: dependent })).rejects.toMatchObject({ recoveryIncomplete: true });
  await expect(recoverFailedImport(error, [dependent])).rejects.toMatchObject({ recoveryIncomplete: true });
  const move = vi.fn();
  await expect(moveShotsToVisiblePending(f.root, f.project, ["shot"], {
    uniquePath: async (dir, name) => path.join(dir, name), fingerprint: async () => "unused",
    beginTransaction: async () => dependent,
    materializeShots: async () => { throw error; }, moveFiles: move
  })).rejects.toMatchObject({ recoveryIncomplete: true });
  expect(move).not.toHaveBeenCalled();
  expect(dependent.rollback).not.toHaveBeenCalled();
});

it("ensure records actual new PNGs even when a later ensure rejects; existing and dangling entries survive", async () => {
  const failure = new Error("second layer failed"); let created = "", existing = "", dangling = "";
  const f = await fixture({ ensureProjectLayerAssets: async (_p: unknown, root: string, options: { onCreated: Parameters<typeof createOwnedFile>[2] }) => {
    existing = path.join(root, "existing.png"); dangling = path.join(root, "dangling.png"); created = path.join(root, "created.png");
    await fs.writeFile(existing, "existing-bytes"); await fs.symlink("missing.png", dangling);
    await createOwnedFile(created, Buffer.from("new-png"), options.onCreated); throw failure;
  } });
  await expect(f.writer(f.project, f.root)).rejects.toBe(failure);
  await expect(fs.lstat(created)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(existing, "utf8")).toBe("existing-bytes"); expect(await fs.readlink(dangling)).toBe("missing.png");
  expect(await fs.readFile(f.imagePath, "utf8")).toBe("old-root");
});
it("real sharp completion then beforeInstall rejection cleans only preparation and receipt PNG", async () => {
  let png = ""; const failure = new Error("admission rejected");
  const f = await fixture({ sharp, swbMetadataXmp: () => '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>',
    ensureProjectLayerAssets: async (_p: unknown, root: string, options: { onCreated: Parameters<typeof createOwnedFile>[2] }) => {
      png = path.join(root, "new.png");
      await createOwnedFile(png, await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer(), options.onCreated);
    } });
  await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).tiff().toFile(f.imagePath);
  const old = await fs.readFile(f.imagePath);
  await expect(f.writer(f.project, f.root, undefined, { beforeInstall: async () => { throw failure; } })).rejects.toBe(failure);
  expect(await fs.readFile(f.imagePath)).toEqual(old);
  await expect(fs.lstat(png)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readdir(path.join(f.root, ".storyboard-workbench/save-tmp"))).toEqual([]);
});
it("cleanup refusal exposes actual staging path and gates dependent recovery", async () => {
  const f = await fixture({ rm: async () => { throw new Error("rm denied"); } });
  let error: unknown; try { await f.writer(f.project, f.root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError);
  expect(error).toMatchObject({ retainedPaths: [path.dirname(path.dirname(f.outputs[0]))] });
  expect(await fs.readFile(f.outputs[0], "utf8")).toBe("partial-native-output");
  expect(await fs.readFile(f.imagePath, "utf8")).toBe("old-root");
});
it("changed PNG identity is retained and reported instead of using planned absence", async () => {
  let png = ""; const failure = new Error("ensure failed after replacement");
  const f = await fixture({ ensureProjectLayerAssets: async (_p: unknown, root: string, options: { onCreated: Parameters<typeof createOwnedFile>[2] }) => {
    png = path.join(root, "created.png"); await createOwnedFile(png, Buffer.from("owned"), options.onCreated);
    await fs.rename(png, path.join(root, "old-inode")); await fs.writeFile(png, "later-file"); throw failure;
  } });
  await expect(f.writer(f.project, f.root)).rejects.toMatchObject({ recoveryIncomplete: true, retainedPaths: [png] });
  expect(await fs.readFile(png, "utf8")).toBe("later-file");
});
it("exclusive namespace collision never reuses or removes someone else's staging", async () => {
  const f = await fixture({ randomUUID: () => "collision" });
  const operation = path.join(f.root, ".storyboard-workbench/save-tmp/fixed-collision"); await fs.mkdir(operation, { recursive: true });
  const sentinel = path.join(operation, "old-backup.tiff"); await fs.writeFile(sentinel, "unowned-backup");
  await expect(f.writer(f.project, f.root)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readFile(sentinel, "utf8")).toBe("unowned-backup");
});
it("failed apply recovery retains the old TIFF backup namespace without attempting rm", async () => {
  let calls = 0; const remove = vi.fn(fs.rm);
  const f = await fixture({ rm: remove,
    sharp: () => ({ metadata: async () => ({ width: 1, height: 1 }), withXmp: () => ({ tiff: () => ({ toFile: async (out: string) => { await fs.writeFile(out, "new-tiff"); } }) }) }),
    rename: async (from: string, to: string) => { if (++calls >= 2) throw new Error("install/restore failed"); await fs.rename(from, to); }
  });
  let error: unknown; try { await f.writer(f.project, f.root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError); expect(remove).not.toHaveBeenCalled();
  const [operation] = await fs.readdir(path.join(f.root, ".storyboard-workbench/save-tmp"));
  const operationPath = path.join(f.root, ".storyboard-workbench/save-tmp", operation);
  expect(await fs.readFile(path.join(operationPath, ".backups/0.tiff"), "utf8")).toBe("old-root");
  expect(error).toMatchObject({ retainedPaths: [operationPath] });
});

it("actual Python worker pool drains the later child before cleanup and releases no late writes", async () => {
  const f = await fixture({ shouldWritePhotoshopLayeredTiffOnSave: () => true });
  const script = path.join(f.root, "scripts/photoshop-layered-tiff-export.py");
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, `import json, pathlib, sys, time
m = json.loads(pathlib.Path(sys.argv[1]).read_text())
p = pathlib.Path(m['outputPath'])
if m['documentName'] == 'fail':
    p.write_bytes(b'partial-child')
    raise RuntimeError('synthetic exporter failed')
time.sleep(0.15)
p.write_bytes(b'late-child-settled')
pathlib.Path(${JSON.stringify(path.join(f.root, 'child-settled'))}).write_text('settled')
`);
  const layer = { id: "base", name: "Base", kind: "image", bitmapPath: ".storyboard-workbench/layers/shot/base.png", width: 1, height: 1, visible: true, locked: false, opacity: 1, blendMode: "normal", order: 0 };
  const shots = ["fail", "late"].map((id, order) => ({ id, order, fileName: `${id}.tiff`, imagePath: path.join(f.root, `${id}.tiff`), layers: [layer], swb: { canvasWidth: 1, canvasHeight: 1 } }));
  for (const shot of shots) await fs.writeFile(shot.imagePath, `old-${shot.id}`);
  await expect(f.writer({ id: "project", name: "Synthetic", shots }, f.root)).rejects.toThrow("Photoshop TIFF export failed");
  expect(await fs.readFile(path.join(f.root, "child-settled"), "utf8")).toBe("settled");
  expect(await fs.readdir(path.join(f.root, ".storyboard-workbench/save-tmp"))).toEqual([]);
  for (const shot of shots) expect(await fs.readFile(shot.imagePath, "utf8")).toBe(`old-${shot.id}`);
});

it("actual ensure/sharp/protected Python PNG receipt survives a later ensure failure and is compensated", async () => {
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["ensureProjectLayerAssets", "createTransparentLayerPng", "sketchLayersForShot"];
  const selected = tree.statements.filter(node => ts.isVariableStatement(node) && names.includes(node.declarationList.declarations[0].name.getText(tree)));
  const compiled = ts.transpileModule(selected.map(node => node.getText(tree)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const failure = new Error("later image layer initialization failed");
  const bindings = { sharp, writeProtectedLayerFile, shouldEnsureLayerAssetsForShot: () => true,
    resolveLayerAssetPath: (root: string, asset: string) => path.join(root, asset),
    pathExists: async (file: string) => fs.stat(file).then(() => true, () => false),
    createImageBitmapLayerPng: async () => { throw failure; }, createPaintBitmapLayerPng: async () => { throw new Error("not this fixture"); }
  };
  const ensure = new Function(...Object.keys(bindings), `${compiled}; return ensureProjectLayerAssets;`)(...Object.values(bindings));
  const f = await fixture({ ensureProjectLayerAssets: ensure });
  const png = path.join(f.root, ".storyboard-workbench/layers/shot/paint.png");
  const layers = [{ id: "paint", kind: "paint", bitmapPath: ".storyboard-workbench/layers/shot/paint.png", width: 2, height: 2 },
    { id: "image", kind: "image", bitmapPath: ".storyboard-workbench/layers/shot/image.png", width: 2, height: 2 }];
  await expect(f.writer({ ...f.project, shots: [{ ...f.project.shots[0], layers }] }, f.root)).rejects.toBe(failure);
  await expect(fs.lstat(png)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(f.imagePath, "utf8")).toBe("old-root");
});
