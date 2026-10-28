import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { createWorkspaceFolderScanner } from "./workspaceScanService";
import { assertPhysicalWorkspaceWriterTargets } from "./workspacePhysicalWriterGate";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { createWorkspaceOpenAppHandlers } from "./workspaceOpenAppRuntime";
import { registerWorkspaceOpenIpcHandlers } from "./ipc/workspaceOpenHandlers";
import * as transaction from "./pendingFileTransactionService";
import { readProjectMetadata } from "./projectMetadataService";
import { manualImageImportAdmission } from "../shared/manualImageImportRules";
import { createAppOpenCallerScope } from './appOpenCallerScope.mjs';
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { createProject } from "../../src/shared/projectOps";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
async function fixture(raw: unknown, both = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "normal-owned-open-")); dirs.push(root);
  const fromPath = path.join(root, "s.tiff"), toPath = path.join(root, "Pending/s.tiff"), metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json"), journal = path.join(root, ".storyboard-workbench/pending-file-transaction.json"), md = path.join(root, "storyboard-script.md");
  await fs.mkdir(path.dirname(metadataPath), { recursive: true }); await fs.mkdir(path.dirname(toPath));
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).tiff({ compression: "none" }).toFile(toPath); if (both) await fs.writeFile(fromPath, "other-version");
  const hash = createHash("sha256").update(await fs.readFile(toPath)).digest("hex");
  const bitmapPath = ".storyboard-workbench/layers/s/image.png"; await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true }); await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(path.join(root, bitmapPath));
  const p = { ...createProject("Synthetic"), shots: [{ id: "s", imagePath: fromPath, swb: { status: "owned" }, layers: [{ bitmapPath }] }], pendingBake: raw === "supported" ? { version: 1, shots: { s: { state: "pending", editToken: "t", acceptedOutputIdentity: hash } } } : raw };
  await fs.writeFile(metadataPath, JSON.stringify(p)); await fs.writeFile(journal, JSON.stringify({ version: 1, moves: [{ fromPath, toPath }] }));
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["scanWorkspaceFolder", "scanFolder", "ensureStoryboardScriptMarkdown", "readProject"];
  const selected = ast.statements.filter(n => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(ast)));
  expect(selected).toHaveLength(names.length);
  const effects: string[] = [];
  const bindings = { withLayerFileOperation, assertPhysicalWorkspaceWriterTargets, path, readFile: fs.readFile, createHash, manualImageImportAdmission, readProjectMetadata,
    ...transaction, recoverPendingFileTransaction: vi.fn(async (...args: Parameters<typeof transaction.recoverPendingFileTransaction>) => { effects.push("legacy-recovery"); return transaction.recoverPendingFileTransaction(...args); }),
    createWorkspaceFolderScanner, metadataPathForFolder: () => metadataPath, previewRootForFolder: () => path.join(root, "preview"), collectImagePaths: vi.fn(async () => []), createImageRecords: vi.fn(async () => []),
    storyboardScriptPathForFolder: () => md, storyboardScriptNeedsImport: () => false, writeStoryboardScriptMarkdown: async () => { effects.push("MD-write"); await fs.writeFile(md, "generated"); } };
  const scanFolder = new Function(...Object.keys(bindings), ts.transpile(selected.map(n => n.getText(ast)).join("\n") + ";return scanFolder;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
  let invoke!: (...args: any[]) => Promise<any>;
  registerWorkspaceOpenIpcHandlers({ handle: (_name: string, fn: any) => { invoke = fn; } } as any, createWorkspaceOpenAppHandlers({ scanFolder, createProgressReporter: () => undefined, pathExists: async () => true, addRecentFolder: () => {}, removeRecentFolder: () => {} }));
  return { root, fromPath, toPath, metadataPath, journal, md, effects, open: (options?: unknown) => invoke({ sender: {} }, root, options) };
}
it.each(["supported", { version: 99, shots: {} }, { version: 1, shots: { s: { state: "unknown" } } }, { version: 1, shots: [] }])("actual normal open handler/scanner pre-admission preserves transaction and assets: %j", async raw => {
  const f = await fixture(raw), before = await Promise.all([f.toPath, f.metadataPath, f.journal].map(p => fs.readFile(p)));
  const scan = await f.open({ normalSave: true });
  expect(f.effects).toEqual([]); expect(scan.scriptImportNeeded).toBe(true);
  expect(scan.normalSaveOpenRecoveryRequired).toMatch(/Pending/);
  expect(await Promise.all([f.toPath, f.metadataPath, f.journal].map(p => fs.readFile(p)))).toEqual(before);
  await expect(fs.stat(f.fromPath)).rejects.toMatchObject({ code: "ENOENT" }); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
it("actual normal open with missing MD and no transaction only reports", async () => {
  const f = await fixture("supported"); await fs.unlink(f.journal); await fs.rename(f.toPath, f.fromPath);
  const json = await fs.readFile(f.metadataPath); const scan = await f.open({ normalSave: true });
  expect(f.effects).toEqual([]); expect(scan.scriptImportNeeded).toBe(true); expect(await fs.readFile(f.metadataPath)).toEqual(json); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
it("actual explicit normal recovery admits certified single-side transaction only after readonly scan", async () => {
  const f = await fixture("supported"); const before = await fs.readFile(f.metadataPath);
  const scan = await f.open({ normalSave: true, recoverPending: true });
  expect(scan.normalSaveOpenRecoveryRequired).toBeUndefined(); expect(f.effects).toEqual([]);
  expect((await sharp(f.fromPath).raw().toBuffer())[0]).toBe(255);
  await expect(fs.stat(f.toPath)).rejects.toMatchObject({ code: "ENOENT" }); await expect(fs.stat(f.journal)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(f.metadataPath)).toEqual(before); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["both", "unknown", "future", "corrupt", "wrong-hash", "missing-layer"])("explicit normal recovery refuses %s without moving deleting or writing", async mode => {
  const raw = mode === "unknown" ? { version: 1, shots: { s: { state: "unknown" } } } : mode === "future" ? { version: 99, shots: {} } : mode === "corrupt" ? { version: 1, shots: [] } : "supported";
  const f = await fixture(raw, mode === "both");
  if (mode === "wrong-hash") await fs.writeFile(f.toPath, "changed-external-bytes");
  if (mode === "missing-layer") { const p = JSON.parse(await fs.readFile(f.metadataPath, "utf8")); p.shots[0].layers = [{ bitmapPath: ".storyboard-workbench/layers/s/missing.png" }]; await fs.writeFile(f.metadataPath, JSON.stringify(p)); }
  const protectedPaths = [f.toPath, f.metadataPath, f.journal, ...(mode === "both" ? [f.fromPath] : [])], before = await Promise.all(protectedPaths.map(p => fs.readFile(p)));
  await expect(f.open({ normalSave: true, recoverPending: true })).rejects.toThrow(/recovery|compatibility|assets|identity|ambiguous/i);
  expect(f.effects).toEqual([]); expect(await Promise.all(protectedPaths.map(p => fs.readFile(p)))).toEqual(before); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
it("actual App owned open reaches real handler scanner and refuses retained transaction before all writer ports", async () => {
  const f = await fixture({ version: 99, shots: {} }, true), protectedPaths = [f.fromPath, f.toPath, f.journal, f.metadataPath];
  const before = await Promise.all(protectedPaths.map(p => fs.readFile(p))), errors: unknown[] = [], writer = vi.fn();
  const ref = { current: createProject("old A") }, api = { openFolderByPath: (_p: string, options?: unknown) => f.open(options), importSwbFormat: writer, checkExternalChanges: writer, autosaveWorkspace: writer, saveWorkspace: writer, readOutputIdentity: writer };
  const caller = await createAppOpenCallerScope({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(), paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), api: () => api, freshToken: () => "unused", onSave: writer, onError: e => errors.push(e) });
  const app = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "handleOpenFolderByPath") expression = n.initializer!.getText(ast); ts.forEachChild(n, walk); }; walk(ast);
  const bindings = { ...caller, window: { storyboard: api }, normalSaveAppEnabled: true, folderInputValue: f.root, blankShotPreset: "16:9", prepareNormalSaveImportMatte: writer, normalSaveImageImportPublished: writer, publishNormalSaveFolderScan: writer, setWorkspaceTask: vi.fn(), setStatus: vi.fn() };
  await new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings))();
  expect(errors).toEqual([]); expect(bindings.setStatus).toHaveBeenCalledWith(expect.stringMatching(/Could not open folder:.*Pending/));
  expect(writer).not.toHaveBeenCalled(); expect(ref.current.name).toBe("old A"); expect(f.effects).toEqual([]);
  expect(await Promise.all(protectedPaths.map(p => fs.readFile(p)))).toEqual(before); await expect(fs.stat(f.md)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["preload.ts", "preload.cjs"])("actual %s forwards normal readonly options through IPC", async file => {
  const source = await fs.readFile(new URL(`../preload/${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let expression = "";
  const walk = (n: ts.Node) => { if (ts.isPropertyAssignment(n) && n.name.getText(ast) === "openFolderByPath") expression = n.initializer.getText(ast); ts.forEachChild(n, walk); }; walk(ast);
  const invoke = vi.fn(async () => ({})); const open = new Function("ipcRenderer", ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))({ invoke });
  const options = { normalSave: true }; await open("/synthetic/B", options);
  expect(invoke).toHaveBeenCalledWith("workspace:openFolderByPath", "/synthetic/B", options);
});
it("actual legacy open keeps original legal recovery and missing MD generation", async () => {
  const f = await fixture(undefined); await f.open(); expect(f.effects).toEqual(["legacy-recovery", "MD-write"]);
  expect((await sharp(f.fromPath).raw().toBuffer())[0]).toBe(255); await expect(fs.stat(f.journal)).rejects.toMatchObject({ code: "ENOENT" });
});
