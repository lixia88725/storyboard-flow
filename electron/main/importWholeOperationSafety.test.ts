import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import * as renames from "./fileRenames";
import * as importPorts from "./photoshopTiffImport";
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { writeProtectedLayerFile } from "./protectedLayerFileWriter";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { normalSaveImportFailure } from "./normalSaveImportFailure";
import { createImportPathReservation } from "./importPaths";
import { prepareImportStaging } from "./importPreparation";
import { createProject } from "../../src/shared/projectOps";
import { pixelFingerprint } from "./imageFingerprintService";
import { pathEntryExists } from "./pathSafety";
import * as safety from "./pathSafety";

it("actual Script Import retains a pre-existing dangling PNG entry when creation is refused", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "script-existing-entry-"));
  const bitmapPath = ".storyboard-workbench/layers/new/layer-image.png";
  const target = path.join(root, bitmapPath), missing = path.join(root, "missing.png");
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.symlink(missing, target);
  const project = createProject("Synthetic");
  const next = { ...project, shots: [{ id: "new", layers: [{ bitmapPath, kind: "paint", width: 2, height: 2 }] }] };
  let handler!: (event: unknown, payload: unknown) => Promise<unknown>;
  const bindings = { ...fs, ...safety, withLayerFileOperation, mapWithConcurrency, recoverFailedImport,
    ImportRecoveryIncompleteError, normalSaveImportFailure, path, sharp, writeProtectedLayerFile,
    assertNormalSaveAdmission: async () => {}, hasPendingFileTransaction: async () => false,
    projectNeedsSwbImport: () => false, importStoryboardScriptMarkdown: async () => ({ project: next, rollback: async () => {} }),
    resolveLayerAssetPath: (folder: string, relative: string) => path.join(folder, relative),
    shouldEnsureLayerAssetsForShot: () => true, sketchLayersForShot: () => [],
    ipcMain: { handle: (_name: string, fn: typeof handler) => { handler = fn; } }
  };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const selected = tree.statements.filter(node => ts.isVariableStatement(node) &&
    ["ensureProjectLayerAssets", "createTransparentLayerPng"].includes(node.declarationList.declarations[0].name.getText(tree)));
  expect(selected).toHaveLength(2);
  const outer = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  const compiled = ts.transpileModule(selected.map(node => node.getText(tree)).join("\n") + "\n" + outer,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const entries = Object.entries(bindings).filter(([name]) => name !== "default");
  new Function(...entries.map(([name]) => name), compiled)(...entries.map(([, value]) => value));
  try {
    const error = await handler({ sender: {} }, { normalSave: true, project, folderPath: root,
      metadataPath: path.join(root, "project.json") }).catch((failure: unknown) => failure);
    expect(String(error)).toContain("create-only target already exists");
    expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(target)).toBe(missing);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 15000);

it("actual outer Import holds queued PNG edits through preview failure and rollback", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "outer-import-operation-"));
  const make = (background: string) => sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer();
  const [old, imported, later] = await Promise.all(["red", "green", "blue"].map(make));
  const image = path.join(root, "image.tiff"); await sharp(imported).tiff().toFile(image);
  const target = path.join(root, ".storyboard-workbench/layers/s/layer-image.png");
  const ensureDirectory = async (p: string) => { await fs.mkdir(p, { recursive: true }); };
  await ensureDirectory(path.dirname(target)); await fs.writeFile(target, old);
  const project = { ...createProject("Synthetic"), shots: [{ id: "s", imagePath: image, fileName: "image.tiff", order: 0, swb: { status: "compatible-external-edit", version: 1 }, layers: [] }] };
  let handler!: (event: unknown, payload: unknown) => Promise<unknown>, writing!: Promise<unknown>, done = false, overlapped = false;
  const bindings = { ...fs, ...renames, ...importPorts, ...safety, path, sharp, createHash, randomUUID,
    withLayerFileOperation, mapWithConcurrency, prepareProtectedLayerReplacement, recoverFailedImport, ImportRecoveryIncompleteError, normalSaveImportFailure,
    createImportPathReservation, prepareImportStaging, pixelFingerprint, sharpSourceOptions: { unlimited: true }, swbFormatVersion: 1, process,
    archiveStamp: randomUUID, pathExists: async (p: string) => fs.access(p).then(() => true, () => false), ensureDirectory,
    uniquePath: async (dir: string, name: string) => path.join(dir, name),
    app: { getAppPath: () => process.cwd() }, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    // Only TIFF decode preparation is replaced. Real main orchestration, native
    // metadata preparation, rename/rollback, and later PNG writer stay real.
    runPhotoshopTiffImporter: async (_p: unknown, _script: unknown, _src: unknown, out: string, manifest: string) => {
      await ensureDirectory(out); const assetPath = path.join(out, "synthetic.png"); await fs.writeFile(assetPath, imported);
      await fs.writeFile(manifest, JSON.stringify({ width: 2, height: 2, warnings: [], layers: [{ assetPath, name: "Image", visible: true, opacity: 1, blendMode: "normal", order: 0 }] }));
    }, emptyDefaultSketchLayers: () => true, projectNeedsSwbImport: () => true,
    importStoryboardScriptMarkdown: async () => ({ project, rollback: async () => {} }), createWorkspaceTaskProgressReporter: () => undefined,
    writeSwbMetadataToTiffs: async () => undefined,
    createProjectPreviewsForShots: async () => {
      // AsyncLocalStorage must represent another IPC request, not a reentrant
      // write within Import. Launch it from the unrelated test context below.
      entered(); await gate;
      overlapped = done;
      throw new Error("synthetic outer preview failure");
    }, writeProjectFiles: async () => {}, ipcMain: { handle: (_name: string, fn: typeof handler) => { handler = fn; } }
  };
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const selected = tree.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(tree) === "importProjectToSwbFormat");
  expect(selected).toHaveLength(1);
  const block = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  const compiled = ts.transpileModule(selected[0].getText(tree) + "\n" + block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const entries = Object.entries(bindings).filter(([k]) => k !== "default");
  new Function(...entries.map(([k]) => k), compiled)(...entries.map(([, v]) => v));
  const importing = handler({ sender: {} }, { project, folderPath: root, metadataPath: path.join(root, "project.json") }).catch((e: unknown) => e);
  // A failure before the preview stage must surface as that error, not a hang.
  await Promise.race([ready, importing.then(error => { throw new Error(`Import failed before previews: ${String(error)}`); })]);
  writing = writeProtectedLayerFile(root, target, later).then(() => { done = true; });
  await Promise.race([writing, new Promise<void>(r => setTimeout(r, 150))]);
  release(); const error = await importing; await writing;
  expect(String(error)).toContain("synthetic outer preview failure");
  expect.soft(overlapped).toBe(false);
  expect(await fs.readFile(target)).toEqual(later);
}, 30000);

