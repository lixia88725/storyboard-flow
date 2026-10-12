import { isCertifiedPendingBakeEntry } from "../shared/pendingBakeRules";
import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";
import sharp from "sharp";
import { createProject, deleteShots } from "../../src/shared/projectOps";
import { stagePendingDeletedShotFiles, trashPendingDeletedShotFiles } from "./deletedShotFiles";
import { cleanupDeletedShotLayerDirectories } from "./deletedShotLayers";
import { initializeCompletedShot } from "../../src/shared/pendingBake";
import type { Project } from "../../src/shared/types";
import { applyFileReplacements, applyFileRenamePlan, atomicWriteTextFile } from "./fileRenames";
import { recoverFailedSave } from "./saveRecovery";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts";
import * as tiffPreparation from "./tiffPreparation";
import { removeOwnedFile } from "./ownedFileCreation";
import { bitmapLayersForShot } from "./bitmapLayerOrdering";
import { flattenBitmapLayerBuffersToTiff } from "./bitmapLayers";
import { pixelFingerprint } from "./imageFingerprintService";
import { resolveLayerAssetPath, sharpBlendMode } from "./layerAssetService";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport";
import { saveProgressShotIds, countSaveProgressShots } from "./saveProgress";
import { serializeStoryboardScriptMarkdown, storyboardScriptFileName } from "./storyboardScript";
import { assertPathInsideFolder } from "./pathSafety";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createNormalSaveProjectOwner } from "../../src/renderer/normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { useLayerMetadataActionController } from "../../src/renderer/layerMetadataActionController";
import { readProjectMetadata } from "./projectMetadataService";
import { createWorkspacePendingAppHandlers } from "./workspacePendingAppRuntime";
import { beginPendingFileTransaction } from "./pendingFileTransactionService";

import { parkShotGroup, restoreParkedShotGroup } from "../../src/shared/projectOps";

// Exact production function bodies, real local filesystem/encoder/recovery ports.
// External Import and system Trash are explicitly bounded fixture ports, not certified here.
vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const hash = async (p: string) => createHash("sha256").update(await fs.readFile(p)).digest("hex");
const ops = { mkdir: async (p: string) => { await fs.mkdir(p, { recursive: true }); }, rename: fs.rename, unlink: fs.unlink, writeFile: fs.writeFile };
const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
function actual(names: string[], bindings: Record<string, unknown>, result: string) {
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const statements = tree.statements.filter(s => ts.isVariableStatement(s) && names.includes(s.declarationList.declarations[0].name.getText(tree)));
  expect(statements).toHaveLength(names.length);
  const compiled = ts.transpileModule(statements.map(s => s.getText(tree)).join("\n") + `; const result = ${result};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return result;`)(...Object.values(bindings));
}
async function fixture(fault?: "md" | "json" | "trash" | "cleanup") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "normal-main-chain-")); directories.push(root);
  const fileName = "s.tiff", imagePath = path.join(root, fileName);
  const bitmapPath = ".storyboard-workbench/layers/s/base.png";
  await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true });
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).png().toFile(path.join(root, bitmapPath));
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "white" } }).tiff({ compression: "none" }).toFile(imagePath);
  const project = createProject("Synthetic");
  project.shots = [{ id: "s", imagePath, fileName, order: 0, swb: { version: 1, status: "owned", canvasWidth: 4, canvasHeight: 3 }, layers: [{ id: "base", name: "Base", kind: "image", visible: true, locked: false, opacity: 0.5, order: 0, blendMode: "normal", bitmapPath, width: 4, height: 3 }] }];
  const p = initializeCompletedShot(project, "s", await hash(imagePath), "t1");
  const original = await fs.readFile(imagePath);
  const sentinel = path.join(root, "external-unedited.tiff"); await fs.writeFile(sentinel, original);
  p.shots.push({ ...p.shots[0], id: "untouched", imagePath: sentinel, fileName: "external-unedited.tiff", order: 1 });
  p.pendingBake!.shots.untouched = { state: "synced", acceptedOutputIdentity: await hash(sentinel) };
  const metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json");
  const mdPath = path.join(root, "storyboard-script.md");
  const effects: string[] = [];
  let beforeEnsure: (() => Promise<void>) | undefined;
  const bindings = { ...tiffPreparation, removeOwnedFile, withLayerFileOperation,
    isCertifiedPendingBakeEntry, createWorkspacePendingAppHandlers, beginPendingFileTransaction,
    path, randomUUID, createHash, readFile: fs.readFile, mkdir: fs.mkdir, rm: fs.rm, unlink: fs.unlink,
    rename: async (from: string, to: string) => { if (fault === "json" && to === metadataPath) throw new Error("required JSON install failed"); await fs.rename(from, to); if (to === metadataPath) effects.push("json"); },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      if (args[0] === mdPath) {
        if (fault === "md") throw new Error("required MD failed after JSON");
        effects.push("md");
      }
      await fs.writeFile(...args);
    },
    atomicWriteTextFile, storyboardScriptFileName, serializeStoryboardScriptMarkdown,
    ensureDirectory: ops.mkdir, applyFileReplacements, applyFileRenamePlan, withSuccessfulSaveArtifactCleanup,
    ensureProjectLayerAssets: async (p: Project) => { effects.push("ensure"); await beforeEnsure?.(); for (const s of p.shots) for (const l of s.layers ?? []) await fs.readFile(path.join(root, l.bitmapPath)); },
    sharp, bitmapLayersForShot, flattenBitmapLayerBuffersToTiff, pixelFingerprint, resolveLayerAssetPath, sharpBlendMode, assertPathInsideFolder,
    pathExists: async (p: string) => { try { await fs.stat(p); return true; } catch { return false; } },
    pathEntryExists: async (p: string) => { try { await fs.lstat(p); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error;
    } },
    app: { getAppPath: () => process.cwd() }, process,
    resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    writePhotoshopLayeredTiffsForInPlaceSave,
    stagePendingDeletedShotFiles: async (p: Project) => { effects.push("stage"); return { project: p }; },
    assertRenamePlanSafe: async () => { effects.push("rename-preflight"); },
    importProjectToSwbFormat: async (p: Project) => { effects.push("import-fixture"); return { project: p, tiffWriteShotIds: [], rollback: async () => { effects.push("import-rollback"); } }; },
    saveProgressShotIds, countSaveProgressShots,
    clearSavedImageLayerEdits: (p: Project) => p,
    syncSavedSwbBaseFingerprints: async (p: Project) => ({ ...p, shots: await Promise.all(p.shots.map(async s => ({ ...s, swb: { ...s.swb!, baseFingerprint: await pixelFingerprint(s.imagePath) } }))) }),

    recoverFailedSave,
    trashPendingDeletedShotFiles: async (p: Project) => { effects.push("synthetic-trash"); return { project: p, error: fault === "trash" ? new Error("synthetic Trash failure") : undefined }; },
    cleanupDeletedShotLayerDirectories: async () => { effects.push("cleanup"); if (fault === "cleanup") throw new Error("cleanup failed"); }
  };
  const helperNames = ["sharpSourceOptions", "swbFormatVersion", "swbXmpTag", "archiveStamp", "shouldWriteSwbMetadata", "shouldWritePhotoshopLayeredTiffOnSave", "bakeShotToWorkingTiff", "bakeBitmapLayersToTiff", "bakeSketchOverlayToTiff", "sketchLayersForShot", "swbMetadataForShot", "swbMetadataXmp", "writeSwbMetadataToTiffs", "preparePhotoshopLayeredTiffsForSave", "saveWorkspace", "writeProjectFiles", "writeProjectMetadata", "writeStoryboardScriptMarkdown", "storyboardScriptPathForFolder"];
  // New admission/ACK helpers, if present, are executed rather than mocked.
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  for (const name of ["assertNormalSaveAdmission", "normalSaveOutputAcks"]) {
    if (tree.statements.some(s => ts.isVariableStatement(s) && s.declarationList.declarations[0].name.getText(tree) === name)) helperNames.push(name);
  }
  let pendingCall: ts.CallExpression | undefined;
  const findPending = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(tree) === "createWorkspacePendingAppHandlers") pendingCall = node; ts.forEachChild(node, findPending); }; findPending(tree);
  helperNames.push("uniquePath");
  const chain = actual(helperNames, bindings, `({ save: saveWorkspace, persist: writeProjectFiles, pending: ${pendingCall!.getText(tree)} })`);
  return { root, p, imagePath, metadataPath, mdPath, original, sentinel, effects, save: chain.save, persist: chain.persist, pending: chain.pending,
    setFault: (value: typeof fault) => { fault = value; },
    useActualDeletionPorts: () => {
      // Only shell Trash is substituted: real staging and cleanup use real files.
      Object.assign(bindings, { stagePendingDeletedShotFiles: (p: Project) => stagePendingDeletedShotFiles(p, root),
      trashPendingDeletedShotFiles: (p: Project) => trashPendingDeletedShotFiles(p, { trashItem: async file => {
        effects.push("actual-trash-fixture"); await fs.rename(file, path.join(root, "owned-trashed.tiff"));
      } }), cleanupDeletedShotLayerDirectories });
      return actual(helperNames, bindings, "saveWorkspace");
    },
    setBeforeEnsure: (hook: () => Promise<void>) => { beforeEnsure = hook; },
    payload: { project: p, folderPath: root, metadataPath, dirtyShotIds: [], normalSave: true } };
}

