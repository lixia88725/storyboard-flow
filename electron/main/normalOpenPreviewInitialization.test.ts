import { isCertifiedPendingBakeEntry } from "../shared/pendingBakeRules";
import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { createWorkspaceFolderScanner } from "./workspaceScanService";
import { createWorkspaceOpenAppHandlers } from "./workspaceOpenAppRuntime";
import { registerWorkspaceOpenIpcHandlers } from "./ipc/workspaceOpenHandlers";
import { createImageRecords as createImportedImageRecords } from "./imageRecordsService";
import { shouldEnsureLayerAssetsForShot } from "./bitmapLayers";
import { exportPhotoshopLayeredTiffs, writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport";
import { createPreview } from "./previewService";
import { automaticImageImportAdmission, manualImageImportAdmission } from "../shared/manualImageImportRules";
import { pixelFingerprint } from "./imageFingerprintService";
import { registerWorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers";
import { resolveLayerAssetPath } from "./layerAssetService";
import { assertPathInsideFolder, pathExists } from "./pathSafety";
import { readProjectMetadata } from "./projectMetadataService";
import * as transaction from "./pendingFileTransactionService";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createAppOpenCallerScope } from './appOpenCallerScope.mjs';
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { createProject, mergeExternalImageChanges, mergeFolderImages } from "../../src/shared/projectOps";
import type { Project } from "../../src/shared/types";
import * as renames from "./fileRenames";
import * as importPorts from "./photoshopTiffImport";
import * as bitmap from "./bitmapLayers";
import * as safety from "./pathSafety";
import * as layer from "./layerAssetService";
import { writeProtectedLayerFile as protectedWriter } from "./protectedLayerFileWriter";
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { assertPhysicalWorkspaceWriterTargets } from "./workspacePhysicalWriterGate";
import { mapWithConcurrency } from "./mapWithConcurrency";
import * as script from "./storyboardScript";
import { createImportPathReservation } from "./importPaths";
import { prepareImportStaging } from "./importPreparation";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts";
import * as tiffPreparation from "./tiffPreparation";
import { removeOwnedFile } from "./ownedFileCreation";
import { previewPathForImage, previewRootForFolder } from "./previewPaths";
import { bitmapLayersForShot } from "./bitmapLayerOrdering";
import { randomUUID } from "node:crypto";
vi.mock("node:fs/promises", async importOriginal => {
 const actual = await importOriginal<typeof fs>();
 return { ...actual, mkdir: vi.fn(actual.mkdir), writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) };
});
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "normal-open-preview-")); dirs.push(root);
 const metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json"), previewRoot = path.join(root, ".storyboard-workbench/previews"), image = path.join(root, "a.tiff"), md = path.join(root, "storyboard-script.md");
 await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).tiff({ compression: "none" }).toFile(image);
 const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
 const names = ["scanWorkspaceFolder", "scanFolder", "ensureStoryboardScriptMarkdown", "readProject", "createImageRecords", "readSwbMetadata"];
 const selected = ast.statements.filter(n => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(ast)));
 const bindings = { withLayerFileOperation, assertPhysicalWorkspaceWriterTargets, isCertifiedPendingBakeEntry, app: { getAppPath: () => process.cwd() }, process, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR, path, sharp, sharpSourceOptions: { unlimited: true }, swbXmpTag: "swb:metadata", readFile: fs.readFile, readProjectMetadata, ...transaction,
  createWorkspaceFolderScanner, metadataPathForFolder: () => metadataPath, previewRootForFolder: () => previewRoot,
  collectImagePaths: async () => [image], createImportedImageRecords, createPreview, pixelFingerprint,
  initializeNormalOpenPreviews: async (...args: any[]) => (await import("./normalOpenPreviewService")).initializeNormalOpenPreviews(...args as Parameters<typeof import("./normalOpenPreviewService")["initializeNormalOpenPreviews"]>),
  storyboardScriptPathForFolder: () => md, storyboardScriptNeedsImport: () => false, writeStoryboardScriptMarkdown: async () => { await fs.writeFile(md, "generated"); } };
 const scanFolder = new Function(...Object.keys(bindings), ts.transpile(selected.map(n => n.getText(ast)).join("\n") + ";return scanFolder;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
 let invoke!: (...args: any[]) => Promise<any>;
 registerWorkspaceOpenIpcHandlers({ handle: (_name: string, fn: any) => { invoke = fn; } } as any, createWorkspaceOpenAppHandlers({ scanFolder, createProgressReporter: () => undefined, pathExists: async () => true, addRecentFolder: () => {}, removeRecentFolder: () => {} }));
 return { root, metadataPath, previewRoot, image, md, open: (options?: unknown) => invoke({ sender: {} }, root, options) };
}
it("actual ensure and export reuse existing assets and formal exporter under adapter queue without JSON MD persistence or owner publication", async () => {
 const f = await fixture(), p = mergeFolderImages(createProject("Supported actual export"), [{ imagePath: f.image, fileName: "a.tiff", width: 4, height: 3 }]), shot = p.shots[0]; shot.swb!.status = "owned";
 const asset = path.join(f.root, shot.layers![0].bitmapPath); await fs.mkdir(path.dirname(asset), { recursive: true }); await sharp(f.image).png().toFile(asset);
 p.pendingBake = { version: 1, shots: { [shot.id]: { state: "synced", acceptedOutputIdentity: hash(await fs.readFile(f.image)) } } };
 await fs.writeFile(f.metadataPath, JSON.stringify(p)); const protectedPaths = [f.image, asset, f.metadataPath], before = await Promise.all(protectedPaths.map(p => fs.readFile(p)));
 const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
 const declarations = ast.statements.filter(n => ts.isVariableStatement(n) && ["assertNormalSaveAdmission", "ensureProjectLayerAssets"].includes(n.declarationList.declarations[0].name.getText(ast))).map(n => n.getText(ast));
 const callbacks = new Map<string, any>(), persist = vi.fn(); let result: { exportedFiles: string[] } | undefined;
 const bindings = { withLayerFileOperation, assertPhysicalWorkspaceWriterTargets, isCertifiedPendingBakeEntry, app: { getAppPath: () => process.cwd() }, process, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR, path, createHash, readFile: fs.readFile, mkdir: fs.mkdir, pathExists, resolveLayerAssetPath, assertPathInsideFolder, shouldEnsureLayerAssetsForShot, hasPendingFileTransaction: transaction.hasPendingFileTransaction, exportPhotoshopLayeredTiffs: async (...args: Parameters<typeof exportPhotoshopLayeredTiffs>) => (result = await exportPhotoshopLayeredTiffs(...args)), writeProjectFiles: persist, registerWorkspacePersistenceIpcHandlers, ipcMain: { handle: (name: string, fn: any) => { callbacks.set(name, fn); } } };
 const calls: string[] = []; const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && (n.expression.getText(ast) === "registerWorkspacePersistenceIpcHandlers" || n.expression.getText(ast) === "ipcMain.handle" && n.arguments[0]?.getText(ast) === JSON.stringify("workspace:exportPhotoshopTiffs"))) calls.push(n.getText(ast)); ts.forEachChild(n, walk); }; walk(ast);
 new Function(...Object.keys(bindings), ts.transpile(declarations.join("\n") + "\n" + calls.join(";\n") + ";", { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
 const ref = { current: p }, queue = createBitmapLayerWriteQueue(), errors: unknown[] = [], api = { ensureLayerAssets: (p: any) => callbacks.get("workspace:ensureLayerAssets")({}, p), exportPhotoshopTiffs: (p: any) => callbacks.get("workspace:exportPhotoshopTiffs")({}, p), autosaveWorkspace: persist, saveWorkspace: async (p: any) => p, readOutputIdentity: async (p: string) => hash(await fs.readFile(p)) };
 const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue, paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), api: () => api, freshToken: () => "unused", onSave: () => {}, onError: e => errors.push(e) });
 await adapter.owner.load(p); const current = ref.current;
 expect(await adapter.ensureLayerAssets()).toBe(true); expect(await adapter.exportPhotoshopTiffs()).toBe(true); expect(errors).toEqual([]);
 expect(result!.exportedFiles).toHaveLength(1); expect((await sharp(result!.exportedFiles[0]).raw().toBuffer())[0]).toBe(255);
 expect(ref.current).toBe(current); expect(persist).not.toHaveBeenCalled(); expect(await Promise.all(protectedPaths.map(p => fs.readFile(p)))).toEqual(before); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
 // Missing owned asset (including pending/not-ready) must never become transparent.
 await fs.unlink(asset); adapter.owner.publishEdit(p => p, [shot.id]); const snapshot = await fs.readFile(f.metadataPath);
 expect(await adapter.ensureLayerAssets()).toBe(false); await expect(fs.stat(asset)).rejects.toMatchObject({ code: "ENOENT" }); expect(await fs.readFile(f.metadataPath)).toEqual(snapshot);
});
it.each(["workspace:ensureLayerAssets", "workspace:exportPhotoshopTiffs"])("actual %s rejects supported retained transaction before first effect", async channel => {
 const f = await fixture(), p = mergeFolderImages(createProject("Supported"), [{ imagePath: f.image, fileName: "a.tiff", width: 4, height: 3 }]), shot = p.shots[0]; shot.swb!.status = "owned";
 const asset = path.join(f.root, shot.layers![0].bitmapPath); await fs.mkdir(path.dirname(asset), { recursive: true }); await sharp(f.image).png().toFile(asset);
 p.pendingBake = { version: 1, shots: { [shot.id]: { state: "synced", acceptedOutputIdentity: hash(await fs.readFile(f.image)) } } };
 const journal = path.join(path.dirname(f.metadataPath), "pending-file-transaction.json"); await fs.writeFile(journal, JSON.stringify({ version: 1, moves: [] })); const original = await fs.readFile(journal);
 const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
 const admission = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(ast) === "assertNormalSaveAdmission")!.getText(ast);
 const io = vi.fn(async () => { throw new Error("asset effect escaped transaction admission"); }), callbacks = new Map<string, any>();
 const bindings = { withLayerFileOperation, assertPhysicalWorkspaceWriterTargets, isCertifiedPendingBakeEntry, path, createHash, readFile: fs.readFile, resolveLayerAssetPath, assertPathInsideFolder, hasPendingFileTransaction: transaction.hasPendingFileTransaction, ensureProjectLayerAssets: io, exportPhotoshopLayeredTiffs: io, writeProjectFiles: io, registerWorkspacePersistenceIpcHandlers, ipcMain: { handle: (name: string, fn: any) => { callbacks.set(name, fn); } } };
 let call = "";
 const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && (channel === "workspace:ensureLayerAssets" ? n.expression.getText(ast) === "registerWorkspacePersistenceIpcHandlers" : n.expression.getText(ast) === "ipcMain.handle" && n.arguments[0]?.getText(ast) === JSON.stringify(channel))) call = n.getText(ast); ts.forEachChild(n, walk); }; walk(ast);
 new Function(...Object.keys(bindings), ts.transpile(admission + "\n" + call + ";", { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
 await expect(callbacks.get(channel)({}, { project: p, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true })).rejects.toThrow(/Pending transaction/);
 expect(io).not.toHaveBeenCalled(); expect(await fs.readFile(journal)).toEqual(original);
});
it("retired legacy open preserves TIFF, editable pixels and metadata without generating a preview", async () => {
 const f = await fixture(), p = mergeFolderImages(createProject("Legacy real merge"), [{ imagePath: f.image, fileName: "a.tiff", width: 4, height: 3 }]), shot = p.shots[0];
 shot.swb = { ...shot.swb!, status: "owned", sourceKind: "photoshop-layered-tiff" }; shot.layers![0].locked = true;
 const asset = path.join(f.root, shot.layers![0].bitmapPath); await fs.mkdir(path.dirname(asset), { recursive: true }); await sharp(f.image).png().toFile(asset);
 const output = await writePhotoshopLayeredTiffsForInPlaceSave(p, f.root, { scriptPath: path.resolve("scripts/photoshop-layered-tiff-export.py"), saveStamp: "preview-fixture" }); await fs.copyFile(output.replacements[0].fromPath, f.image);
 await fs.writeFile(f.metadataPath, JSON.stringify(p)); const original = await fs.readFile(f.image), json = await fs.readFile(f.metadataPath), png = await fs.readFile(asset);
 await expect(f.open({ normalSave: true, initializePreviews: true })).rejects.toThrow('older test project');
 await expect(fs.stat(f.previewRoot)).rejects.toMatchObject({ code: 'ENOENT' });
 expect(await fs.readFile(f.image)).toEqual(original); expect(await fs.readFile(f.metadataPath)).toEqual(json); expect(await fs.readFile(asset)).toEqual(png);
});
it("readonly discovery can report absent media without writing, while default readonly remains incomplete", async () => {
 const f = await fixture(), write = vi.spyOn(sharp.prototype, "toFile");
 const images = await createImportedImageRecords([f.image], f.previewRoot, { createPreview, readOnly: true, deferMissingPreviews: true, pixelFingerprint, readImageMetadata: p => sharp(p).metadata(), readSwbMetadata: async () => undefined });
 expect(images[0].previewPath).toBeUndefined(); expect(images[0].width).toBe(4); expect(write).not.toHaveBeenCalled();
 await expect(f.open({ normalSave: true })).rejects.toThrow(/preview/); expect(write).not.toHaveBeenCalled();
});
it("admitted fresh open reuses valid cache without rewriting it", async () => {
 const f = await fixture(), preview = await createPreview(f.image, f.previewRoot), before = await fs.readFile(preview), stat = await fs.stat(preview), writer = vi.spyOn(sharp.prototype, "toFile");
 const scan = await f.open({ normalSave: true, initializePreviews: true });
 expect(scan.images[0].previewPath).toBe(preview); expect(await fs.readFile(preview)).toEqual(before); expect((await fs.stat(preview)).mtimeMs).toBe(stat.mtimeMs); expect(writer).not.toHaveBeenCalled();
});
it.each(["unknown", "future", "corrupt", "transaction", "recovery-requested", "missing-layer", "parent-link", "leaf-link", "fresh-leftover"].flatMap(mode =>
 [false, true].filter(cached => !cached || !["parent-link", "leaf-link"].includes(mode)).map(cached => ({ mode, cached }))))("admitted preview refuses $mode with cached=$cached before zero asset writes and keeps missing MD and TIFF", async ({ mode, cached }) => {
 const f = await fixture(), original = await fs.readFile(f.image);
 await fs.mkdir(path.dirname(f.metadataPath), { recursive: true });
 let protectedPath: string | undefined, protectedBytes: Buffer | undefined;
 if (["unknown", "future", "corrupt", "missing-layer", "pending"].includes(mode)) {
  const p = mergeFolderImages(createProject("Actual scan merge"), [{ imagePath: f.image, fileName: "a.tiff", width: 4, height: 3 }]), shot = p.shots[0]; shot.swb!.status = "owned";
  p.pendingBake = mode === "future" ? { version: 99, shots: {} } as any : mode === "corrupt" ? { version: 1, shots: [] } as any : { version: 1, shots: { [shot.id]: mode === "unknown" ? { state: "unknown" } : mode === "pending" ? { state: "pending", editToken: "t", acceptedOutputIdentity: hash(original) } : { state: "synced", acceptedOutputIdentity: hash(original) } } };
  await fs.writeFile(f.metadataPath, JSON.stringify(p)); protectedPath = f.metadataPath;
 }
 if (mode === "transaction") { protectedPath = path.join(path.dirname(f.metadataPath), "pending-file-transaction.json"); await fs.writeFile(protectedPath, JSON.stringify({ version: 1, moves: [] })); }
 if (mode === "parent-link") { const elsewhere = path.join(f.root, "elsewhere"); await fs.mkdir(elsewhere); await fs.symlink(elsewhere, f.previewRoot); }
 if (mode === "leaf-link") { const { previewPathForImage } = await import("./previewPaths"); await fs.mkdir(f.previewRoot); await fs.symlink(f.image, previewPathForImage(f.image, f.previewRoot)); }
 if (mode === "fresh-leftover") { await fs.mkdir(path.join(path.dirname(f.metadataPath), "layers")); }
 if (protectedPath) protectedBytes = await fs.readFile(protectedPath);
 if (cached) await createPreview(f.image, f.previewRoot);
 const writer = vi.spyOn(sharp.prototype, "toFile"), writes = [vi.mocked(fs.mkdir).mockClear(), vi.mocked(fs.writeFile).mockClear(), vi.mocked(fs.rename).mockClear(), vi.mocked(fs.unlink).mockClear()];
 await expect(f.open({ normalSave: true, initializePreviews: true, ...(mode === "recovery-requested" ? { recoverPending: true } : {}) })).rejects.toThrow();
 expect(writer).not.toHaveBeenCalled(); writes.forEach(w => expect(w).not.toHaveBeenCalled()); expect(await fs.readFile(f.image)).toEqual(original);
 if (protectedPath) expect(await fs.readFile(protectedPath)).toEqual(protectedBytes);
 await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
it("supported clean actual scan-merged project gets missing preview without changing JSON internal pixels or TIFF", async () => {
 const f = await fixture(), original = await fs.readFile(f.image);
 const p = mergeFolderImages(createProject("Supported"), [{ imagePath: f.image, fileName: "a.tiff", width: 4, height: 3 }]), shot = p.shots[0]; shot.swb!.status = "owned";
 const asset = path.join(f.root, shot.layers![0].bitmapPath); await fs.mkdir(path.dirname(asset), { recursive: true }); await sharp(f.image).png().toFile(asset);
 p.pendingBake = { version: 1, shots: { [shot.id]: { state: "synced", acceptedOutputIdentity: hash(original) } } };
 await fs.writeFile(f.metadataPath, JSON.stringify(p)); const json = await fs.readFile(f.metadataPath), png = await fs.readFile(asset);
 const scan = await f.open({ normalSave: true, initializePreviews: true });
 expect((await sharp(scan.project.shots[0].previewPath).raw().toBuffer())[0]).toBe(255);
 expect(await fs.readFile(f.metadataPath)).toEqual(json); expect(await fs.readFile(asset)).toEqual(png); expect(await fs.readFile(f.image)).toEqual(original);
 expect(scan.project.pendingBake).toEqual(p.pendingBake);
});
it("actual open chain admits a normally autosaved pending project missing its derived preview, preserving token and H0", async () => {
 const f = await fixture(), original = await fs.readFile(f.image);
 const p = mergeFolderImages(createProject("Pending autosaved"), [{ imagePath: f.image, fileName: "a.tiff", width: 4, height: 3 }]), shot = p.shots[0]; shot.swb!.status = "owned";
 const asset = path.join(f.root, shot.layers![0].bitmapPath); await fs.mkdir(path.dirname(asset), { recursive: true }); await sharp(f.image).png().toFile(asset);
 p.pendingBake = { version: 1, shots: { [shot.id]: { state: "pending", editToken: "t1", acceptedOutputIdentity: hash(original) } } };
 await fs.writeFile(f.metadataPath, JSON.stringify(p)); const json = await fs.readFile(f.metadataPath), png = await fs.readFile(asset);
 const scan = await f.open({ normalSave: true, initializePreviews: true });
 expect((await sharp(scan.project.shots[0].previewPath).raw().toBuffer())[0]).toBe(255);
 expect(scan.project.pendingBake).toEqual(p.pendingBake);
 expect(scan.project.shots[0].swb!.status).toBe("owned");
 expect(await fs.readFile(f.metadataPath)).toEqual(json); expect(await fs.readFile(asset)).toEqual(png); expect(await fs.readFile(f.image)).toEqual(original);
 await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
// Real scan opener bound to an arbitrary root (readonly discovery + preview phase), reusing
// the actual main.ts scanFolder/registration instead of the shared red-4x3 fixture.
async function buildScanOpener(root: string, metadataPath: string, previewRoot: string, image: string, onPreviews?: () => void) {
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["scanWorkspaceFolder", "scanFolder", "ensureStoryboardScriptMarkdown", "readProject", "createImageRecords", "readSwbMetadata"];
  const selected = ast.statements.filter(n => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(ast)));
  expect(selected).toHaveLength(names.length);
  const md = path.join(root, "storyboard-script.md");
  const bindings = { withLayerFileOperation, assertPhysicalWorkspaceWriterTargets, isCertifiedPendingBakeEntry, app: { getAppPath: () => process.cwd() }, process, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR, path, sharp, sharpSourceOptions: { unlimited: true }, swbXmpTag: "swb:metadata", readFile: fs.readFile, readProjectMetadata, ...transaction,
    createWorkspaceFolderScanner, metadataPathForFolder: () => metadataPath, previewRootForFolder: () => previewRoot,
    collectImagePaths: async () => [image], createImportedImageRecords, createPreview, pixelFingerprint,
    initializeNormalOpenPreviews: async (...args: any[]) => { onPreviews?.(); return (await import("./normalOpenPreviewService")).initializeNormalOpenPreviews(...args as Parameters<typeof import("./normalOpenPreviewService")["initializeNormalOpenPreviews"]>); },
    storyboardScriptPathForFolder: () => md, storyboardScriptNeedsImport: () => false, writeStoryboardScriptMarkdown: async () => { await fs.writeFile(md, "generated"); } };
  const scanFolder = new Function(...Object.keys(bindings), ts.transpile(selected.map(n => n.getText(ast)).join("\n") + ";return scanFolder;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
  let invoke!: (...args: any[]) => Promise<any>;
  registerWorkspaceOpenIpcHandlers({ handle: (_name: string, fn: any) => { invoke = fn; } } as any, createWorkspaceOpenAppHandlers({ scanFolder, createProgressReporter: () => undefined, pathExists: async () => true, addRecentFolder: () => {}, removeRecentFolder: () => {} }));
  return (options?: unknown) => invoke({ sender: {} }, root, options);
}
// The actual main workspace:importSwbFormat handler, extracted and bound to real local ports.
async function buildImportChain(metadataPath: string) {
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["sharpSourceOptions", "swbFormatVersion", "swbXmpTag", "readSwbMetadata", "archiveStamp", "uniquePath", "projectNeedsSwbImport", "assertManualImageImportAdmission", "importProjectToSwbFormat", "emptyDefaultSketchLayers", "createProjectPreviewsForShots", "ensureProjectLayerAssets", "createImageBitmapLayerPng", "createPaintBitmapLayerPng", "createTransparentLayerPng", "transparentLayerBuffer", "shouldWriteSwbMetadata", "shouldWritePhotoshopLayeredTiffOnSave", "bakeShotToWorkingTiff", "bakeBitmapLayersToTiff", "bakeSketchOverlayToTiff", "sketchLayersForShot", "swbMetadataForShot", "swbMetadataXmp", "writeSwbMetadataToTiffs", "preparePhotoshopLayeredTiffsForSave", "writeProjectFiles", "writeProjectMetadata", "writeStoryboardScriptMarkdown", "storyboardScriptPathForFolder"];
  const selected = tree.statements.filter(n => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(tree)));
  expect(selected).toHaveLength(names.length);
  const block = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  expect(block.length).toBeGreaterThan(0);
  let handler!: (event: unknown, payload: any) => Promise<any>;
  const bindings: Record<string, unknown> = { ...fs, ...renames, ...importPorts, ...bitmap, ...safety, ...layer, ...script, path, sharp, createHash, randomUUID, automaticImageImportAdmission, manualImageImportAdmission,
    bitmapLayersForShot, pixelFingerprint, createImportPathReservation, prepareImportStaging, recoverFailedImport, ImportRecoveryIncompleteError, withSuccessfulSaveArtifactCleanup, ...tiffPreparation, removeOwnedFile, previewRootForFolder, createPreview, writePhotoshopLayeredTiffsForInPlaceSave,
    hasPendingFileTransaction: transaction.hasPendingFileTransaction, writeProtectedLayerFile: protectedWriter,
    withLayerFileOperation, mapWithConcurrency, prepareProtectedLayerReplacement,
    app: { getAppPath: () => process.cwd() }, process, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    createWorkspaceTaskProgressReporter: () => undefined, ipcMain: { handle: (_name: string, fn: any) => { handler = fn; } } };
  const compiled = ts.transpileModule(selected.map(n => n.getText(tree)).join("\n") + block + "; return { persist: writeProjectFiles, ensure: ensureProjectLayerAssets, readMetadata: readSwbMetadata, exportProject: preparePhotoshopLayeredTiffsForSave };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const chain = new Function(...Object.keys(bindings).filter(k => k !== "default"), compiled)(...Object.entries(bindings).filter(([k]) => k !== "default").map(([, v]) => v));
  return { io: (payload: any) => handler({ sender: {} }, payload), persist: chain.persist as (m: string, f: string, project: Project) => Promise<void>, ensure: chain.ensure as (project: Project, folder: string) => Promise<void>, readMetadata: chain.readMetadata as (p: string) => Promise<unknown>, exportProject: chain.exportProject as (project: Project, folder: string, saveStamp: string) => Promise<{ replacements: Array<{ fromPath: string }> }> };
}

it("actual missing-cache open runs the preview phase, then the real classifier, then the actual main guarded Import", async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "normal-open-compat-")); dirs.push(root);
 const metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json");
 const previewRoot = path.join(root, ".storyboard-workbench/previews"), image = path.join(root, "a.tiff");
 // Write same-size/same-layer internal PNGs; an opaque top (paint) layer makes a change visible.
 const writeLayers = async (dir: string, base0: string, paint0: string) => {
  const out: any[] = [];
  for (const [i, spec] of [{ id: "layer-image", kind: "image" as const, name: "base" }, { id: "layer-0001", kind: "paint" as const, name: "paint" }].entries()) {
   const bitmapPath = `.storyboard-workbench/layers/s/${spec.id}.png`;
   await fs.mkdir(path.dirname(path.join(dir, bitmapPath)), { recursive: true });
   await sharp({ create: { width: 4, height: 3, channels: 4, background: i ? paint0 : base0 } }).png().toFile(path.join(dir, bitmapPath));
   out.push({ ...spec, bitmapPath, width: 4, height: 3, visible: true, locked: false, order: i, opacity: 1, blendMode: "normal" as const });
  }
  return out;
 };
 const layers = await writeLayers(root, "red", "blue");
 const base = { ...createProject("Compatible real"), pendingBake: { version: 1 as const, shots: {} },
  shots: [{ id: "s", order: 0, imagePath: image, fileName: "a.tiff", swb: { version: 1 as const, status: "owned" as const, sourceKind: "photoshop-layered-tiff" as const, canvasWidth: 4, canvasHeight: 3 }, layers }] } as unknown as Project;
 const chain = await buildImportChain(metadataPath);
 await fs.copyFile((await chain.exportProject(base, root, "owned")).replacements[0].fromPath, image);
 const h0 = hash(await fs.readFile(image)), h0fp = await pixelFingerprint(image);
 expect(await chain.readMetadata(image)).toMatchObject({ shotId: "s", canvasWidth: 4, canvasHeight: 3 });
 const internalPng = path.join(root, layers[0].bitmapPath);
 const internalBefore = await fs.readFile(internalPng);
 // A real external edit in an INDEPENDENT asset dir changes the visible (top opaque) layer and
 // re-exports a same-size/same-layer metadata-bearing TIFF; the internal PNGs are untouched.
 const externalDir = path.join(root, "external-edit");
 await writeLayers(externalDir, "red", "yellow");
 await fs.copyFile((await chain.exportProject(base, externalDir, "external")).replacements[0].fromPath, image);
 const externalFp = await pixelFingerprint(image);
 expect(externalFp).not.toBe(h0fp); // the change is visible in the composite, not masked by an opaque layer
 expect(await fs.readFile(internalPng)).toEqual(internalBefore); // internal PNG bytes preserved
 // Disk Project stays owned/H0 with a real baseline fingerprint; it is NOT hand-marked compatible.
 const disk = { ...base, shots: [{ ...base.shots[0], swb: { ...base.shots[0].swb!, status: "owned" as const, baseFingerprint: h0fp } }],
  pendingBake: { version: 1 as const, shots: { s: { state: "synced" as const, acceptedOutputIdentity: h0 } } } } as Project;
 await fs.writeFile(metadataPath, JSON.stringify(disk));
 const json = await fs.readFile(metadataPath);
 // The derived preview cache is MISSING: the open's preview phase must actually run and generate it.
 const previewPath = previewPathForImage(image, previewRoot);
 await fs.rm(previewRoot, { recursive: true, force: true });
 await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: "ENOENT" });
 let previewsInitialized = 0;
 const open = await buildScanOpener(root, metadataPath, previewRoot, image, () => { previewsInitialized++; });
 // The actual checkExternalChanges pipeline the app runtime wires (no stub, no manual marking).
 const { createWorkspaceExternalChangesAppHandlers } = await import("./workspaceExternalChangesAppRuntime");
 const { collectImagePaths } = await import("./imageDiscoveryService");
 const { changedKnownImagePaths } = await import("./knownImageChangesService");
 const readSwb = chain.readMetadata as (p: string) => Promise<unknown>;
 const handlers = createWorkspaceExternalChangesAppHandlers<any>({
  changedKnownImagePaths: (project, paths, deleted, onProgress) => changedKnownImagePaths(project, paths, deleted, { pixelFingerprint, readSwbMetadata: readSwb as any, onProgress }),
  collectImagePaths,
  createImageRecords: (paths, pr, options) => createImportedImageRecords(paths, pr, { createPreview, pixelFingerprint, readImageMetadata: p => sharp(p).metadata(), readSwbMetadata: readSwb as any, onProgress: options?.onProgress, label: options?.label }),
  ensureStoryboardScriptMarkdown: async () => false, readStoryboardScriptImportState: async () => false,
  previewRootForFolder: () => previewRoot
 });
 const ref = { current: disk };
 let scanned: any, observed: { images: any[] } | undefined, imports = 0;
 let afterOpen: { json: Buffer; png: Buffer; previewPath?: string } | undefined;
 const api = {
  openFolderByPath: async (_p: string, options: unknown) => {
   scanned = await open(options);
   // Evidence captured at the exact open boundary: preview generated, disk/H0 JSON and internal PNG intact.
   afterOpen = { json: await fs.readFile(metadataPath), png: await fs.readFile(internalPng), previewPath: (await fs.stat(previewPath).catch(() => undefined)) ? previewPath : undefined };
   return scanned;
  },
  importSwbFormat: (payload: any) => { imports++; return chain.io(payload); },
  readOutputIdentity: async (file: string) => hash(await fs.readFile(file)),
  ensureLayerAssets: async (payload: any) => { await chain.ensure(payload.project, payload.folderPath); return payload; },
  // The classification observation lives in the ACTUAL adapter port the load calls.
  checkExternalChanges: async (payload: any) => { observed = await handlers.checkExternalChanges({ ...payload, normalSave: true }, { reportProgress: () => undefined }) as { images: any[] }; return observed; },
  saveWorkspace: async () => { throw new Error("not part of Import fixture"); },
  autosaveWorkspace: async (payload: any) => { await chain.persist(metadataPath, root, payload.project); return payload; }
 };
 const errors: unknown[] = [];
 const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(), paths: () => ({ folderPath: root, metadataPath }), api: () => api as any, freshToken: () => "fresh", onSave: () => {}, onError: e => { errors.push(e); } });
 const ok = await adapter.load(() => api.openFolderByPath(root, { normalSave: true, initializePreviews: true }), () => {}, { blankShotPreset: "16:9" as const, dirtyShotIds: [], prepare: async (project: Project) => project, published: () => {} });
 expect(ok, "load failed: " + errors.map(e => (e instanceof Error ? e.message : String(e))).join(" | ")).toBe(true);
 // (1) The missing-cache open executed the preview phase and generated the derived cache.
 expect(previewsInitialized).toBeGreaterThan(0);
 expect(afterOpen?.previewPath).toBe(previewPath);
 // (2) Immediately after the read-only open the disk owned/H0 JSON and internal PNG are unchanged.
 expect(afterOpen?.json).toEqual(json);
 expect(afterOpen?.png).toEqual(internalBefore);
 // The open preserved the persisted token/baseline and reported the disk as owned.
 expect(scanned.project.pendingBake).toEqual(disk.pendingBake);
 expect(scanned.project.shots[0].swb!.status).toBe("owned");
 // (3) The actual classifier port classified the visible external change (its own output, no hand mark).
 expect(observed!.images.map((i: any) => i.imagePath)).toEqual([image]);
 expect(mergeExternalImageChanges(disk, observed!.images).shots[0].swb!.status).toBe("compatible-external-edit");
 // (4) The actual main guarded Import ran and consumed the real compatible TIFF pixels.
 expect(imports).toBe(1);
 expect(await fs.readFile(metadataPath)).not.toEqual(json);
 const owned = ref.current.shots.find(s => s.swb?.status === "owned");
 expect(owned, "real guarded Import did not certify an owned shot").toBeDefined();
 expect(owned!.id).toBe("s");
 expect(ref.current.pendingBake!.shots[owned!.id]).toMatchObject({ state: "pending" });
 const greens = await Promise.all(owned!.layers!.map(async l => (await sharp(path.join(root, l.bitmapPath)).raw().toBuffer())[1]));
 expect(greens).toContain(255);
 expect(await fs.readFile(path.join(root, script.storyboardScriptFileName), "utf8")).toBe(script.serializeStoryboardScriptMarkdown(ref.current));
});
it("actual normal fresh open initializes only derived preview after readonly discovery and publishes displayable default Image without certifying synced", async () => {
 const f = await fixture(), original = await fs.readFile(f.image);
 const writer = vi.fn(), ref = { current: createProject("old") }, errors: unknown[] = [];
 const api = { openFolderByPath: (_p: string, options: unknown) => f.open(options), autosaveWorkspace: writer, saveWorkspace: writer, readOutputIdentity: async (p: string) => hash(await fs.readFile(p)) };
 const caller = await createAppOpenCallerScope({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(), paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), api: () => api as any, freshToken: () => "unused", onSave: writer, onError: e => errors.push(e) });
 // Actual App open expression, not a new helper invoked instead of its caller.
 const app = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
 const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "handleOpenFolderByPath") expression = n.initializer!.getText(ast); ts.forEachChild(n, walk); }; walk(ast);
 const bindings = { ...caller, window: { storyboard: api }, normalSaveAppEnabled: true, folderInputValue: f.root, blankShotPreset: "16:9", prepareNormalSaveImportMatte: writer, normalSaveImageImportPublished: writer, publishNormalSaveFolderScan: writer, setWorkspaceTask: vi.fn(), setStatus: vi.fn() };
 await new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings))();
 expect(errors).toEqual([]); expect(ref.current.shots).toHaveLength(1);
 const shot = ref.current.shots[0]; expect(shot.layers?.[0].name).toBe("Image"); expect(shot.swb?.status).toBe("non-swb");
 expect((await sharp(shot.previewPath).raw().toBuffer())[0]).toBe(255);
 expect(ref.current.pendingBake?.shots[shot.id]).toBeUndefined(); expect(await fs.readFile(f.image)).toEqual(original);
 await expect(fs.stat(f.metadataPath)).rejects.toMatchObject({ code: "ENOENT" }); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
 await expect(fs.stat(path.join(f.root, shot.layers![0].bitmapPath))).rejects.toMatchObject({ code: "ENOENT" });
});