it("Import refuses a pre-existing dangling layer link instead of replacing it", async () => {
  const run = promisify(execFile);
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "import-dangling-link-"));
  const imported = await sharp({ create: { width: 2, height: 2, channels: 4, background: "green" } }).png().toBuffer();
  const image = path.join(root, "image.tiff"); await sharp(imported).tiff().toFile(image);
  const target = path.join(root, ".storyboard-workbench/layers/s/layer-image.png");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.symlink(path.join(root, "owned-missing.png"), target);
  const project = { ...createProject("Synthetic"), shots: [{ id: "s", imagePath: image, fileName: "image.tiff", order: 0, swb: { status: "compatible-external-edit", version: 1 }, layers: [] }] };
  let certifications = 0;
  const bindings = { ...fs, ...renames, ...importPorts, path, sharp, createHash, randomUUID, withLayerFileOperation, mapWithConcurrency,
    prepareProtectedLayerReplacement: async (...args: Parameters<typeof prepareProtectedLayerReplacement>) => {
      certifications += 1; return prepareProtectedLayerReplacement(...args);
    }, recoverFailedImport, ImportRecoveryIncompleteError, normalSaveImportFailure, createImportPathReservation, prepareImportStaging, pixelFingerprint,
    sharpSourceOptions: { unlimited: true }, swbFormatVersion: 1, process, archiveStamp: randomUUID,
    pathExists: async (p: string) => fs.access(p).then(() => true, () => false), pathEntryExists,
    ensureDirectory: async (p: string) => { await fs.mkdir(p, { recursive: true }); },
    uniquePath: async (dir: string, name: string) => path.join(dir, name),
    app: { getAppPath: () => process.cwd() }, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    runPhotoshopTiffImporter: async (_p: unknown, _script: unknown, _src: unknown, out: string, manifest: string) => {
      await fs.mkdir(out, { recursive: true }); const assetPath = path.join(out, "synthetic.png"); await fs.writeFile(assetPath, imported);
      await fs.writeFile(manifest, JSON.stringify({ width: 2, height: 2, warnings: [], layers: [{ assetPath, name: "Image", visible: true, opacity: 1, blendMode: "normal", order: 0 }] }));
    }, emptyDefaultSketchLayers: () => true
  };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(tree) === "importProjectToSwbFormat")!;
  const compiled = ts.transpileModule(node.getText(tree) + ";return importProjectToSwbFormat;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const entries = Object.entries(bindings).filter(([k]) => k !== "default");
  const runImport = new Function(...entries.map(([k]) => k), compiled)(...entries.map(([, v]) => v));
  const error = await runImport(project, root).then(() => undefined, (e: unknown) => e);
  expect(error).toBeDefined();
  expect(certifications).toBeGreaterThan(0);
  expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
  expect(await run("python3", ["-B", path.resolve("scripts/layer-file-permissions.py"), target]).then(
    ({ stdout }: { stdout: string }) => JSON.parse(stdout).kind)).not.toBe("ordinary");
}, 30000);