it("actual Save retains installed TIFF and backups when required MD fails after JSON publication", async () => {
  const f = await fixture("md");
  await expect(f.save({ ...f.payload, dirtyShotIds: ["s"] })).rejects.toMatchObject({ recoveryIncomplete: true });
  expect(f.effects).toContain("json");
  expect(f.effects).not.toContain("import-rollback");
  const written = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  expect(written.shots[0].swb.baseFingerprint).toBe(await pixelFingerprint(f.imagePath));
  expect(await fs.readFile(f.imagePath)).not.toEqual(f.original);
  const backupRoot = path.join(f.root, ".storyboard-workbench/save-tmp");
  const backups = await fs.readdir(backupRoot, { recursive: true });
  const backup = backups.find(name => name.endsWith(path.join(".backups", "0.tiff")));
  expect(backup).toBeDefined();
  expect(await fs.readFile(path.join(backupRoot, backup!))).toEqual(f.original);
});

it.each([false, true])("actual main staging/Trash/cleanup → plain adapter → owner retires deletion (last=%s)", async last => {
  const f = await fixture();
  f.p.shots[1].layers = [];
  if (last) { f.p.shots = [f.p.shots[0]]; delete f.p.pendingBake!.shots.untouched; }
  const save = f.useActualDeletionPorts();
  const ref = { current: f.p }; let completion: unknown;
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t-deletion",
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {}, api: () => ({
      readOutputIdentity: hash, saveWorkspace: async payload => { const result = await save(payload); completion = JSON.parse(JSON.stringify(result)); return completion as typeof payload; },
      autosaveWorkspace: async payload => f.persist(payload.metadataPath, payload.folderPath, payload.project)
    }) });
  const before = structuredClone(ref.current);
  expect(adapter.owner.publishEdit(deleteShots(ref.current, ["s"]), [])).toBe(true);
  expect(await adapter.owner.save()).toBe(true);
  expect((completion as { normalSaveDeletions: unknown }).normalSaveDeletions).toEqual([{ shotId: "s", sourcePath: f.imagePath }]);
  expect(f.effects.filter(s => s === "actual-trash-fixture")).toHaveLength(1);
  await expect(fs.stat(f.imagePath)).rejects.toHaveProperty("code", "ENOENT");
  await expect(fs.stat(path.join(f.root, ".storyboard-workbench/layers/s"))).rejects.toHaveProperty("code", "ENOENT");
  const disk = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  expect(disk.pendingDeletedShots).toEqual([]); expect(disk.pendingBake.shots.s).toBeUndefined();
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(ref.current));
  // Recreate the exact original bytes after actual Save; the retired private
  // witness is still absent and old metadata History must not acquire permission.
  await fs.writeFile(f.imagePath, f.original);
  const saved = ref.current;
  expect(await adapter.owner.publishMetadataHistory(before, ["s"])).toBe(false); expect(ref.current).toBe(saved);
});

it.each(["json", "md"] as const)("actual deletion receipt retries required %s without another output/Trash", async fault => {
  const f = await fixture(); f.p.shots = [f.p.shots[0]]; delete f.p.pendingBake!.shots.untouched;
  const save = f.useActualDeletionPorts(), ref = { current: f.p }; let outputs = 0;
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t-retry",
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {}, api: () => ({
      readOutputIdentity: hash, saveWorkspace: async payload => { outputs++; const result = await save(payload); f.setFault(fault); return JSON.parse(JSON.stringify(result)); },
      autosaveWorkspace: async payload => f.persist(payload.metadataPath, payload.folderPath, payload.project)
    }) });
  const before = ref.current;
  expect(adapter.owner.publishEdit(deleteShots(before, ["s"]), [])).toBe(true);
  expect(await adapter.owner.save()).toBe(false); expect(adapter.owner.hasUnsavedWork()).toBe(true);
  expect(await adapter.owner.autosave()).toBe(false);
  expect(await adapter.owner.publishMetadataHistory(before, ["s"])).toBe(false);
  f.setFault(undefined); expect(await adapter.owner.save()).toBe(true);
  expect(outputs).toBe(1); expect(f.effects.filter(e => e === "actual-trash-fixture")).toHaveLength(1);
  const disk = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  expect(disk.pendingDeletedShots).toEqual([]); expect(disk.pendingBake.shots).toEqual({});
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(ref.current));
});

it.each(["missing", "changed"])("actual deleted root %s rejects before staging or Trash", async kind => {
  const f = await fixture(); const save = f.useActualDeletionPorts();
  const deleted = deleteShots(f.p, ["s"]);
  if (kind === "missing") await fs.unlink(f.imagePath); else await fs.writeFile(f.imagePath, "changed owned fixture");
  await expect(save({ ...f.payload, project: deleted })).rejects.toThrow();
  expect(f.effects).toEqual([]);
  expect(deleted.pendingDeletedShots).toHaveLength(1); expect(deleted.pendingBake!.shots.s.state).toBe("pending");
});

async function actualAppPending(adapter: ReturnType<typeof createNormalSaveAppAdapter>) {
  const source = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "pendingTransition") decl = n; ts.forEachChild(n, visit); }; visit(tree);
  expect(decl).toBeDefined();
  return new Function("renderAdapter", "useCallback", "normalSaveAppAdapterRef", ts.transpile(`const ${decl!.getText(tree)}; return pendingTransition;`))(adapter, (fn: unknown) => fn, { current: adapter }) as typeof adapter.pending;
}
async function actualAppAutosave(adapter: ReturnType<typeof createNormalSaveAppAdapter>, folderPath: string, metadataPath: string) {
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "persistWorkspace") declaration = n; ts.forEachChild(n, visit); }; visit(tree);
  return new Function("renderAdapter", "normalSaveAppEnabled", "normalSaveAppAdapterRef", "folderPath", "metadataPath", ts.transpile(`const ${declaration!.getText(tree)}; return persistWorkspace;`))(adapter, true, { current: adapter }, folderPath, metadataPath);
}
async function actualAppPendingPublication(schedule: () => void) {
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.PropertyAssignment | undefined;
  const visit = (n: ts.Node) => { if (ts.isPropertyAssignment(n) && n.name.getText(tree) === "onPendingPublication" && ts.isArrowFunction(n.initializer) && n.initializer.parameters[0]?.name.getText(tree).includes("durable")) callback = n; ts.forEachChild(n, visit); }; visit(tree);
  expect(callback).toBeDefined();
  return new Function("setAutosaveRevision", "setFileNameSyncState", "fileNameSyncStateRef", "setWorkspaceSaveState", "workspaceSaveStateRef", "rebasePendingHistory", ts.transpile(`return (${callback!.initializer.getText(tree)});`))(schedule, () => {}, {}, () => {}, {}, () => {}) as (result: { durable: boolean }) => void;
}
it.each(["park", "restore"] as const)("Pending %s late persist reconnects the actual autosave timer after a queued stale capture", async kind => {
  const { registerWorkspaceAutosave } = await import("../../src/renderer/workspaceAutosaveController");
  const f = await fixture(), projectRef = { current: f.p }, queue = createBitmapLayerWriteQueue();
  let schedule: (() => void) | undefined, entered!: () => void, release!: () => void;
  const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
  const callbacks: (() => void)[] = [], writes: Project[] = [];
  let delayed = false;
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => "t3",
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: f.pending.moveShotsToPending, restoreShotsFromPending: f.pending.restoreShotsFromPending,
      autosaveWorkspace: async payload => { writes.push(payload.project); if (delayed) { delayed = false; entered(); await gate; } await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {},
    onPendingPublication: await actualAppPendingPublication(() => schedule!())
  } as Parameters<typeof createNormalSaveAppAdapter>[0]);
  const persistWorkspace = await actualAppAutosave(adapter, f.root, f.metadataPath);
  schedule = () => { registerWorkspaceAutosave({ autosaveRevision: 1, folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath }, hasStoryboardApi: true, projectRef,
    persistWorkspace, setWorkspaceSaveState: () => {}, setAutosaveError: () => {}, setStatus: () => {},
    timers: { setTimeout: cb => { callbacks.push(cb); return callbacks.length; }, clearTimeout: () => {} } }); };
  const pending = await actualAppPending(adapter);
  if (kind === "restore") expect(await pending("park", p => parkShotGroup(p, ["s"]), ["s"])).toBe(true);
  delayed = true;
  const operation = pending(kind, p => kind === "park" ? parkShotGroup(p, ["s"]) : restoreParkedShotGroup(p, ["s"], "untouched", "before"), ["s"]);
  await started;
  adapter.owner.publishEdit(p => ({ ...p, name: "P3" }), ["s"]);
  schedule(); callbacks.shift()!(); // the real timer queues old P3 behind Pending
  release(); expect(await operation).toBe(false); await queue.runExclusive(async () => {});
  expect(callbacks, "publication must request one latest ordinary autosave").toHaveLength(1);
  callbacks.shift()!(); await queue.runExclusive(async () => {});
  const disk = await readProjectMetadata<Project>(f.metadataPath);
  expect(disk).toEqual(projectRef.current); expect(disk!.name).toBe("P3");
  const shot = [...disk!.shots, ...(disk!.parkedShots ?? [])].find(s => s.id === "s")!;
  expect(disk!.pendingBake!.shots.s).toMatchObject({ editToken: "t3", acceptedOutputIdentity: await hash(shot.imagePath) });
  expect(shot.imagePath).toBe(kind === "park" ? path.join(f.root, "Pending/s.tiff") : f.imagePath);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(disk!));
  expect(writes.filter(p => p.name === "P3")).toHaveLength(1); expect(callbacks).toHaveLength(0);
});

it("Pending actual main materializes before move, ACKs H1, persists latest JSON/required MD then restores", async () => {
  const f = await fixture(), projectRef = { current: f.p }, queue = createBitmapLayerWriteQueue();
  let token = 1;
  f.p.pendingBake!.shots.untouched = { ...f.p.pendingBake!.shots.untouched, state: "pending", editToken: "other-token" };
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => `t${++token}`,
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: f.pending.moveShotsToPending, restoreShotsFromPending: f.pending.restoreShotsFromPending,
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {} });
  const pending = await actualAppPending(adapter);
  expect(await pending("park", p => parkShotGroup(p, ["s"]), ["s"])).toBe(true);
  const parked = projectRef.current.parkedShots![0], h1 = await hash(parked.imagePath);
  expect(parked.imagePath).toBe(path.join(f.root, "Pending/s.tiff")); expect(h1).not.toBe(f.p.pendingBake!.shots.s.acceptedOutputIdentity);
  expect(projectRef.current.pendingBake!.shots.s).toMatchObject({ state: "synced", acceptedOutputIdentity: h1 });
  expect(projectRef.current.pendingBake!.shots.untouched.editToken).toBe("other-token");
  const disk = await readProjectMetadata<Project>(f.metadataPath); expect(disk).toEqual(projectRef.current);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(projectRef.current));
  expect(await fs.readFile(f.sentinel)).toEqual(f.original);
  expect(await pending("restore", p => restoreParkedShotGroup(p, ["s"], "untouched", "before"), ["s"])).toBe(true);
  const restored = projectRef.current.shots.find(s => s.id === "s")!;
  expect(restored.imagePath).toBe(f.imagePath); expect(await hash(restored.imagePath)).toBe(h1);
  const { createShotPresentationController } = await import("../../src/renderer/shotPresentationController");
  const { readLayerAssetSnapshots } = await import("../../src/renderer/bitmapLayerHistory");
  const { readLayerPng, writeLayerPng, deleteLayerPng } = await import("./layerAssetService");
  const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  const transparent = dataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const raster = (_width: number, _height: number) => transparent;
  const api = { readLayerPng, writeLayerPng, deleteLayerPng, ensureLayerAssets: async () => { for (const s of projectRef.current.shots) for (const l of s.layers ?? []) await fs.readFile(path.join(f.root, l.bitmapPath)); } } as any;
  const presentation = createShotPresentationController({ api, bitmapLayerWriteQueueRef: { current: queue },
    createHistoryEntry: async paths => ({ project: projectRef.current, fileNameSyncState: "unsynced", selectedShotIds: [], layerAssets: await readLayerAssetSnapshots(api, f.root, paths ?? []) }),
    expandBitmapLayer: async (source, _layer, top, bottom) => dataUrl(await sharp(Buffer.from(source.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()),
    createMatteOverlay: raster, createDialogueOverlay: raster,
    folderPath: f.root, metadataPath: f.metadataPath, projectRef, markShotsDirty: () => {}, recordUndoEntry: () => {}, setStatus: () => {}, shotPresentationActionRef: { current: undefined },
    updateProject: update => { adapter.owner.publishEdit(update, ["s"]); } });
  expect(await presentation.handleInheritSceneMatte(projectRef.current, "expanded", ["s"], { dialogueOverlayEnabled: false, expectedProject: projectRef.current, recordUndo: false })).toBe(true);
  expect(projectRef.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "t2", acceptedOutputIdentity: h1 });
  adapter.owner.publishEdit(p => ({ ...p, dialogues: [{ id: "d", shotId: "s", order: 0, text: "Caption" }] }), ["s"]);
  const prior = projectRef.current.pendingBake!.shots.s.editToken;
  expect(await presentation.handleInheritSceneMatte(projectRef.current, "expanded", ["s"], { dialogueOverlayEnabled: true, expectedProject: projectRef.current, recordUndo: false })).toBe(true);
  expect(projectRef.current.pendingBake!.shots.s.editToken).not.toBe(prior);
  expect(projectRef.current.shots.find(s => s.id === "s")!.layers!.at(-1)!.id).toBe("layer-dialogue-overlay");
  expect(projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity).toBe(h1);
  expect(await hash(f.imagePath)).toBe(h1);
});
it("automatic parked migration executes actual disk reader, main materializer/move and required JSON/MD within one queue", async () => {
  const f = await fixture(), projectRef = { current: f.p }, queue = createBitmapLayerWriteQueue();
  const oldParked = parkShotGroup(f.p, ["s"]); await f.persist(f.metadataPath, f.root, oldParked);
  let paths = { folderPath: "/old", metadataPath: "/old/p.json" }, release!: () => void;
  const gate = new Promise<void>(r => release = r), admitted = queue.runExclusive(() => gate); let read = false;
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => "t2",
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: f.pending.moveShotsToPending, restoreShotsFromPending: f.pending.restoreShotsFromPending,
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => paths, onSave: () => {}, onError: () => {} });
  const operation = adapter.load(async () => { read = true; return { folderPath: f.root, metadataPath: f.metadataPath, folderName: "Synthetic", images: [], project: await readProjectMetadata<Project>(f.metadataPath) }; }, () => { paths = { folderPath: f.root, metadataPath: f.metadataPath }; });
  await Promise.resolve(); expect(read).toBe(false); release(); await admitted;
  expect(await operation).toBe(true);
  const parked = projectRef.current.parkedShots![0]; expect(parked.imagePath).toBe(path.join(f.root, "Pending/s.tiff"));
  expect(await hash(parked.imagePath)).not.toBe(oldParked.pendingBake!.shots.s.acceptedOutputIdentity);
  expect(await readProjectMetadata<Project>(f.metadataPath)).toEqual(projectRef.current);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(projectRef.current));
});
it.each(["park", "restore", "auto"] as const)("Pending actual %s late runtime ACK preserves concurrent P2 and t2 on disk", async kind => {
  const f = await fixture(), projectRef = { current: kind === "park" ? f.p : parkShotGroup(f.p, ["s"]) }, queue = createBitmapLayerWriteQueue();
  if (kind === "restore") {
    const files = await f.pending.moveShotsToPending({ ...f.payload, project: projectRef.current }, ["s"]);
    projectRef.current = { ...projectRef.current, parkedShots: projectRef.current.parkedShots!.map(s => ({ ...s, imagePath: files[0].imagePath, fileName: files[0].fileName })), pendingBake: { version: 1, shots: { ...projectRef.current.pendingBake!.shots, s: { state: "synced", acceptedOutputIdentity: await hash(files[0].imagePath) } } } };
  }
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => release = r), actualDone = new Promise<void>(r => entered = r);
  const delayed = async (payload: any, ids: string[]) => { const files = await f.pending[kind === "restore" ? "restoreShotsFromPending" : "moveShotsToPending"](payload, ids); entered(); await gate; return files; };
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => "t2",
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: delayed, restoreShotsFromPending: delayed,
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {} });
  const operation = kind === "auto"
    ? adapter.load(async () => ({ folderPath: f.root, metadataPath: f.metadataPath, folderName: "Synthetic", images: [], project: projectRef.current }), () => {})
    : adapter.pending(kind, p => kind === "park" ? parkShotGroup(p, ["s"]) : restoreParkedShotGroup(p, ["s"], "untouched", "before"), ["s"]);
  await actualDone; adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), ["s"]); release();
  expect(await operation).toBe(true);
  const final = projectRef.current, shot = [...final.shots, ...(final.parkedShots ?? [])].find(s => s.id === "s")!;
  expect(final.name).toBe("P2"); expect(final.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "t2", acceptedOutputIdentity: await hash(shot.imagePath) });
  expect(await readProjectMetadata<Project>(f.metadataPath)).toEqual(final);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(final));
});
it("Pending required MD fault after real move retains H1 unknown and blocks subsequent autosave", async () => {
  const f = await fixture(), projectRef = { current: f.p };
  await f.persist(f.metadataPath, f.root, f.p);
  const oldMd = await fs.readFile(f.mdPath), pngPath = path.join(f.root, f.p.shots[0].layers![0].bitmapPath), png = await fs.readFile(pngPath);
  const { historyFixture } = await import("../../research/save-pending-revision2/history-fixture");
  let historyAssetEffects = 0;
  const historyApi = { readLayerPng: async () => { historyAssetEffects++; return `data:image/png;base64,${png.toString("base64")}`; }, writeLayerPng: async () => { historyAssetEffects++; }, deleteLayerPng: async () => { historyAssetEffects++; } };
  const history = await historyFixture(projectRef, historyApi, f.root);
  history.controller.recordUndoEntry({ project: f.p, selectedShotIds: ["s"], fileNameSyncState: "synced", layerAssets: [{ bitmapPath: f.p.shots[0].layers![0].bitmapPath, dataUrl: `data:image/png;base64,${png.toString("base64")}` }] });
  f.setFault("md");
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t2",
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: f.pending.moveShotsToPending, restoreShotsFromPending: f.pending.restoreShotsFromPending,
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {} });
  expect(await adapter.pending("park", p => parkShotGroup(p, ["s"]), ["s"])).toBe(false);
  expect(projectRef.current.parkedShots![0].imagePath).toBe(path.join(f.root, "Pending/s.tiff"));
  expect(projectRef.current.pendingBake!.shots.s.state).toBe("unknown"); expect(await adapter.autosave(projectRef.current)).toBe(false);
  expect(adapter.owner.lastError).toBeDefined();
  const target = path.join(f.root, "Pending/s.tiff"), targetBytes = await fs.readFile(target);
  expect(targetBytes).not.toEqual(f.original); expect(await hash(target)).toBe(projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity);
  await expect(fs.readFile(f.imagePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(pngPath)).toEqual(png); expect(await fs.readFile(f.mdPath)).toEqual(oldMd);
  const disk = await readProjectMetadata<Project>(f.metadataPath);
  expect(disk!.parkedShots![0].imagePath).toBe(target);
  expect(disk!.pendingBake!.shots.s.state).toBe("synced");
  expect(disk!.pendingBake!.shots.s.acceptedOutputIdentity).toBe(await hash(target));
  const jsonBytes = await fs.readFile(f.metadataPath), uncertainProject = projectRef.current;
  await history.controller.applyUndoEntry();
  expect(historyAssetEffects).toBe(0); expect(projectRef.current).toBe(uncertainProject);
  expect(await fs.readFile(f.metadataPath)).toEqual(jsonBytes); expect(await fs.readFile(target)).toEqual(targetBytes);
  expect(await fs.readFile(pngPath)).toEqual(png); expect(await fs.readFile(f.mdPath)).toEqual(oldMd);
  // JSON was installed; MD was not. Unknown is a conservative runtime marker,
  // not evidence that disk rollback or crash recovery completed.
  expect(await fs.readFile(f.sentinel)).toEqual(f.original);
});
it("actual restore drag and presentation inherit the late scene with real PNG ports", async () => {
  const { useStoryboardDragEndController } = await import("../../src/renderer/storyboardDragEndController");
  const { createShotPresentationController } = await import("../../src/renderer/shotPresentationController");
  const { readLayerAssetSnapshots } = await import("../../src/renderer/bitmapLayerHistory");
  const { readLayerPng, writeLayerPng, deleteLayerPng } = await import("./layerAssetService");
  const { applyProjectMatte } = await import("../../src/shared/projectOps");
  const f = await fixture(), projectRef = { current: f.p }, queue = createBitmapLayerWriteQueue();
  const moved = deferredChain(), gate = deferredChain(), finished = deferredChain(); let delaying = false;
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => "inherit-fresh", paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {},
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: f.pending.moveShotsToPending,
      restoreShotsFromPending: async (payload, ids) => { const files = await f.pending.restoreShotsFromPending(payload, ids); if (delaying) { moved.release(); await gate.promise; } return files; },
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }) });
  const pending = await actualAppPending(adapter); expect(await pending("park", p => parkShotGroup(p, ["s"]), ["s"])).toBe(true);
  const png = async (width: number, height: number) => `data:image/png;base64,${(await sharp({ create: { width, height, channels: 4, background: "transparent" } }).png().toBuffer()).toString("base64")}`;
  const raster = await png(4, 3);
  const api = { readLayerPng, writeLayerPng, deleteLayerPng, ensureLayerAssets: async () => {} } as any;
  const presentation = createShotPresentationController({ api, bitmapLayerWriteQueueRef: { current: queue }, folderPath: f.root, metadataPath: f.metadataPath, projectRef,
    shotPresentationActionRef: { current: undefined }, createHistoryEntry: async paths => ({ project: projectRef.current, selectedShotIds: [], fileNameSyncState: "unsynced", layerAssets: await readLayerAssetSnapshots(api, f.root, paths ?? []) }),
    createMatteOverlay: () => raster, createDialogueOverlay: () => raster, expandBitmapLayer: async () => raster, markShotsDirty: () => {}, recordUndoEntry: () => {}, setStatus: () => {},
    updateProject: update => { adapter.owner.publishEdit(update, ["s"]); } });
  const c = adapter.owner.capture(); const statuses: string[] = [];
  const controller = useStoryboardDragEndController({ projectRef, selectedShotIdsRef: { current: ["s"] }, pendingTransition: pending,
    capturePendingScope: () => () => c.epoch === adapter.owner.capture().epoch, pendingVersion: () => adapter.owner.capture().sequence,
    inheritSceneMatte: presentation.handleInheritSceneMatte, clearShotsDirty: () => {}, resetHistoryStacks: () => { throw new Error("must not reset concurrent history"); }, updateProject: () => {},
    flushInsertionTargetsFromDragEnd: () => ({ storyboardInsertionTarget: { targetShotId: "untouched", placement: "before" }, parkingInsertionTarget: undefined }),
    isDragEndInsideParkingShelf: () => false, isDragEndInsideStoryboard: () => true, isDragEndPointerInsideStoryboard: () => true,
    moveShotFilesToPending: async p => p, restoreShotFilesFromPending: async p => p, promoteAiCandidateToStoryboard: async () => {}, queuePasteAnimation: () => {}, resetActiveDragState: () => {}, selectSingleShot: () => {}, setDeleteTarget: () => {},
    setStatus: status => { statuses.push(status); if (status !== "Restoring storyboard from Pending...") finished.release(); } });
  delaying = true;
  controller.handleDragEnd({ active: { data: { current: { type: "parked-shot", shotId: "s" } } }, over: { data: { current: { type: "shot", shotId: "untouched" } } } } as any);
  await moved.promise; adapter.owner.publishEdit(p => applyProjectMatte(p, "embedded", ["untouched"]), ["untouched"]); gate.release(); await finished.promise;
  expect(statuses.at(-1)).toBe("Storyboard restored from Pending");
  const restored = projectRef.current.shots.find(s => s.id === "s")!;
  expect(restored.presentation?.matte?.mode).toBe("embedded"); expect(projectRef.current.pendingBake!.shots.s.editToken).toBe("inherit-fresh");
  expect(await fs.readFile(path.join(f.root, restored.layers!.find(l => l.id === "layer-matte-overlay")!.bitmapPath))).toEqual(Buffer.from(raster.split(",")[1], "base64"));
});

it("Pending source change after actual move preserves moved TIFF, latest source and internal PNG", async () => {
  const f = await fixture(), projectRef = { current: f.p }, gate = deferredChain(), entered = deferredChain();
  const pngPath = path.join(f.root, f.p.shots[0].layers![0].bitmapPath), png = await fs.readFile(pngPath);
  const changedPath = path.join(f.root, "changed.tiff"); await fs.writeFile(changedPath, f.original);
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t2",
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, restoreShotsFromPending: f.pending.restoreShotsFromPending,
      moveShotsToPending: async (payload, ids) => { const files = await f.pending.moveShotsToPending(payload, ids); entered.release(); await gate.promise; return files; },
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {} });
  const operation = (await actualAppPending(adapter))("park", p => parkShotGroup(p, ["s"]), ["s"]); await entered.promise;
  const moved = path.join(f.root, "Pending/s.tiff"), movedBytes = await fs.readFile(moved);
  adapter.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => s.id === "s" ? { ...s, imagePath: changedPath } : s) }), []);
  gate.release(); expect(await operation).toBe(false);
  expect(projectRef.current.shots[0].imagePath).toBe(changedPath); expect(projectRef.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await fs.readFile(moved)).toEqual(movedBytes); expect(await fs.readFile(changedPath)).toEqual(f.original); expect(await fs.readFile(pngPath)).toEqual(png);
  await expect(fs.readFile(f.imagePath)).rejects.toMatchObject({ code: "ENOENT" });
});
it("combined actual restore expanded inheritance prunes old metadata Undo and preserves new bitmap and metadata history", async () => {
  const { useStoryboardDragEndController } = await import("../../src/renderer/storyboardDragEndController");
  const { createShotPresentationController } = await import("../../src/renderer/shotPresentationController");
  const { readLayerAssetSnapshots } = await import("../../src/renderer/bitmapLayerHistory");
  const { readLayerPng, writeLayerPng, deleteLayerPng } = await import("./layerAssetService");
  const { applyProjectMatte } = await import("../../src/shared/projectOps");
  const f = await fixture(), projectRef = { current: f.p };
  const { historyFixture } = await import("../../research/save-pending-revision2/history-fixture");
  const api = { readLayerPng, writeLayerPng, deleteLayerPng, ensureLayerAssets: async () => {} } as any;
  const h = await historyFixture(projectRef, api, f.root), queue = h.queue;
  const moved = deferredChain(), gate = deferredChain(), finished = deferredChain(); let delaying = false;
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => "inherit-fresh", paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: () => {}, onError: () => {}, onPendingPublication: result => { if (result.namespace) { const n = result.namespace; h.controller.rebasePendingHistory(n.before, n.after, n.ids, n.update); } },
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, moveShotsToPending: f.pending.moveShotsToPending,
      restoreShotsFromPending: async (payload, ids) => { const files = await f.pending.restoreShotsFromPending(payload, ids); if (delaying) { moved.release(); await gate.promise; } return files; },
      autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }) });
  const pending = await actualAppPending(adapter); expect(await pending("park", p => parkShotGroup(p, ["s"]), ["s"])).toBe(true);
  const png = async (width: number, height: number) => `data:image/png;base64,${(await sharp({ create: { width, height, channels: 4, background: "transparent" } }).png().toBuffer()).toString("base64")}`;
  const raster = await png(4, 3), expandedRaster = await png(4, 153);
  const presentation = createShotPresentationController({ api, bitmapLayerWriteQueueRef: { current: queue }, folderPath: f.root, metadataPath: f.metadataPath, projectRef,
    shotPresentationActionRef: { current: undefined }, createHistoryEntry: async paths => ({ project: projectRef.current, selectedShotIds: [], fileNameSyncState: "unsynced", layerAssets: await readLayerAssetSnapshots(api, f.root, paths ?? []) }),
    invalidatePresentationHistory: h.controller.invalidatePresentationHistory,
    createMatteOverlay: () => expandedRaster, createDialogueOverlay: () => raster,
    expandBitmapLayer: async (source, layer) => `data:image/png;base64,${(await sharp(Buffer.from(source.split(",")[1], "base64")).extend({ top: 75, bottom: 75, left: 0, right: 0, background: "transparent" }).png().toBuffer()).toString("base64")}`, markShotsDirty: () => {}, recordUndoEntry: () => {}, setStatus: () => {},
    updateProject: update => { adapter.owner.publishEdit(update, ["s"]); } });
  const c = adapter.owner.capture(); const statuses: string[] = [];
  const controller = useStoryboardDragEndController({ projectRef, selectedShotIdsRef: { current: ["s"] }, pendingTransition: pending,
    capturePendingScope: () => () => c.epoch === adapter.owner.capture().epoch, pendingVersion: () => adapter.owner.capture().sequence,
    inheritSceneMatte: presentation.handleInheritSceneMatte, clearShotsDirty: () => {}, resetHistoryStacks: () => { throw new Error("must not reset concurrent history"); }, updateProject: () => {},
    flushInsertionTargetsFromDragEnd: () => ({ storyboardInsertionTarget: { targetShotId: "untouched", placement: "before" }, parkingInsertionTarget: undefined }),
    isDragEndInsideParkingShelf: () => false, isDragEndInsideStoryboard: () => true, isDragEndPointerInsideStoryboard: () => true,
    moveShotFilesToPending: async p => p, restoreShotFilesFromPending: async p => p, promoteAiCandidateToStoryboard: async () => {}, queuePasteAnimation: () => {}, resetActiveDragState: () => {}, selectSingleShot: () => {}, setDeleteTarget: () => {},
    setStatus: status => { statuses.push(status); if (status !== "Restoring storyboard from Pending...") finished.release(); } });
  delaying = true;
  controller.handleDragEnd({ active: { data: { current: { type: "parked-shot", shotId: "s" } } }, over: { data: { current: { type: "shot", shotId: "untouched" } } } } as any);
  await moved.promise; h.controller.recordProjectUndoEntry(); adapter.owner.publishEdit(p => applyProjectMatte(p, "expanded", ["untouched"]), ["untouched"]); gate.release(); await finished.promise;
  expect(statuses.at(-1)).toBe("Storyboard restored from Pending");
  const restored = projectRef.current.shots.find(s => s.id === "s")!;
  expect(restored.presentation?.matte?.mode).toBe("expanded"); expect(projectRef.current.pendingBake!.shots.s.editToken).toBe("inherit-fresh");
  expect(await fs.readFile(path.join(f.root, restored.layers!.find(l => l.id === "layer-matte-overlay")!.bitmapPath))).toEqual(Buffer.from(expandedRaster.split(",")[1], "base64"));
  const contentPath = path.join(f.root, restored.layers!.find(l => l.kind === "image")!.bitmapPath);
  const expandedBytes = await fs.readFile(contentPath);
  expect((await sharp(expandedBytes).metadata()).height).toBe(153);
  await h.controller.applyUndoEntry();
  expect(h.status).toHaveBeenLastCalledWith("Nothing to undo");
  expect(projectRef.current.shots.find(s => s.id === "s")!.swb!.canvasHeight).toBe(153);
  expect(await fs.readFile(contentPath)).toEqual(expandedBytes);
  // New, recoverable metadata history remains live after finite pruning.
  h.controller.recordProjectUndoEntry(); const oldName = projectRef.current.name;
  projectRef.current = { ...projectRef.current, name: "new independent edit" };
  await h.controller.applyUndoEntry(); expect(projectRef.current.name).toBe(oldName);
  await h.controller.applyRedoEntry(); expect(projectRef.current.name).toBe("new independent edit");
  const bitmapPath = restored.layers!.find(l => l.kind === "image")!.bitmapPath;
  const bitmapEntry = await h.controller.createHistoryEntry([bitmapPath]);
  h.controller.recordUndoEntry(bitmapEntry); await fs.writeFile(contentPath, Buffer.from(expandedRaster.split(",")[1], "base64"));
  await h.controller.applyUndoEntry(); expect(await fs.readFile(contentPath)).toEqual(expandedBytes);
  expect(projectRef.current.shots.find(s => s.id === "s")!.imagePath).toBe(restored.imagePath);
});

const deferredChain = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
it("M2 real App adapter → actual main rename/bake → latest P2 JSON/MD with t2 retained", async () => {
  const f = await fixture(); const projectRef = { current: f.p }; const savedUi: boolean[] = [];
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t2",
    api: () => ({ readOutputIdentity: hash, saveWorkspace: f.save, autosaveWorkspace: async payload => { await f.persist(payload.metadataPath, payload.folderPath, payload.project); return payload; } }),
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), onSave: saved => savedUi.push(saved), onError: error => { throw error; } });
  f.setBeforeEnsure(async () => { adapter.owner.publishEdit(current => ({ ...current, name: "P2" }), ["s"]); });
  expect(await adapter.save()).toBe(false);
  const shot = projectRef.current.shots[0];
  expect(shot.imagePath).not.toBe(f.imagePath); expect(shot.fileName).not.toBe("s.tiff");
  expect(projectRef.current.name).toBe("P2");
  expect(projectRef.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "t2", acceptedOutputIdentity: await hash(shot.imagePath) });
  const disk = (await readProjectMetadata<Project>(f.metadataPath))!;
  expect(disk.name).toBe("P2"); expect(disk.shots[0]).toEqual(shot);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(projectRef.current));
  expect(savedUi).toEqual([false]);
  expect(await fs.readFile(projectRef.current.shots[1].imagePath)).toEqual(f.original);
});

it("reviewed owner uses actual main chain across normal autosave and queued disk-reader reload, then accepts real TIFF/JSON/MD", async () => {
  const f = await fixture();
  const ref = { current: f.p }; let token = 0;
  const owner = createNormalSaveProjectOwner({
    projectRef: ref, setProject: () => undefined, freshToken: () => `edit-${++token}`,
    queue: createBitmapLayerWriteQueue(), readIdentity: s => hash(s.imagePath),
    persist: p => f.persist(f.metadataPath, f.root, p),
    output: async (p, ids) => (await f.save({ ...f.payload, project: p, dirtyShotIds: ids })).normalSaveOutputs
  });
  const controller = useLayerMetadataActionController({
    markShotsDirty: () => undefined, setDeleteTarget: () => undefined, shotSelectionAnchorIdRef: { current: undefined },
    updateProject: update => owner.publishEdit(update, ["s"])
  });
  controller.handleUpdateLayer("s", "base", { opacity: 0.25 });
  expect(await owner.autosave()).toBe(true);
  await owner.load(() => Promise.resolve(createProject("B")));
  await owner.load(async () => (await readProjectMetadata<Project>(f.metadataPath))!);
  expect(ref.current.pendingBake!.shots.s.editToken).toBe("edit-1");
  expect(await owner.save()).toBe(true);
  expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake!.shots.s).toEqual({ state: "synced", acceptedOutputIdentity: await hash(f.imagePath) });
  // Existing sharp single-layer alpha quantization: floor(255*0.25)=63, white complement=192.
  expect([...((await sharp(f.imagePath).ensureAlpha().raw().toBuffer()).subarray(0, 4))]).toEqual([255, 192, 192, 255]);
  expect(await fs.readFile(f.sentinel)).toEqual(f.original);
});
it("actual final JSON-written/MD-failed persist makes owner false, blocks autosave, and retains safe receipt retry", async () => {
  const f = await fixture(); const ref = { current: f.p };
  let outputs = 0;
  const owner = createNormalSaveProjectOwner({
    projectRef: ref, setProject: () => undefined, freshToken: () => "new-token",
    queue: createBitmapLayerWriteQueue(), readIdentity: s => hash(s.imagePath),
    persist: p => f.persist(f.metadataPath, f.root, p),
    output: async (p, ids) => { outputs++; const result = await f.save({ ...f.payload, project: p, dirtyShotIds: ids }); f.setFault("md"); return result.normalSaveOutputs; }
  });
  expect(await owner.save()).toBe(false);
  expect((owner.lastError as Error).message).toBe("required MD failed after JSON");
  expect(await owner.autosave()).toBe(false);
  expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake!.shots.s.acceptedOutputIdentity).toBe(await hash(f.imagePath));
  f.setFault(undefined);
  expect(await owner.save()).toBe(true); expect(outputs).toBe(1);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(ref.current));
});

it.each(["md", "trash", "cleanup"] as const)("actual main %s failure never returns a completion ACK", async fault => {
  const f = await fixture(fault);
  await expect(f.save(f.payload)).rejects.toThrow(fault === "md" ? "required MD failed after JSON" : fault === "trash" ? "synthetic Trash failure" : "cleanup failed");
  const disk = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  expect(disk.pendingBake.shots.s.editToken).toBe("t1");
  expect(disk.pendingBake.shots.s.state).toBe("pending");
  if (fault === "md") {
    // JSON already points at the installed output: keep it AND the byte-exact
    // old backup, rather than restoring pixels inconsistent with published JSON.
    expect(disk.shots[0].swb.baseFingerprint).toBe(await pixelFingerprint(f.imagePath));
    const backupRoot = path.join(f.root, ".storyboard-workbench/save-tmp");
    const backups = await fs.readdir(backupRoot, { recursive: true });
    const backup = backups.find(name => name.endsWith(path.join(".backups", "0.tiff")));
    expect(backup).toBeDefined();
    expect(await fs.readFile(path.join(backupRoot, backup!))).toEqual(f.original);
    expect(f.effects).not.toContain("import-rollback");
    expect(f.effects).not.toContain("synthetic-trash");
  } else {
    expect(await hash(f.imagePath)).not.toBe(disk.pendingBake.shots.s.acceptedOutputIdentity);
    expect(f.effects).not.toContain("import-rollback");
  }
});
it("actual installation rechecks whole TIFF after preparation and does not overwrite external change admitted during preparation", async () => {
  const f = await fixture(); let external: Buffer | undefined;
  f.setBeforeEnsure(async () => {
    external = await sharp({ create: { width: 4, height: 3, channels: 4, background: "black" } }).tiff({ compression: "none" }).toBuffer();
    await fs.writeFile(f.imagePath, external);
  });
  await expect(f.save(f.payload)).rejects.toThrow("changed externally");
  expect(await fs.readFile(f.imagePath)).toEqual(external);
  expect(f.effects).not.toContain("json");
  expect(f.effects).not.toContain("synthetic-trash");
});
it.each(["hidden", "occluded"])("actual %s raster-only external TIFF mutation preserves composite but whole identity blocks Save before any effect", async mode => {
  const f = await fixture();
  const bitmapPath = ".storyboard-workbench/layers/s/under.png";
  const hiddenAsset = path.join(f.root, bitmapPath);
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(hiddenAsset);
  const top = { ...f.p.shots[0].layers![0], kind: "paint" as const, opacity: 1, order: 1 };
  const below = { ...top, id: "under", name: "Underlying", bitmapPath, visible: mode === "occluded", order: 0 };
  f.p.shots[0].layers = [below, top];
  const prepare = async (p: Project, stamp: string) => writePhotoshopLayeredTiffsForInPlaceSave({ ...p, shots: [p.shots[0]] }, f.root, {
    pythonPath: "/opt/homebrew/bin/python3.12", scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py"),
    saveStamp: stamp, env: { ...process.env, SWB_PYTHON_BIN: undefined }
  });
  const baseline = await prepare(f.p, "baseline"); await fs.copyFile(baseline.replacements[0].fromPath, f.imagePath);
  const h0 = await hash(f.imagePath), composite = await pixelFingerprint(f.imagePath);
  f.p.pendingBake!.shots.s.acceptedOutputIdentity = h0;
  const externalPath = ".storyboard-workbench/layers/external/under.png";
  await fs.mkdir(path.dirname(path.join(f.root, externalPath)), { recursive: true });
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "#00ff00" } }).png().toFile(path.join(f.root, externalPath));
  const external = { ...f.p, shots: [{ ...f.p.shots[0], layers: [{ ...below, bitmapPath: externalPath }, top] }] };
  const changed = await prepare(external, "external-edit"); await fs.copyFile(changed.replacements[0].fromPath, f.imagePath);
  expect(await hash(f.imagePath)).not.toBe(h0);
  expect(await pixelFingerprint(f.imagePath)).toBe(composite);
  const python = `import sys,importlib.util,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nspec=importlib.util.spec_from_file_location('reader',sys.argv[2]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nlayers=m.read_image_source_data(Path(sys.argv[3])).layers\nprint(json.dumps([{'name':m.layer_name(l),'visible':m.layer_visible(l),'pixel':l.asarray()[0,0].tolist()} for l in layers]))`;
  const inspected = await promisify(execFile)("/opt/homebrew/bin/python3.12", ["-c", python, process.env.SWB_PYTHON_DEPS_DIR!, path.join(process.cwd(), "scripts/photoshop-layered-tiff-import.py"), f.imagePath], { env: { ...process.env, SWB_PYTHON_BIN: undefined } });
  expect(JSON.parse(inspected.stdout)).toContainEqual({ name: "Underlying", visible: mode === "occluded", pixel: [0, 255, 0, 255] });
  const before = await fs.readFile(f.imagePath), pngBefore = await fs.readFile(hiddenAsset), jsonBefore = JSON.stringify(f.p);
  await expect(f.save(f.payload)).rejects.toThrow("changed externally");
  expect(f.effects).toEqual([]);
  expect(await fs.readFile(f.imagePath)).toEqual(before);
  expect(await fs.readFile(hiddenAsset)).toEqual(pngBefore);
  expect(JSON.stringify(f.p)).toBe(jsonBefore);
});

it.each(["missing", "future", "corrupt", "parked-unknown", "missing-PNG"])("actual admission rejects %s before first effect and preserves raw input", async kind => {
  const f = await fixture();
  if (kind === "missing") delete f.p.pendingBake;
  if (kind === "future") f.p.pendingBake = { version: 8, shots: {}, extension: ["preserve"] } as never;
  if (kind === "corrupt") f.p.pendingBake = { version: 1, shots: { s: null }, extension: ["preserve"] } as never;
  if (kind === "parked-unknown") { f.p.parkedShots = [{ ...f.p.shots[0], id: "parked" }]; f.p.pendingBake!.shots.parked = { state: "unknown" }; }
  if (kind === "missing-PNG") await fs.unlink(path.join(f.root, f.p.shots[0].layers![0].bitmapPath));
  const before = JSON.stringify(f.p);
  await expect(f.save(f.payload)).rejects.toThrow();
  expect(f.effects).toEqual([]);
  expect(JSON.stringify(f.p)).toBe(before);
  expect(await fs.readFile(f.imagePath)).toEqual(f.original);
});
it("actual rename ACK maps old source to actual new target without claiming old filename", async () => {
  const f = await fixture();
  const finalPath = path.join(f.root, "renamed.tiff");
  f.p.shots[0] = { ...f.p.shots[0], imagePath: finalPath, fileName: "renamed.tiff" };
  const renamePlan = [{ shotId: "s", fromPath: f.imagePath, temporaryPath: path.join(f.root, ".rename.tiff"), finalPath, finalFileName: "renamed.tiff" }];
  const result = await f.save({ ...f.payload, renamePlan });
  expect(result.normalSaveOutputs).toEqual([{ shotId: "s", capturedToken: "t1", sourcePath: f.imagePath, targetPath: finalPath, outputHash: await hash(finalPath), fileName: "renamed.tiff", baseFingerprint: result.project.shots[0].swb?.baseFingerprint }]);
  await expect(fs.stat(f.imagePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(result.project.shots[0].fileName).toBe("renamed.tiff");
  expect(await fs.readFile(f.sentinel)).toEqual(f.original);
});

it.each([null, false, 0, "", { version: 9, shots: {} }])("actual empty project cannot launder unsupported/corrupt raw envelope %j", async raw => {
  const f = await fixture(); f.p.shots = []; f.p.pendingBake = raw as never;
  const before = JSON.stringify(f.p);
  await expect(f.save(f.payload)).rejects.toThrow("compatibility is unknown");
  expect(f.effects).toEqual([]);
  expect(JSON.stringify(f.p)).toBe(before);
});

it.each([undefined, []])("normal main preserves fallback selection %j and ACKs every actual output identity", async selection => {
  const f = await fixture();
  const result = await f.save({ ...f.payload, dirtyShotIds: selection });
  const ids = selection === undefined ? ["s", "untouched"] : ["s"];
  expect(result.normalSaveOutputs.map((a: { shotId: string }) => a.shotId)).toEqual(ids);
  for (const ack of result.normalSaveOutputs) expect(ack.outputHash).toBe(await hash(ack.targetPath));
  if (selection !== undefined) expect(await fs.readFile(f.sentinel)).toEqual(f.original);
});

it("actual main Save selects persisted pending even after dirty reset and returns output-bound ACK only after required phases", async () => {
  const f = await fixture();
  const result = await f.save(f.payload);
  expect(result.normalSaveOutputs, "actual main Save did not ACK persisted pending outputs").toEqual([{ shotId: "s", capturedToken: "t1", sourcePath: f.imagePath, targetPath: f.imagePath, outputHash: await hash(f.imagePath), fileName: result.project.shots[0].fileName, baseFingerprint: result.project.shots[0].swb?.baseFingerprint }]);
  const pixels = await sharp(f.imagePath).ensureAlpha().raw().toBuffer();
  expect([...pixels.subarray(0, 4)]).toEqual([255, 127, 127, 255]);
  expect(await fs.readFile(f.sentinel)).toEqual(f.original);
  expect(f.effects.slice(-4)).toEqual(["json", "md", "synthetic-trash", "cleanup"]);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(serializeStoryboardScriptMarkdown(result.project));
});
