import { appCallerAdapterScope, createAppRootActor } from '../../src/renderer/appCallerAdapterScope';
import { isCertifiedPendingBakeEntry } from "../shared/pendingBakeRules";
import { createWorkspaceSession } from "../../src/renderer/workspaceSession";
import { afterEach, expect, it, vi } from "vitest";
// Only the script-Import History target uses React; the project-history hook is driven through
// real ref-backed History stacks, without replacing the production History controller.
vi.mock("react", () => ({
  useState: (v: unknown) => [v, () => {}],
  useRef: (v: unknown) => ({ current: v }),
  useEffect: (f: () => void) => f(),
  useCallback: (f: unknown) => f,
  useMemo: (f: () => unknown) => f()
}));
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createProject, ensureBitmapLayerMetadata, addImportedImages, addBitmapLayer, sceneMatteModeForProject, sceneDialogueOverlayEnabledForProject, bitmapLayersForShot, matteForShot, dialogueOverlayBitmapLayerId } from "../../src/shared/projectOps";
import type { Project, FolderScanPayload, ImportSwbFormatPayload, WorkspacePayload, SaveWorkspacePayload } from "../../src/shared/types";
import { withStatus } from "../../src/renderer/statusAction";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { prepareImportedImageMatte } from "../../src/renderer/normalSaveImportMatte";
import { registerWorkspaceAutosave } from "../../src/renderer/workspaceAutosaveController";
import { useBitmapLayerPaintingController } from "../../src/renderer/bitmapLayerPaintingController";
import { useBitmapLayerActions } from "../../src/renderer/bitmapLayerActions";
import { useLayerMetadataActionController } from "../../src/renderer/layerMetadataActionController";
import { historyDirtyShotIds } from "../../src/renderer/projectHistoryController";
import { changedShotIdsForBitmapRevision, bumpShotBitmapRevisions } from "../../src/renderer/shotBitmapRevision";
import { projectAcceptedExternalEdits } from "../../src/shared/projectOps";
import { useProjectHistoryController } from "../../src/renderer/projectHistoryController";
import { manualImageImportAdmission, automaticImageImportAdmission } from "../shared/manualImageImportRules";
import { registerWorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers";
import { createWorkspaceAssetAppHandlers } from "./workspaceAssetAppRuntime";
import { registerWorkspaceAssetIpcHandlers } from "./ipc/workspaceAssetHandlers";
import { createWorkspacePendingAppHandlers } from "./workspacePendingAppRuntime";
import { registerWorkspacePendingIpcHandlers } from "./ipc/workspacePendingHandlers";
import { beginPendingFileTransaction } from "./pendingFileTransactionService";
import * as renames from "./fileRenames";
import * as bitmap from "./bitmapLayers";
import * as safety from "./pathSafety";
import * as layer from "./layerAssetService";
import { writeProtectedLayerFile as protectedWriter } from "./protectedLayerFileWriter";
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { removeOwnedFile, type OwnedFileReceipt } from "./ownedFileCreation";
import { createLayerAppHandlers } from "./layerAppRuntime";
import { cleanupMergedLayerSources } from "./mergeSourceCleanup";
import * as script from "./storyboardScript";
import { createBlankShot } from "./blankShotService";
import { createProjectFromStoryboardScriptMarkdown, type CreateProjectFromStoryboardScriptOptions } from "./storyboardScriptProject";
import { registerWorkspaceScriptIpcHandlers } from "./ipc/workspaceScriptHandlers";
import { pendingBakeForProject } from "../../src/shared/pendingBake";
import { createImageRecords as createImportedImageRecords } from "./imageRecordsService";
import { previewRootForFolder } from "./previewPaths";
import { createPreview } from "./previewService";
import { pixelFingerprint } from "./imageFingerprintService";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { decodeNormalSaveImportResult, importRecoveryIncompleteCode, normalSaveImportFailure } from "../shared/normalSaveImportIpc";
import { hasPendingFileTransaction } from "./pendingFileTransactionService";
import { recoverFailedSave } from "./saveRecovery";
import { workspaceEffectFailure } from "./workspaceEffectFailure";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts";
import * as tiffPreparation from "./tiffPreparation";
import { bitmapLayersForShot as orderedBitmapLayersForShot } from "./bitmapLayerOrdering";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport";
import { saveProgressShotIds, countSaveProgressShots } from "./saveProgress";
import { cleanupDeletedShotLayerDirectories } from "./deletedShotLayers";
import { initializeCompletedShot } from "../../src/shared/pendingBake";
import { finishSaveAndClose } from "./appShellService";
import { stagePendingDeletedShotFiles, trashPendingDeletedShotFiles } from "./deletedShotFiles";
vi.mock("electron", () => ({ shell: { trashItem: () => { throw new Error("Trash forbidden in synthetic fixture"); } } }));

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const hash = async (p: string) => createHash("sha256").update(await fs.readFile(p)).digest("hex");
const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
const sourceApp = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
const barrier = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const listLayerPngs = async (root: string): Promise<string[]> => {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (full.endsWith(".png")) found.push(full.replace(root, ""));
    }
  };
  await walk(path.join(root, ".storyboard-workbench", "layers"));
  return found.sort();
};

const appExpression = (name: string): string => {
  const tree = ts.createSourceFile("App.tsx", sourceApp, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === name) expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); };
  visit(tree);
  return expression;
};
const runApp = (name: string, bindings: Record<string, unknown>) =>
  new Function("decodeNormalSaveImportResult", ...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${appExpression(name)});`, { target: ts.ScriptTarget.ES2022 }))(decodeNormalSaveImportResult, ...Object.values(appCallerAdapterScope(bindings)));

// The script-only Import never enters the swb/image branch, so the compile binds only the
// declarations that path actually evaluates; referenced-but-unreached image helpers stay free
// variables (never evaluated), exactly like the existing image-import chain fixture.
const scriptNames = [
  "sharpSourceOptions", "swbFormatVersion", "swbXmpTag", "readSwbMetadata",
  "projectNeedsSwbImport", "assertNormalSaveAdmission", "importStoryboardScriptMarkdown",
  "createGeneratedShotFromImage", "createImageRecords", "writeProjectFiles", "writeProjectMetadata",
  "writeStoryboardScriptMarkdown", "storyboardScriptPathForFolder", "ensureStoryboardScriptMarkdown",
  "ensureProjectLayerAssets", "createImageBitmapLayerPng", "createPaintBitmapLayerPng",
  "createTransparentLayerPng", "transparentLayerBuffer", "sketchLayersForShot",
  "archiveStamp", "shouldWriteSwbMetadata", "shouldWritePhotoshopLayeredTiffOnSave",
  "bakeShotToWorkingTiff", "bakeBitmapLayersToTiff", "bakeSketchOverlayToTiff",
  "swbMetadataForShot", "swbMetadataXmp", "writeSwbMetadataToTiffs", "preparePhotoshopLayeredTiffsForSave",
  "saveWorkspace", "normalSaveOutputAcks", "assertRenamePlanSafe", "importProjectToSwbFormat",
  "clearSavedImageLayerEdits", "syncSavedSwbBaseFingerprints", "shouldBakeShotImageEdits", "uniquePath"
];

it("script parser/merge is exact on the real production module (pure text and new-entry)", () => {
  const existing = { id: "s", order: 0, scriptText: "old line\ncontinued" };
  const samePlan = script.planStoryboardScriptImport({ shots: [existing], updatedAt: "" }, ["new line\ncontinued"]);
  expect(samePlan).toEqual([{ type: "existing", shotId: "s", scriptText: "new line\ncontinued" }]);
  const sameProject = script.applyStoryboardScriptImportPlan(
    { shots: [existing], updatedAt: "" } as never, samePlan, []);
  expect(sameProject.shots[0]).toMatchObject({ id: "s", scriptText: "new line\ncontinued" });
  const keep = { id: "s", order: 0, scriptText: "keep me" };
  const newPlan = script.planStoryboardScriptImport({ shots: [keep], updatedAt: "" }, ["new line\ncontinued", "a second entry"]);
  expect(newPlan).toEqual([
    { type: "new", scriptText: "new line\ncontinued" },
    { type: "new", scriptText: "a second entry" },
    { type: "existing", shotId: "s", scriptText: "keep me" }
  ]);
});

it("actual App script-only Import route triggers the owner only for a real script change", async () => {
  const calls: string[] = [];
  const legacyImport = vi.fn(async () => ({ folderPath: "/w", folderName: "w", metadataPath: "/w/p.json", images: [], preserveProjectWithoutImageMerge: true }));
  const adapter = {
    imageImport: vi.fn(() => { calls.push("imageImport"); return Promise.resolve(true); }),
    scriptImport: vi.fn(() => { calls.push("scriptImport"); return Promise.resolve(true); })
  };
  const run = (flags: { normalSaveAppEnabled: boolean; needsSwbImport: boolean; needsImageImport: boolean; scriptImportNeeded: boolean }) => runApp("handleImportSwbFormat", {
    window: { storyboard: { importSwbFormat: legacyImport } }, normalSaveAppAdapterRef: { current: adapter },
    folderPath: "/w", metadataPath: "/w/p.json", project: createProject("w"),
    blankShotPreset: "16:9", dirtyShotIds: () => [], setIsImportHelpOpen: () => {}, setStatus: () => {},
    prepareNormalSaveImportMatte: async (p: Project) => p, prepareNormalSaveScriptMatte: async (p: Project) => p,
    normalSaveImageImportPublished: () => {}, normalSaveScriptImportPublished: () => {},
    // Legacy fallback bindings (used only when normalSaveAppEnabled is false).
    sceneMatteModeForProject: () => undefined, sceneDialogueOverlayEnabledForProject: () => false,
    sceneMatteInheritanceRef: { current: undefined }, setWorkspaceTask: () => {},
    withStatus: async (_m: string, task: () => Promise<unknown>) => task(), loadFolderScan: async () => undefined,
    ...flags
  })();
  await run({ normalSaveAppEnabled: true, needsSwbImport: true, needsImageImport: false, scriptImportNeeded: true });
  expect(calls).toEqual(["scriptImport"]);
  expect(legacyImport).not.toHaveBeenCalled();
  calls.length = 0;
  await run({ normalSaveAppEnabled: true, needsSwbImport: true, needsImageImport: true, scriptImportNeeded: true });
  expect(calls).toEqual(["imageImport"]);
  calls.length = 0;
  await run({ normalSaveAppEnabled: true, needsSwbImport: false, needsImageImport: false, scriptImportNeeded: false });
  expect(calls).toEqual([]);
  calls.length = 0;
  // The retired flag cannot select a bypass: the normal domain is the only route.
  await run({ normalSaveAppEnabled: false, needsSwbImport: true, needsImageImport: false, scriptImportNeeded: true });
  expect(calls).toEqual(["scriptImport"]);
  expect(legacyImport).not.toHaveBeenCalled();
});

it("normal App script Import decodes plain recovery failure without successful FolderScan publication", async () => {
  const loadFolderScan = vi.fn(), setProject = vi.fn(), statuses: string[] = [];
  const published = vi.fn();
  const projectRef = { current: { ...createProject("test"), pendingBake: { version: 1 as const, shots: {} } } };
  const adapter = createNormalSaveAppAdapter({
    projectRef, setProject, queue: createBitmapLayerWriteQueue(), freshToken: () => "fresh",
    paths: () => ({ folderPath: "/synthetic", metadataPath: "/synthetic/p.json" }),
    api: () => ({ importSwbFormat: async () => structuredClone(normalSaveImportFailure({ message: "primary; rollback" })),
      readOutputIdentity: async () => "0".repeat(64), autosaveWorkspace: vi.fn(), saveWorkspace: vi.fn() }),
    onError: error => statuses.push(String(error)), onSave: () => {}
  });
  // Owner construction installs its normalized initial view. Only subsequent
  // failed Import publication is forbidden by this protection contract.
  const initial = projectRef.current;
  setProject.mockClear();
  const handle = runApp("handleImportSwbFormat", {
    window: { storyboard: {} }, normalSaveAppAdapterRef: { current: adapter },
    folderPath: "/synthetic", metadataPath: "/synthetic/p.json", project: initial,
    needsSwbImport: true, needsImageImport: false, scriptImportNeeded: true,
    blankShotPreset: "16:9", dirtyShotIds: () => [], setIsImportHelpOpen: () => {},
    prepareNormalSaveScriptMatte: async (p: Project) => p, normalSaveScriptImportPublished: published,
    loadFolderScan, setStatus: (s: string) => statuses.push(s)
  });
  expect(await handle()).toBe(false);
  expect(loadFolderScan).not.toHaveBeenCalled();
  expect(published).not.toHaveBeenCalled();
  // Recovery-incomplete is not a no-effect rejection: the owner must retain
  // possible disk effects and may republish a blocked view, never a success.
  expect(projectRef.current.shots).toEqual(initial.shots);
  expect(projectRef.current.name).toBe(initial.name);
  expect(adapter.owner.hasUnsavedWork()).toBe(true);
  expect(statuses.at(-1)).toContain("primary; rollback");
});

it("actual App script publication reports durability and never claims a raster edit", () => {
  const onPendingPublication = vi.fn(), setScriptImportNeeded = vi.fn(), setStatus = vi.fn();
  const published = runApp("normalSaveScriptImportPublished", {
    normalSaveAppCallbacksRef: { current: { onPendingPublication } }, setScriptImportNeeded, setStatus
  });
  published({} as FolderScanPayload, false);
  expect(onPendingPublication).toHaveBeenCalledWith({ durable: false });
  expect(setScriptImportNeeded).toHaveBeenCalledWith(false);
  expect(setStatus).toHaveBeenCalledWith(expect.stringMatching(/newer edits await autosave/));
});

it("actual main script-only Import never installs the captured P; the owner writes real JSON/MD once", async () => {
  const f = await fixture();
  const s = f.ref.current.shots[0], entry = f.ref.current.pendingBake!.shots.s;
  const beforePersist = barrier(), release = barrier();
  f.beforePersist(async () => { beforePersist.release(); await release.promise; });
  const task = f.run();
  await beforePersist.promise;
  // Main must not have installed the plan-applied captured Project before the owner merges:
  // the on-disk JSON is still the pristine pre-Import Project.
  const onDisk = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  expect(onDisk.shots.map((shot: { scriptText: string }) => shot.scriptText)).toEqual(["old line"]);
  release.release();
  expect(await task).toBe(true);
  expect(f.errors).toEqual([]);
  expect(f.ref.current.pendingBake!.shots.s).toEqual(entry);
  expect(f.ref.current.shots[0].scriptText).toBe("new line");
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect(await fs.readFile(s.imagePath)).toEqual(f.originalTiff);
  expect(f.io.mock.calls[0][0]).toMatchObject({ normalSave: true });
  expect(f.io.mock.calls[0][0].normalSaveImageImport).toBeUndefined();
  expect(f.io.mock.calls[0][0].normalSaveAutoImageImport).toBeUndefined();
});

it("actual script-only Import materializes a real internal PNG that the registered autosave admission consumes", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const s = f.ref.current.shots[0], entry = f.ref.current.pendingBake!.shots.s;
  expect(await f.run()).toBe(true);
  expect(f.errors).toEqual([]);
  expect(f.ref.current.shots).toHaveLength(2);
  const created = f.ref.current.shots.find(shot => shot.id !== s.id)!;
  expect(f.ref.current.pendingBake!.shots.s).toEqual(entry);
  const createdEntry = f.ref.current.pendingBake!.shots[created.id];
  expect(createdEntry).toMatchObject({ state: "pending" });
  expect(createdEntry.editToken).toBeTruthy();
  expect(createdEntry.acceptedOutputIdentity).toBe(await hash(created.imagePath));
  expect((await sharp(created.imagePath).metadata()).width).toBe(1920);
  // The genuinely new blank's internal PNG exists (path taken from the real shot), so a later
  // ordinary autosave admits + ensures + writes without failing before ensure.
  for (const layer of created.layers ?? []) {
    expect(await exists(path.join(f.root, layer.bitmapPath))).toBe(true);
  }
  expect(await f.autosaveRegistered()).toBe(true);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});

it("actual script-only Import merges a same-scope new edit into the latest Project before release", async () => {
  const f = await fixture();
  const entered = barrier(), gate = barrier();
  f.beforePersist(async () => { entered.release(); await gate.promise; });
  const task = f.run();
  await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-latest" }), []);
  gate.release();
  expect(await task).toBe(true);
  expect(f.ref.current.name).toBe("P2-latest");
  expect(f.ref.current.shots[0].scriptText).toBe("new line");
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect(f.errors).toEqual([]);
});

it("actual script-only Import never publishes an ABA result into a newer epoch", async () => {
  const f = await fixture();
  const entered = barrier(), gate = barrier();
  f.setFaultEffect(async () => { entered.release(); await gate.promise; });
  const task = f.run();
  await entered.promise;
  const loading = f.adapter.owner.load({ ...createProject("new B"), pendingBake: { version: 1, shots: {} } });
  gate.release();
  expect(await task).toBe(false);
  await loading;
  expect(f.ref.current.name).toBe("new B");
  expect(f.errors).toEqual([]);
});

it("actual script-only Import refuses an unsupported envelope before any IO", async () => {
  const f = await fixture();
  f.ref.current = { ...f.ref.current, pendingBake: { version: 9, shots: {} } as unknown as Project["pendingBake"] };
  const bytes = await fs.readFile(f.imagePath), md = await fs.readFile(f.mdPath);
  expect(await f.run()).toBe(false);
  expect(f.io).not.toHaveBeenCalled();
  expect(await fs.readFile(f.imagePath)).toEqual(bytes);
  expect(await fs.readFile(f.mdPath)).toEqual(md);
  expect(f.errors).toHaveLength(1);
});

it("actual script-only Import refused by a stale capture performs zero IO", async () => {
  const f = await fixture();
  const held = barrier();
  const old = f.queue.runExclusive(() => held.promise);
  const task = f.run();
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-newer" }), []);
  held.release();
  await old;
  expect(await task).toBe(false);
  expect(f.io).not.toHaveBeenCalled();
  expect(f.ref.current.name).toBe("P2-newer");
  expect(f.errors).toEqual([]);
});

it("actual script-only Import refuses an in-flight Pending transaction before materializing any asset", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, ".storyboard-workbench", "pending-file-transaction.json"),
    `${JSON.stringify({ version: 1, moves: [{ fromPath: path.join(f.root, "a.tiff"), toPath: path.join(f.root, "b.tiff") }] })}\n`, "utf8");
  const before = await fs.readFile(f.metadataPath);
  expect(await f.run()).toBe(false);
  // No asset effect: only the pre-existing a.tiff remains, and the on-disk JSON is untouched.
  expect((await fs.readdir(f.root)).sort()).toEqual([".storyboard-workbench", "a.tiff", "storyboard-script.md"]);
  expect(await fs.readFile(f.metadataPath)).toEqual(before);
  expect(f.errors).toHaveLength(1);
});

it("actual text edit during IO refuses the import without overwriting the newer text", async () => {
  const f = await fixture();
  const entered = barrier(), gate = barrier();
  f.beforePersist(async () => { entered.release(); await gate.promise; });
  const task = f.run();
  await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, shots: p.shots.map((shot, index) => index ? shot : { ...shot, scriptText: "P2 text" }) }), []);
  gate.release();
  expect(await task).toBe(false);
  expect(f.ref.current.shots[0].scriptText).toBe("P2 text");
  expect(f.errors).toHaveLength(1);
});

it("actual new-shot reorder during IO refuses the import without un-parking or reordering", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const entered = barrier(), gate = barrier();
  f.beforePersist(async () => { entered.release(); await gate.promise; });
  const task = f.run();
  await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, parkedShots: [{ ...p.shots[0], order: 0 }], shots: [] }), []);
  gate.release();
  expect(await task).toBe(false);
  // The newer lifecycle is preserved: the captured shot stays parked and is not un-parked or
  // reordered; only the genuinely materialized new blank is retained (as unknown) so its assets
  // are not orphaned.
  expect(f.ref.current.shots.some(shot => shot.id === "s")).toBe(false);
  expect(f.ref.current.parkedShots!.some(shot => shot.id === "s")).toBe(true);
  const orphan = f.ref.current.shots.find(shot => shot.id !== "s");
  expect(orphan).toBeTruthy();
  expect(f.ref.current.pendingBake!.shots[orphan!.id].state).toBe("unknown");
  expect(f.errors).toHaveLength(1);
});

it("actual new-shot identity collision during IO refuses the import", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  f.setAfterEffect(async () => {
    const created = (f.lastScan?.project?.shots ?? []).find(shot => shot.id !== "s");
    if (!created) throw new Error("fixture expected a new shot");
    // A newer same-scope shot already claims the new blank's identity (and stays supported, so
    // the collision guard - not a generic unknown - is what must refuse it).
    const previous = f.ref.current.pendingBake!;
    f.ref.current = { ...f.ref.current,
      shots: [...f.ref.current.shots, { ...created, imagePath: path.join(f.root, "collision.tiff") }],
      pendingBake: { ...previous, shots: { ...previous.shots, [created.id]: { state: "synced", acceptedOutputIdentity: await hash(created.imagePath) } } } };
  });
  expect(await f.run()).toBe(false);
  expect(f.errors).toHaveLength(1);
});

it("actual required MD filesystem failure keeps a new shot's assets as unknown and gates Save/autosave", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  f.setMdFault();
  expect(await f.run()).toBe(false);
  expect(f.errors).toHaveLength(1);
  const created = f.ref.current.shots.find(shot => shot.id !== "s");
  expect(created).toBeTruthy();
  expect(f.ref.current.pendingBake!.shots[created!.id].state).toBe("unknown");
  // Assets are preserved: TIFF + internal PNG are still on disk and referenced by the Project.
  expect(await exists(created!.imagePath)).toBe(true);
  for (const layer of created!.layers ?? []) expect(await exists(path.join(f.root, layer.bitmapPath))).toBe(true);
  // Unknown output is a durable obligation: the writers are gated.
  expect(await f.adapter.owner.autosave()).toBe(false);
  expect(await f.adapter.save()).toBe(false);
  expect(f.recovery.current).toMatch(/assets retained/);
});

it("actual pure text Import whose required MD write fails after JSON preserves the written fact and gates the writers", async () => {
  const f = await fixture();
  f.setMdFault();
  expect(await f.run()).toBe(false);
  expect(f.errors).toHaveLength(1);
  // The JSON was already written with the imported text before the required MD failed, so this is
  // NOT a zero-effect refusal: the affected captured shot is preserved as unknown and a stale
  // in-memory autosave cannot overwrite the already-written disk.
  const onDisk = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  expect(onDisk.shots[0].scriptText).toBe("new line");
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await f.adapter.owner.autosave()).toBe(false);
  expect(await f.adapter.save()).toBe(false);
  expect(f.recovery.current).toMatch(/assets retained/);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(onDisk);
});

it("actual main late failure after materializing a new blank rolls back its assets and writes no JSON", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const before = await fs.readFile(f.metadataPath);
  f.setLayerDirFault();
  expect(await f.run()).toBe(false);
  expect(f.errors).toHaveLength(1);
  // The blank TIFF and its not-yet-created internal PNG are rolled back; the pristine workspace
  // and the on-disk Project are byte-unchanged (main never installed the captured P).
  expect((await fs.readdir(f.root)).sort()).toEqual([".storyboard-workbench", "a.tiff", "storyboard-script.md"]);
  expect(await fs.readFile(f.metadataPath)).toEqual(before);
});

it("actual readonly script classification reports a missing MD without writing one", async () => {
  const f = await fixture();
  await fs.unlink(f.mdPath);
  const needed = await f.readonly(f.root, f.ref.current, true);
  expect(needed).toBe(true);
  await expect(fs.stat(f.mdPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("actual script-only Import keeps a same-scope P3 durable in the required JSON/MD", async () => {
  const f = await fixture();
  const entered = barrier(), gate = barrier();
  f.beforePersist(async () => { entered.release(); await gate.promise; });
  const task = f.run();
  await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P3" }), []);
  gate.release();
  expect(await task).toBe(true);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe("P3");
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});

it("actual queued script Import releases finitely and the real autosave timer lands the latest project", async () => {
  const f = await fixture();
  const entered = barrier(), gate = barrier();
  f.beforePersist(async () => { entered.release(); await gate.promise; });
  const task = f.run();
  await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-autosave" }), []);
  gate.release();
  expect(await task).toBe(true);
  // Queue released: an independent exclusive action runs.
  expect(await f.queue.runExclusive(async () => true)).toBe(true);
  const callbacks: Array<() => void> = [];
  let pending: Promise<unknown> | undefined;
  const timers = { setTimeout: (cb: () => void) => { callbacks.push(cb); return callbacks.length; }, clearTimeout: () => {} };
  registerWorkspaceAutosave({
    autosaveRevision: 1, folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath },
    hasStoryboardApi: true, persistWorkspace: project => { pending = f.adapter.autosave(project); return pending; }, projectRef: f.ref,
    setAutosaveError: () => {}, setStatus: () => {}, setWorkspaceSaveState: () => {}, timers
  });
  expect(callbacks).toHaveLength(1);
  callbacks[0]();
  await pending;
  await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe("P2-autosave"));
  expect(f.ref.current.name).toBe("P2-autosave");
});

it("actual script-only Import inherits the original scene matte for a genuinely new blank shot", async () => {
  const f = await fixture({ matteMode: "expanded" });
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  const raster = dataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const scopedPrepare = (p: Project, mode: "expanded" | "embedded", ids: string[], request: Parameters<typeof prepareImportedImageMatte>[3], deps: Parameters<typeof prepareImportedImageMatte>[4]) =>
    prepareImportedImageMatte(p, mode, ids, request, { ...deps, canvas: {
      expandBitmapLayer: async (url: string, _layer: unknown, top: number, bottom: number) => dataUrl(await sharp(Buffer.from(url.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()),
      createMatteOverlay: () => raster, createDialogueOverlay: () => raster
    } });
  const prepare = runApp("prepareNormalSaveScriptMatte", {
    prepareImportedImageMatte: scopedPrepare, normalSaveAppAdapterRef: { current: f.adapter },
    sceneMatteModeForProject, sceneDialogueOverlayEnabledForProject, matteForShot, bitmapLayersForShot, dialogueOverlayBitmapLayerId,
    window: { storyboard: f.api }, bitmapLayerWriteQueueRef: { current: f.queue }, setStatus: () => {},
    workspaceRecoveryRequiredRef: f.recovery, normalSaveAppCallbacksRef: { current: { onError: vi.fn() } }
  }) as (p: Project, ids: string[], isCurrent: () => boolean, operation: { folderPath: string; metadataPath: string; isWorkspaceCurrent: () => boolean }) => Promise<Project>;
  expect(await f.run({ prepare })).toBe(true);
  expect(f.errors).toEqual([]);
  const created = f.ref.current.shots.find(shot => shot.id !== "s")!;
  // Existing pure-text shot is not redrawn; only the new blank inherits the scene overlay.
  expect(matteForShot(created)?.mode).toBe("expanded");
  expect(created.layers!.some(l => l.id === dialogueOverlayBitmapLayerId) || bitmapLayersForShot(created).length >= 2).toBe(true);
  expect(f.ref.current.shots[0].presentation?.matte?.mode).toBe("expanded");
});

// ---- revision2 targets: persist facts, prepare-once, existing-mismatch inheritance, rollback ----

const pngDataUrl = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

// Compose the REAL App `prepareNormalSaveScriptMatte` expression with the real
// `prepareImportedImageMatte`; only the canvas pixel codec is a counted local fake.
const scriptMattePrepare = (options: {
  raster: string; adapter: unknown; api: Window["storyboard"]; queue: unknown;
  expandCapture?: Array<{ inputHeight: number; top: number; bottom: number }>;
  recovery?: { current: string | undefined };
}) => runApp("prepareNormalSaveScriptMatte", {
  prepareImportedImageMatte: (p: Project, mode: "expanded" | "embedded", ids: string[],
    request: Parameters<typeof prepareImportedImageMatte>[3], deps: Parameters<typeof prepareImportedImageMatte>[4]) =>
    prepareImportedImageMatte(p, mode, ids, request, { ...deps, canvas: {
      expandBitmapLayer: async (url: string, _layer: unknown, top: number, bottom: number) => {
        const input = Buffer.from(url.split(",")[1], "base64");
        options.expandCapture?.push({ inputHeight: (await sharp(input).metadata()).height!, top, bottom });
        return pngDataUrl(await sharp(input).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer());
      },
      createMatteOverlay: () => options.raster, createDialogueOverlay: () => options.raster
    } }),
  normalSaveAppAdapterRef: { current: options.adapter }, sceneMatteModeForProject, sceneDialogueOverlayEnabledForProject,
  matteForShot, bitmapLayersForShot, dialogueOverlayBitmapLayerId, window: { storyboard: options.api },
  bitmapLayerWriteQueueRef: { current: options.queue }, setStatus: () => {},
  workspaceRecoveryRequiredRef: options.recovery ?? { current: undefined }, normalSaveAppCallbacksRef: { current: { onError: vi.fn() } }
}) as (p: Project, ids: string[], isCurrent: () => boolean, operation: { folderPath: string; metadataPath: string; isWorkspaceCurrent: () => boolean }) => Promise<Project>;

it("actual script-only Import invokes the prepare even when there are no new shots", async () => {
  const f = await fixture();
  const prepare = vi.fn(async (project: Project) => project);
  expect(await f.run({ prepare })).toBe(true);
  // The prepare is NOT gated on newIds being non-empty: an existing-only scene mismatch must
  // still reach the caller's prepare (which decides its own actual target set).
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0][1]).toEqual([]);
  expect(f.errors).toEqual([]);
});

it("actual existing-only scene mismatch is prepared and matching shots are not redrawn", async () => {
  const f = await fixture({ matteMode: "expanded", secondShot: {} });
  const expands: Array<{ inputHeight: number; top: number; bottom: number }> = [];
  const rhs = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const prepare = scriptMattePrepare({ raster: rhs, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: expands });
  const sLayer = f.ref.current.shots[0].layers!.find(l => l.id === "layer-image")!;
  const sPngBefore = await fs.readFile(path.join(f.root, sLayer.bitmapPath));
  const sEntry = f.ref.current.pendingBake!.shots.s;
  expect(await f.run({ prepare })).toBe(true);
  expect(f.errors).toEqual([]);
  // The existing owned shot t (no matte) inherited the scene matte; the matching shot s was not
  // redrawn and its token did not churn.
  const t = f.ref.current.shots.find(shot => shot.id === "t")!;
  expect(t.presentation?.matte?.mode).toBe("expanded");
  expect(await fs.readFile(path.join(f.root, sLayer.bitmapPath))).toEqual(sPngBefore);
  expect(f.ref.current.pendingBake!.shots.s).toEqual(sEntry);
  expect(f.ref.current.pendingBake!.shots.t).toMatchObject({ state: "pending" });
  expect(f.ref.current.pendingBake!.shots.t.editToken).toBeTruthy();
  expect(expands).toHaveLength(1);
  // The published callback receives the changed asset shot so App History can be invalidated.
  expect(f.published).toHaveBeenCalledWith(expect.anything(), true, ["t"]);
});

it("actual expanded new blank is prepared exactly once across a rebuild (no double pixel expansion)", async () => {
  const f = await fixture({ matteMode: "expanded" });
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const expands: Array<{ inputHeight: number; top: number; bottom: number }> = [];
  const rhs = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const prepare = scriptMattePrepare({ raster: rhs, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: expands });
  let persists = 0;
  f.beforePersist(async () => { persists += 1; if (persists === 1) f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-during" }), []); });
  expect(await f.run({ prepare })).toBe(true);
  expect(f.errors).toEqual([]);
  // Two required persists happened, but the asset preparation ran once and the internal PNG was
  // expanded exactly once (the metadata merge is separated from the completed asset fact).
  expect(persists).toBe(2);
  expect(expands).toHaveLength(1);
  const created = f.ref.current.shots.find(shot => shot.id !== "s")!;
  const imageLayer = created.layers!.find(l => l.id === "layer-image")!;
  expect((await sharp(path.join(f.root, imageLayer.bitmapPath)).metadata()).height)
    .toBe(expands[0].inputHeight + expands[0].top + expands[0].bottom);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe("P2-during");
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
});

it("actual main rolls back the first created PNG when the second new blank's layer creation fails", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. entry two\n3. entry three\n", "utf8");
  const before = await fs.readFile(f.metadataPath);
  const beforePngs = await listLayerPngs(f.root);
  f.setFailLayersMkdirOn(2);
  expect(await f.run()).toBe(false);
  expect(f.errors).toHaveLength(1);
  // The first blank's internal PNG was created and then removed by this operation's own rollback
  // (the second path was never created, so its ENOENT is ignored); the blank TIFFs are gone too,
  // and the only remaining layer PNG is the pre-existing shot's own asset.
  const names = (await fs.readdir(f.root)).sort();
  expect(names).toEqual([".storyboard-workbench", "a.tiff", "storyboard-script.md"]);
  expect(await fs.readFile(f.metadataPath)).toEqual(before);
  expect(await listLayerPngs(f.root)).toEqual(beforePngs);
});

it("actual main surfaces a typed recovery-incomplete error and keeps the blank TIFF when PNG cleanup fails", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. entry two\n3. entry three\n", "utf8");
  f.setFailLayersMkdirOn(2);
  f.setUnlinkFault(filePath => filePath.endsWith(".png"));
  expect(await f.run()).toBe(false);
  expect(f.errors).toHaveLength(1);
  const error = f.errors[0] as { code?: string; recoveryIncomplete?: boolean };
  // A non-ENOENT cleanup failure is NOT swallowed: the serializable envelope is decoded at the
  // renderer consumer into a local error carrying the business code, and the dependent TIFF/preview
  // rollback did not run (the blank TIFF remains).
  expect(error.code).toBe(importRecoveryIncompleteCode);
  expect(error.recoveryIncomplete).toBe(true);
  const names = (await fs.readdir(f.root)).sort();
  expect(names.some(name => name.endsWith(".tiff") && name !== "a.tiff")).toBe(true);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await f.adapter.owner.autosave()).toBe(false);
});

it("actual main surfaces a typed recovery-incomplete error when the blank TIFF rollback fails", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. entry two\n", "utf8");
  f.setLayerDirFault();
  f.setUnlinkFault(filePath => filePath.endsWith(".tiff"));
  expect(await f.run()).toBe(false);
  const error = f.errors[0] as { code?: string };
  expect(error.code).toBe(importRecoveryIncompleteCode);
  const names = (await fs.readdir(f.root)).sort();
  expect(names.some(name => name.endsWith(".tiff") && name !== "a.tiff")).toBe(true);
});

it("actual owner gates on the decoded recovery-incomplete code returned through the real envelope", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. entry two\n3. entry three\n", "utf8");
  f.setFailLayersMkdirOn(2);
  f.setUnlinkFault(filePath => filePath.endsWith(".png"));
  // No fabricated Error/name: main returns the envelope, the real decode function produces the
  // typed code, and the owner gates on that decoded business discriminant.
  expect(await f.run()).toBe(false);
  expect(f.recovery.current).toMatch(/assets retained/);
  expect((f.errors[0] as { code?: string }).code).toBe(importRecoveryIncompleteCode);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await f.adapter.owner.autosave()).toBe(false);
});

it("actual App script publication invalidates presentation History for changed asset shots", () => {
  const onPendingPublication = vi.fn(), setScriptImportNeeded = vi.fn(), setStatus = vi.fn(), invalidatePresentationHistory = vi.fn();
  const project = { shots: [{ id: "t", layers: [{ bitmapPath: "layers/t/x.png" }] }], parkedShots: [] };
  const published = runApp("normalSaveScriptImportPublished", {
    normalSaveAppCallbacksRef: { current: { onPendingPublication } }, setScriptImportNeeded, setStatus,
    invalidatePresentationHistory, project, projectRef: { current: project }
  });
  published({} as FolderScanPayload, true, ["t"]);
  expect(invalidatePresentationHistory).toHaveBeenCalledTimes(1);
  const [, ids, paths] = invalidatePresentationHistory.mock.calls[0];
  expect(ids).toEqual(["t"]);
  expect(paths).toEqual(["layers/t/x.png"]);
  expect(onPendingPublication).toHaveBeenCalledWith({ durable: true });
});

// ---- revision3 targets: real IPC envelope, complete prepared asset fields, prepare-write gate,
//      actual App scheduler continuation ----

it("the Import return envelope decodes a bare legacy payload unchanged and yields a typed business code", () => {
  // Ordinary/legacy direct script Import returns a plain FolderScanPayload (no `ok` discriminant).
  const legacy = { folderPath: "/w", folderName: "w", metadataPath: "/w/p.json", images: [] };
  expect(decodeNormalSaveImportResult(legacy)).toBe(legacy);
  // The real main return envelope for a recovery-incomplete Import decodes to a typed IPC-safe error.
  const envelope = normalSaveImportFailure({ message: "retained files require recovery" });
  expect(envelope).toEqual({ ok: false, error: { code: importRecoveryIncompleteCode, message: "retained files require recovery" } });
  let decoded: { code?: string; recoveryIncomplete?: boolean; message?: string } | undefined;
  try { decodeNormalSaveImportResult(envelope); } catch (error) { decoded = error as typeof decoded; }
  expect(decoded?.code).toBe(importRecoveryIncompleteCode);
  expect(decoded?.recoveryIncomplete).toBe(true);
  expect(decoded?.message).toBe("retained files require recovery");
  // A successful envelope unwraps to its result.
  expect(decodeNormalSaveImportResult({ ok: true, result: legacy })).toBe(legacy);
});

it("both production preloads leave Import decoding to the renderer after contextBridge", async () => {
  for (const filename of ["preload.cjs", "preload.ts"]) {
    const preload = await fs.readFile(new URL(`../preload/${filename}`, import.meta.url), "utf8");
    expect(preload).not.toContain("decodeNormalSaveImportResult");
    expect(preload).toContain('ipcRenderer.invoke("workspace:importSwbFormat", payload)');
  }
});

it("a metadata P2 during persist keeps the prepared canvas height consistent with the written PNG", async () => {
  const f = await fixture({ matteMode: "expanded" });
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const expands: Array<{ inputHeight: number; top: number; bottom: number }> = [];
  const rhs = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const prepare = scriptMattePrepare({ raster: rhs, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: expands });
  let persists = 0;
  f.beforePersist(async () => { persists += 1; if (persists === 1) f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-metadata" }), []); });
  expect(await f.run({ prepare })).toBe(true);
  expect(f.errors).toEqual([]);
  expect(persists).toBe(2);
  expect(expands).toHaveLength(1);
  const created = f.ref.current.shots.find(shot => shot.id !== "s")!;
  const imageLayer = created.layers!.find(layer => layer.id === "layer-image")!;
  const pngHeight = (await sharp(path.join(f.root, imageLayer.bitmapPath)).metadata()).height!;
  // The complete prepared asset fields travel with the asset: the persisted canvasHeight equals the
  // expanded layer height AND the real written PNG height, even after a metadata-only rebuild.
  expect(created.swb!.canvasHeight).toBe(imageLayer.height);
  expect(created.swb!.canvasHeight).toBe(pngHeight);
  expect(pngHeight).toBe(expands[0].inputHeight + expands[0].top + expands[0].bottom);
  const onDisk = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
  const onDiskCreated = onDisk.shots.find((shot: { id: string }) => shot.id !== "s");
  expect(onDiskCreated.swb.canvasHeight).toBe(pngHeight);
  expect(onDisk.name).toBe("P2-metadata");
});

it("existing mismatch preserves non-derived SWB P2 fields through real PNG preparation", async () => {
  const f = await fixture({ matteMode: "expanded", secondShot: {} });
  const raster = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const prepare = scriptMattePrepare({ raster, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: [] });
  const fields = { archivePath: "/synthetic/P2-archive", statusMessage: "P2-note", acceptedExternalEditAt: "P2-time" };
  let persists = 0;
  f.beforePersist(async () => { if (++persists === 1) f.adapter.owner.publishEdit(p => ({ ...p,
    shots: p.shots.map(s => s.id === "t" ? { ...s, swb: { ...s.swb!, ...fields } } : s) }), []); });
  expect(await f.run({ prepare }), `Import errors: ${f.errors.map(e => String(e)).join("; ")}`).toBe(true);
  expect(persists).toBe(2);
  const shot = f.ref.current.shots.find(s => s.id === "t")!;
  expect(shot.swb).toMatchObject(fields);
  const png = shot.layers!.find(l => l.id === "layer-image")!;
  expect(shot.swb!.canvasHeight).toBe((await sharp(path.join(f.root, png.bitmapPath)).metadata()).height);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).shots.find((s: {id:string}) => s.id === "t").swb).toMatchObject(fields);
});

for (const patchSwb of [{ status: "incompatible-external-edit" as const }, { version: 99 }, { sourceKind: "photoshop-layered-tiff" as const }, { baseFingerprint: "new-source" }, { sourcePath: "/synthetic/new-source" }, { canvasHeight: 999 }]) {
  it(`existing mismatch rejects preparation eligibility/derived P2 change ${JSON.stringify(patchSwb)}`, async () => {
    const f = await fixture({ matteMode: "expanded", secondShot: {} });
    const raster = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
    const prepare = scriptMattePrepare({ raster, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: [] });
    f.beforePersist(async () => f.adapter.owner.publishEdit(p => ({ ...p,
      shots: p.shots.map(s => s.id === "t" ? { ...s, swb: { ...s.swb!, ...patchSwb } } : s) }), []));
    expect(await f.run({ prepare })).toBe(false);
    expect(f.ref.current.shots.find(s => s.id === "t")!.swb).toMatchObject(patchSwb);
    expect(f.recovery.current).toBeTruthy();
    expect(await f.adapter.save()).toBe(false);
  });
}

it("a dialogue change during the required persistence is a partial, never a new success", async () => {
  const f = await fixture({ matteMode: "expanded" });
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const rhs = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const prepare = scriptMattePrepare({ raster: rhs, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: [] });
  f.beforePersist(async () => {
    f.adapter.owner.publishEdit(p => ({ ...p, dialogues: [...(p.dialogues ?? []), { id: "d", shotId: "s", order: 0, text: "late" }] }), []);
  });
  expect(await f.run({ prepare })).toBe(false);
  // Latest scene/dialogue is preserved; the stale prepared PNG is not reported as a fresh success
  // and the writers are gated (explicit partial protection).
  expect(f.ref.current.dialogues.some(d => d.text === "late")).toBe(true);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(f.recovery.current).toMatch(/assets retained/);
  expect(await f.adapter.owner.autosave()).toBe(false);
  expect(await f.adapter.save()).toBe(false);
});

it("an existing-only prepare that already wrote a PNG and is then rejected still gates the writers", async () => {
  const f = await fixture({ matteMode: "expanded", secondShot: {} });
  const rhs = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const realPrepare = scriptMattePrepare({ raster: rhs, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: [] });
  const tLayer = f.ref.current.shots.find(shot => shot.id === "t")!.layers!.find(layer => layer.id === "layer-image")!;
  const tPngBefore = await fs.readFile(path.join(f.root, tLayer.bitmapPath));
  const prepare = async (p: Project, ids: string[], isCurrent: () => boolean,
    operation: Parameters<typeof prepareImportedImageMatte>[3], onPreparedAssets?: (ids: readonly string[]) => void) => {
    // The REAL App prepare writes the existing-only mismatch shot's internal PNG (no new shots).
    const out = await realPrepare(p, ids, isCurrent, operation, onPreparedAssets);
    // A late same-scope dialogue edit arrives right after the asset write; the derive is now stale.
    f.adapter.owner.publishEdit(q => ({ ...q, dialogues: [...(q.dialogues ?? []), { id: "d", shotId: "t", order: 0, text: "late" }] }), []);
    throw new Error("late dependency rejected the preparation");
  };
  expect(await f.run({ prepare })).toBe(false);
  expect(f.errors).toHaveLength(1);
  // A real PNG was written (actual effect) with no new shot and no persist attempt: the shot keeps the
  // latest Project but is marked unknown and the writers are gated.
  expect(await fs.readFile(path.join(f.root, tLayer.bitmapPath))).not.toEqual(tPngBefore);
  expect(f.ref.current.pendingBake!.shots.t.state).toBe("unknown");
  expect(f.ref.current.dialogues.some(d => d.text === "late")).toBe(true);
  expect(f.errors[0]).toBeInstanceOf(Error);
  expect(await f.adapter.owner.autosave()).toBe(false);
  expect(await f.adapter.save()).toBe(false);
});

for (const rollbackFails of [false, true]) {
  it(`existing-only mid-prepare failure uses actual recovery callback and writer gates (rollbackFails=${rollbackFails})`, async () => {
    const f = await fixture({ matteMode: "expanded", secondShot: {} });
    const t = f.ref.current.shots.find(s => s.id === "t")!, pngPath = t.layers![0].bitmapPath;
    const original = await fs.readFile(path.join(f.root, pngPath));
    let writes = 0;
    const api = { ...f.api, writeLayerPng: async (...args: Parameters<typeof layer.writeLayerPng>) => {
      writes++;
      if (writes === 2 || (rollbackFails && writes >= 3)) throw new Error(writes === 2 ? "prepare write failed" : "rollback write failed");
      return layer.writeLayerPng(...args);
    } };
    const raster = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
    const prepare = scriptMattePrepare({ raster, adapter: f.adapter, api: api as unknown as Window["storyboard"], queue: f.queue, expandCapture: [], recovery: f.recovery });
    const reads = vi.fn(layer.readLayerPng), restores = vi.fn(layer.writeLayerPng);
    const history = useProjectHistoryController({
      isImageImportLocked: () => false, getRecoveryRequiredMessage: () => f.recovery.current,
      api: { ...f.api, readLayerPng: reads, writeLayerPng: restores }, bitmapLayerWriteQueueRef: { current: f.queue },
      fileNameSyncStateRef: { current: "unsynced" }, folderPathRef: { current: f.root }, maxEntries: 8,
      markShotsDirty: () => {}, projectRef: f.ref, scriptImportCheckIdRef: { current: 0 },
      selectedShotIdsRef: { current: [] }, selectShotsByIds: () => {}, setAutosaveRevision: () => {},
      setFileNameSyncState: () => {}, setProject: () => {}, setScriptImportNeeded: () => {},
      setStatus: () => {}, setWorkspaceSaveState: () => {}, publishProject: (project, ids) => f.adapter.owner.publishEdit(project, ids)
    });
    history.recordUndoEntry(await history.createHistoryEntry([pngPath]));
    reads.mockClear();
    expect(await f.run({ prepare })).toBe(false);
    expect(writes).toBeGreaterThanOrEqual(3);
    if (rollbackFails) {
      expect(f.recovery.current).toMatch(/recover|restore|rollback/i);
      const before = await fs.readFile(f.metadataPath);
      await history.applyUndoEntry();
      expect(reads).not.toHaveBeenCalled();
      expect(restores).not.toHaveBeenCalled();
      expect(await f.adapter.save()).toBe(false);
      expect(await f.adapter.autosave(f.ref.current)).toBe(false);
      expect(await fs.readFile(f.metadataPath)).toEqual(before);
    } else {
      expect(f.recovery.current).toBeUndefined();
      expect(await fs.readFile(path.join(f.root, pngPath))).toEqual(original);
      expect(await f.adapter.autosave(f.ref.current)).toBe(true);
    }
  });
}

it("actual App onPendingPublication continues a finite script Import with an automatic fresh autosave", async () => {
  const f = await fixture();
  await fs.writeFile(f.mdPath, "1. old line\n2. a second entry\n", "utf8");
  const callbacks: Array<() => void> = [];
  const timers = { setTimeout: (fn: () => void) => { callbacks.push(fn); return callbacks.length; }, clearTimeout: () => {} };
  // The ACTUAL App scheduler control: onPendingPublication -> setAutosaveRevision -> the real
  // registerWorkspaceAutosave (the same harness shape the image-Import chain fixture uses).
  const schedule = () => registerWorkspaceAutosave({ autosaveRevision: 1,
    folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath }, hasStoryboardApi: true,
    projectRef: f.ref, timers, setStatus: vi.fn(), setWorkspaceSaveState: vi.fn(), setAutosaveError: vi.fn(),
    persistWorkspace: projectToSave => f.adapter.autosave(projectToSave).then(() => undefined) });
  const tree = ts.createSourceFile("App.tsx", sourceApp, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let publication = "", pending = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "normalSaveScriptImportPublished") publication = node.initializer!.getText(tree);
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "onPendingPublication" && node.initializer.getText(tree).includes("setAutosaveRevision")) pending = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const controls = { rebasePendingHistory: vi.fn(), setFileNameSyncState: vi.fn(), fileNameSyncStateRef: { current: "synced" },
    setWorkspaceSaveState: vi.fn(), workspaceSaveStateRef: { current: "saved" }, setAutosaveRevision: schedule };
  const onPendingPublication = new Function(...Object.keys(controls), ts.transpile(`return (${pending});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(controls));
  const bindings = { project: f.ref.current, projectRef: f.ref, setScriptImportNeeded: vi.fn(), setStatus: vi.fn(),
    invalidatePresentationHistory: vi.fn(), normalSaveAppCallbacksRef: { current: { onPendingPublication } } };
  const published = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${publication});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  // An already-scheduled ordinary-autosave timer for the PRE-import capture is enqueued first.
  schedule();
  expect(callbacks).toHaveLength(1);
  let persists = 0;
  f.beforePersist(async () => { persists += 1; if (persists <= 2) f.adapter.owner.publishEdit(p => ({ ...p, name: `P${persists + 1}` }), []); });
  expect(await f.run({ published })).toBe(false);
  expect(persists).toBe(2);
  // Queue released finitely, and the App publication scheduled a FRESH automatic autosave.
  expect(await f.queue.runExclusive(async () => true)).toBe(true);
  expect(callbacks).toHaveLength(2);
  // The stale (pre-import) capture is rejected and does not overwrite the disk.
  const beforeStale = JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name;
  callbacks[0]();
  await f.queue.runExclusive(async () => {});
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe(beforeStale);
  // The fresh capture lands the latest Project's JSON and MD.
  const latestName = f.ref.current.name;
  callbacks[1]();
  await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe(latestName));
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});

it("real History Undo/Redo restores mixed new/existing internal PNGs written by script Import and the actual Save output", async () => {
  const f = await fixture({ matteMode: "expanded", secondShot: {} });
  await fs.writeFile(f.mdPath, "1. old line\n2. second line\n3. brand new\n", "utf8");
  const rhs = pngDataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const prepare = scriptMattePrepare({ raster: rhs, adapter: f.adapter, api: f.api, queue: f.queue, expandCapture: [] });
  const statuses: string[] = [];
  // The REAL project-history controller with real ref-backed stacks and real PNG layer assets.
  const history = useProjectHistoryController({
    isImageImportLocked: () => false, api: f.api, bitmapLayerWriteQueueRef: { current: f.queue },
    fileNameSyncStateRef: { current: "unsynced" }, folderPathRef: { current: f.root }, maxEntries: 8,
    markShotsDirty: () => {}, projectRef: f.ref, scriptImportCheckIdRef: { current: 0 },
    selectedShotIdsRef: { current: [] }, selectShotsByIds: () => {}, setAutosaveRevision: () => {},
    setFileNameSyncState: () => {}, setProject: () => {}, setScriptImportNeeded: () => {},
    setStatus: s => statuses.push(s), setWorkspaceSaveState: () => {},
    publishProject: (project, ids) => f.adapter.owner.publishEdit(project, ids)
  });
  const tLayer = f.ref.current.shots.find(s => s.id === "t")!.layers!.find(l => l.id === "layer-image")!;
  const tPngBefore = await fs.readFile(path.join(f.root, tLayer.bitmapPath));
  const preImport = await history.createHistoryEntry([tLayer.bitmapPath]);
  history.recordUndoEntry(preImport);
  const published = runApp("normalSaveScriptImportPublished", {
    normalSaveAppCallbacksRef: { current: { onPendingPublication: () => {} } },
    setScriptImportNeeded: () => {}, setStatus: () => {}, projectRef: f.ref, project: f.ref.current,
    invalidatePresentationHistory: history.invalidatePresentationHistory
  });
  expect(await f.run({ prepare, published })).toBe(true);
  const created = f.ref.current.shots.find(s => !["s", "t"].includes(s.id))!;
  const createdLayer = created.layers!.find(l => l.id === "layer-image")!;
  // The Import rewrote the EXISTING mismatched shot's PNG and materialized the NEW blank's PNG.
  expect(await fs.readFile(path.join(f.root, tLayer.bitmapPath))).not.toEqual(tPngBefore);
  // The App publication invalidates History for exactly the changed asset write facts.
  // Invalidation above was automatic through the actual App script publication callback.
  // The stale pre-import entry (recording the overwritten existing asset) is dropped.
  await history.applyUndoEntry();
  expect(statuses.at(-1)).toBe("Nothing to undo");
  // Actual Save output: the real exporter rewrites the pending working TIFFs from the internal PNGs.
  const saved = await f.adapter.save();
  expect(saved, `save error: ${(f.errors[0] as Error | undefined)?.message ?? "none"}`).toBe(true);
  const saveResult = await ((f.api.saveWorkspace as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value as Promise<{ normalSaveOutputs?: Array<{ targetPath: string; outputHash: string }> }>);
  expect(saveResult.normalSaveOutputs?.length).toBeGreaterThan(0);
  expect(f.api.saveWorkspace.mock.calls.at(-1)![0].dirtyShotIds!.sort()).toEqual(["t", created.id].sort());
  // Unbaked s also receives a source→target ACK because its filename was synchronized.
  expect(saveResult.normalSaveOutputs!.map((a: any) => a.shotId).sort()).toEqual(["s", "t", created.id].sort());
  for (const ack of saveResult.normalSaveOutputs ?? []) expect(ack.outputHash).toBe(await hash(ack.targetPath));
  expect(f.ref.current.pendingBake!.shots.t.state).toBe("synced");
  expect(f.ref.current.pendingBake!.shots[created.id].state).toBe("synced");
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect(await fs.readFile(f.ref.current.shots.find(s => s.id === "s")!.imagePath)).toEqual(f.originalTiff);
  for (const [id, rgba] of [["t", [0, 0, 255, 255]], [created.id, [255, 255, 255, 255]]] as const) {
    const shot = f.ref.current.shots.find(s => s.id === id)!;
    const { data, info } = await sharp(shot.imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([shot.swb!.canvasWidth, shot.swb!.canvasHeight]);
    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    expect([...data.subarray(center, center + 4)]).toEqual(rgba);
  }
  // Record a near-current entry for the mixed project (new shot + both existing shots' PNGs).
  const postSaveBytes = await fs.readFile(path.join(f.root, tLayer.bitmapPath));
  const postSave = await history.createHistoryEntry([tLayer.bitmapPath, createdLayer.bitmapPath]);
  history.recordUndoEntry(postSave);
  // A later real edit overwrites the existing shot's internal PNG.
  const laterBytes = await sharp({ create: { width: 4, height: 3, channels: 4, background: "green" } }).png().toBuffer();
  await fs.writeFile(path.join(f.root, tLayer.bitmapPath), laterBytes);
  // Undo restores the real pre-edit PNG bytes and keeps the mixed project (new + existing shots).
  await history.applyUndoEntry();
  expect(statuses.at(-1)).toBe("Undid last change");
  expect(await fs.readFile(path.join(f.root, tLayer.bitmapPath))).toEqual(postSaveBytes);
  expect(f.ref.current.shots.some(s => s.id === created.id)).toBe(true);
  expect(f.ref.current.shots.some(s => s.id === "t")).toBe(true);
  // Redo restores the later real PNG bytes.
  await history.applyRedoEntry();
  expect(statuses.at(-1)).toBe("Redid last change");
  expect(await fs.readFile(path.join(f.root, tLayer.bitmapPath))).toEqual(laterBytes);
});

it("B2 main checks retained origin transaction before creating any target asset", async () => {
  const f = await fixture();
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "b2-retained-")); dirs.push(target);
  const input = path.join(f.root, "input.md"); await fs.writeFile(input, "1. New shot\n");
  await fs.writeFile(path.join(f.root, ".storyboard-workbench/pending-file-transaction.json"), JSON.stringify({ version: 1, moves: [] }));
  await expect(f.mainCreate({ sourceMarkdownPath: input, targetFolderPath: target, blankShotPreset: "16:9", normalSave: true,
    normalSaveSource: { project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true } })).rejects.toThrow();
  expect(await fs.readdir(target)).toEqual([]); expect(await fs.readFile(f.imagePath)).toEqual(f.originalTiff);
});

it("B2 actual App→adapter→owner queue→registered main Create persists TIFF/PNG/JSON/MD and first production Save consumes pending", async () => {
  const f = await fixture(); f.useRegisteredPersistence();
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "b2-app-chain-")); dirs.push(parent);
  const target = path.join(parent, "new"), input = path.join(parent, "input.md");
  await fs.mkdir(target); await fs.writeFile(input, "1. Opening\n2. Close up\n");
  const createHandlers: Record<string, Function> = {};
  registerWorkspaceScriptIpcHandlers({ handle: (name: string, fn: Function) => { createHandlers[name] = fn; } } as never, {
    createFromStoryboardScript: f.mainCreate, inspectStoryboardScript: async () => ({}), addRecentFolder: async () => {}, ensureStoryboardScriptMarkdown: async () => false
  });
  const paths = { folderPath: f.root, metadataPath: f.metadataPath };
  const api = { ...f.api, createFromStoryboardScript: async (options: CreateProjectFromStoryboardScriptOptions) => structuredClone(await createHandlers["workspace:createFromStoryboardScript"]({}, options)) };
  const { createAppOpenCallerScope } = await import('./appOpenCallerScope.mjs');
  const caller = await createAppOpenCallerScope({ projectRef: f.ref, setProject: () => {}, queue: f.queue, freshToken: randomUUID,
    paths: () => paths, api: () => api as unknown as Window["storyboard"], onSave: () => {}, onError: (e: unknown) => f.errors.push(e) }, false, false,
    { publishScan: (scan: FolderScanPayload) => { paths.folderPath = scan.folderPath; paths.metadataPath = scan.metadataPath; } });
  let adapter = caller.renderAdapter;
  const draft = { sourceMarkdownPath: input, targetFolderPath: target, entryCount: 2 };
  const draftRef = { current: draft as typeof draft | undefined }, statuses: string[] = [];
  await runApp("handleCreateProjectFromStoryboardScript", {
    ...caller,
    window: { storyboard: api }, storyboardScriptImportDraft: draft, storyboardScriptImportDraftRef: draftRef,
    normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter }, blankShotPreset: "1.85:1",
    // Keep the original semantic event identity; all non-success statuses remain visible.
    setWorkspaceTask: () => {}, setStatus: (s: string) => statuses.push(s === 'Created storyboard from script' ? 'created' : s),
    setStoryboardScriptImportDraft: (d: typeof draft | undefined) => { draftRef.current = d; },
    publishNormalSaveFolderScan: (scan: FolderScanPayload) => { paths.folderPath = scan.folderPath; paths.metadataPath = scan.metadataPath; statuses.push("created"); },
    withStatus, loadFolderScan: () => { throw new Error("outside-queue load forbidden"); }
  })();
  adapter = caller.workspaceSlotsRef.current.active.adapter;
  expect(f.errors).toEqual([]); expect(statuses).toEqual(["created"]);
  expect(f.ref.current.shots.map(s => s.scriptText)).toEqual(["Opening", "Close up"]);
  const created = f.ref.current.shots;
  for (const s of created) {
    expect(f.ref.current.pendingBake!.shots[s.id]).toMatchObject({ state: "pending", acceptedOutputIdentity: await hash(s.imagePath) });
    expect(await sharp(path.join(target, s.layers![0].bitmapPath)).metadata()).toMatchObject({ width: 1998, height: 1080 });
  }
  expect(JSON.parse(await fs.readFile(paths.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(path.join(target, script.storyboardScriptFileName), "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect(await adapter.autosave(f.ref.current)).toBe(true);
  expect(await adapter.save(), `Save errors: ${f.errors.map(e => String(e)).join(";")}`).toBe(true);
  expect(f.api.saveWorkspace.mock.calls.at(-1)![0].dirtyShotIds!.sort()).toEqual(created.map(s => s.id).sort());
  for (const s of f.ref.current.shots) {
    expect(f.ref.current.pendingBake!.shots[s.id]).toMatchObject({ state: "synced", acceptedOutputIdentity: await hash(s.imagePath) });
    expect(await sharp(s.imagePath).metadata()).toMatchObject({ width: 1998, height: 1080 });
  }
  expect(JSON.parse(await fs.readFile(paths.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.imagePath)).toEqual(f.originalTiff);
});

it("r4 shared queue History captured ready refuses snapshots after real Save ACK and owner-final persist failure, then works after receipt retry", async () => {
  const f = await fixture();
  f.useRegisteredPersistence();
  await f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  const owner = f.adapter.owner, shot = f.ref.current.shots[0];
  const bitmapPath = shot.layers![0].bitmapPath, before = await fs.readFile(path.join(f.root, bitmapPath));
  let reads = 0, restores = 0, capturedReady = false;
  const api = { ...f.api,
    readLayerPng: async (payload: Parameters<typeof layer.readLayerPng>[0]) => { reads++; return layer.readLayerPng(payload); },
    writeLayerPng: async (payload: Parameters<typeof layer.writeLayerPng>[0]) => { restores++; return layer.writeLayerPng(payload); } };
  const history = useProjectHistoryController({ api,
    captureWorkspace: () => {
      const admissible = owner.captureEffectAdmission(); capturedReady = admissible();
      // Test-only negative control: reproduces cached-ready admission without changing production.
      return process.env.SWB_R4_NEGATIVE_HISTORY_READY === "1" ? (() => capturedReady) : admissible;
    },
    isImageImportLocked: () => false, bitmapLayerWriteQueueRef: { current: f.queue },
    fileNameSyncStateRef: { current: "unsynced" }, folderPathRef: { current: f.root },
    projectRef: f.ref, maxEntries: 60, selectedShotIdsRef: { current: [shot.id] },
    scriptImportCheckIdRef: { current: 0 }, markShotsDirty: () => {}, selectShotsByIds: () => {},
    setAutosaveRevision: () => {}, setFileNameSyncState: () => {}, setProject: () => {},
    setScriptImportNeeded: () => {}, setStatus: () => {}, setWorkspaceSaveState: () => {},
    publishProject: (p, ids) => owner.publishEdit(p, ids) });
  history.recordUndoEntry({ project: f.ref.current, selectedShotIds: [shot.id], fileNameSyncState: "unsynced",
    layerAssets: [{ bitmapPath, dataUrl: `data:image/png;base64,${before.toString("base64")}` }] });
  owner.publishEdit(p => ({ ...p, name: "Save receipt target" }), [shot.id]);
  const epoch = owner.capture().epoch;
  let ownerPersistCalls = 0;
  // This callback runs ONLY at renderer owner autosaveWorkspace, after main Save produced its ACK.
  // Main Save metadata writer remains untouched, so a premature MD failure cannot stand in.
  f.beforePersist(async () => {
    ownerPersistCalls++;
    expect(f.api.saveWorkspace).toHaveBeenCalledOnce();
    const raw = await f.api.saveWorkspace.mock.results[0].value;
    expect((raw as SaveWorkspacePayload).normalSaveOutputs?.length).toBe(1);
    throw new Error("owner final required persistence failed AFTER actual output ACK");
  });
  const saving = f.adapter.save();
  const undo = history.applyUndoEntry(); // capture ready synchronously, queue behind same Save
  expect(capturedReady).toBe(true);
  expect(await saving).toBe(false);
  await undo;
  expect(owner.capture().epoch).toBe(epoch);
  expect(ownerPersistCalls).toBe(1);
  expect(owner.captureEffectAdmission()()).toBe(false);
  expect(reads).toBe(0);
  expect(restores).toBe(0);
  expect(await fs.readFile(path.join(f.root, bitmapPath))).toEqual(before);
  f.beforePersist(async () => {});
  expect(await f.adapter.save()).toBe(true); // real baseline/H1 receipt retry, not a bool flip
  expect(owner.captureEffectAdmission()()).toBe(true);
  // Same controller remains usable. Record a CURRENT source entry after Save/rename;
  // do not falsify the retained pre-rename entry's filename or claim its safety here.
  history.recordUndoEntry({ project: f.ref.current, selectedShotIds: [shot.id], fileNameSyncState: "synced",
    layerAssets: [{ bitmapPath, dataUrl: `data:image/png;base64,${before.toString("base64")}` }] });
  await history.applyUndoEntry();
  expect(reads).toBe(1);
  expect(restores).toBe(1);
  expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("pending");
});

it.each(["same", "different"] as const)("r4 same App owner: interrupted A effect must not gate or taint B (%s relative path), and ABA retains A fact", async relative => {
  const a = await fixture(), b = await fixture();
  a.useRegisteredPersistence();
  {
    const shot = b.ref.current.shots[0], old = shot.layers![0].bitmapPath;
    const aPath = a.ref.current.shots[0].layers![0].bitmapPath;
    const changed = relative === "same" ? aPath : aPath.replace(/\.png$/u, "-other.png");
    await fs.mkdir(path.dirname(path.join(b.root, changed)), { recursive: true });
    await fs.rename(path.join(b.root, old), path.join(b.root, changed));
    b.ref.current = { ...b.ref.current, shots: [{ ...shot, layers: [{ ...shot.layers![0], bitmapPath: changed }] }] };
  }
  b.ref.current = { ...b.ref.current, pendingBake: { version: 1, shots: { s: {
    ...b.ref.current.pendingBake!.shots.s, state: "pending", editToken: "B-trusted-token"
  } } } };
  await fs.writeFile(b.metadataPath, JSON.stringify(b.ref.current));
  let active = { folderPath: a.root, metadataPath: a.metadataPath };
  const ref = a.ref, queue = a.queue;
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue,
    freshToken: () => randomUUID(), paths: () => active, api: () => a.api as never,
    onSave: () => {}, onError: () => {} });
  const open = (f: typeof a) => adapter.load(async () => ({ folderPath: f.root,
    folderName: "synthetic", metadataPath: f.metadataPath, images: [],
    preserveProjectWithoutImageMerge: true, project: JSON.parse(await fs.readFile(f.metadataPath, "utf8")) }),
    scan => { active = { folderPath: scan.folderPath, metadataPath: scan.metadataPath }; });
  expect(await open(a)).toBe(true);
  const owner = adapter.owner;
  let switched: Promise<boolean> | undefined;
  const url = `data:image/png;base64,${(await sharp({ create: { width: 4, height: 3,
    channels: 4, background: "blue" } }).png().toBuffer()).toString("base64")}`;
  const api = { ...a.api, writeLayerPng: async (payload: Parameters<typeof layer.writeLayerPng>[0]) => {
    const result = await layer.writeLayerPng(payload);
    switched = open(b); // real PNG completed, real load queued on the SAME App queue
    return result;
  } };
  const painting = useBitmapLayerPaintingController({ api: api as never,
    captureWorkspace: () => owner.captureEffectAdmission(),
    captureEffectCompletion: () => owner.captureEffectCompletion(),
    projectRef: ref, folderPath: a.root, bitmapLayerWriteQueueRef: { current: queue },
    createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {},
    markShotsDirty: () => {}, updateProject: () => {} });
  const shot = ref.current.shots[0];
  await expect(painting.handleBitmapSelectionTransform(shot, shot.layers![0].id, url)).rejects.toThrow(/retained/u);
  expect(await switched).toBe(true);
  expect(adapter.owner).toBe(owner); // never replace the singleton owner to evade handoffs
  expect(pendingBakeForProject(ref.current).shots.s.editToken).toBe("B-trusted-token");
  expect(owner.captureEffectAdmission()()).toBe(true);
  expect(owner.publishEdit(p => ({ ...p, name: "B metadata edit" }), [])).toBe(true);
  expect(await adapter.autosave(ref.current)).toBe(true);
  expect(await adapter.save()).toBe(true);
  expect(await open(a)).toBe(true);
  const fact = pendingBakeForProject(ref.current).shots.s;
  expect(fact.state).not.toBe("synced");
  if (fact.state === "unknown") expect(fact.editToken).toBeUndefined();
  expect(fact.state).toBe("pending");
  expect(fact.editToken).toBeTruthy();
  expect(await adapter.save()).toBe(true);
  const rgba = await sharp(ref.current.shots[0].imagePath).ensureAlpha().raw().toBuffer();
  expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
});

it("r4 completed A write must be preserved on disk before normal reload accepts it; new process cannot be its resolution", async () => {
  const f = await fixture();
  f.useRegisteredPersistence();
  await f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  const beforeTiff = await fs.readFile(f.imagePath);
  const shot = f.ref.current.shots[0], bitmapPath = shot.layers![0].bitmapPath;
  let reopened: Promise<boolean> | undefined;
  const blue = await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toBuffer();
  const api = { ...f.api, writeLayerPng: async (payload: Parameters<typeof layer.writeLayerPng>[0]) => {
    const result = await layer.writeLayerPng(payload);
    reopened = f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
    return result;
  } };
  const painting = useBitmapLayerPaintingController({ api: api as never,
    captureWorkspace: () => f.adapter.owner.captureEffectAdmission(),
    captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(),
    projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: f.queue },
    createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {},
    markShotsDirty: () => {}, updateProject: () => {} });
  await expect(painting.handleBitmapSelectionTransform(shot, shot.layers![0].id,
    `data:image/png;base64,${blue.toString("base64")}`)).rejects.toThrow(/retained/u);
  expect(await reopened).toBe(true);
  expect(await fs.readFile(path.join(f.root, bitmapPath))).toEqual(blue);
  expect(await fs.readFile(f.imagePath)).toEqual(beforeTiff);
  const disk = JSON.parse(await fs.readFile(f.metadataPath, "utf8")) as Project;
  expect(pendingBakeForProject(disk).shots.s.state).not.toBe("synced");
  expect(pendingBakeForProject(disk).shots.s.state).toBe("pending");
  const reopenedRef = { current: disk };
  const fresh = createNormalSaveAppAdapter({ projectRef: reopenedRef, setProject: () => {},
    queue: createBitmapLayerWriteQueue(), freshToken: randomUUID,
    paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }), api: () => f.api as never,
    onSave: () => {}, onError: () => {} });
  expect(await fresh.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")))).toBe(true);
  expect(pendingBakeForProject(reopenedRef.current).shots.s.editToken).toBe(disk.pendingBake!.shots.s.editToken);
  expect(await fresh.save()).toBe(true);
  const rgba = await sharp(reopenedRef.current.shots[0].imagePath).ensureAlpha().raw().toBuffer();
  expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  // Same-process fresh owner from real disk, NOT an OS/native Close or cold-process claim.
});

it("r5 completed effect required persistence failure refuses next reader and Save/Close until the exact A completion can persist", async () => {
  const a = await fixture(), b = await fixture(); a.useRegisteredPersistence();
  await a.adapter.owner.load(async () => JSON.parse(await fs.readFile(a.metadataPath, "utf8")));
  const bJson = await fs.readFile(b.metadataPath), beforeTiff = await fs.readFile(a.ref.current.shots[0].imagePath);
  let failures = true, reads = 0, loading: Promise<boolean> | undefined;
  a.beforePersist(async () => { if (failures) throw new Error("synthetic A required metadata failure"); });
  const api = { ...a.api, writeLayerPng: async (p: Parameters<typeof layer.writeLayerPng>[0]) => {
    const result = await layer.writeLayerPng(p);
    loading = a.adapter.load(async () => {
      reads++;
      return { folderPath: b.root, folderName: "B", metadataPath: b.metadataPath,
        project: JSON.parse(await fs.readFile(b.metadataPath, "utf8")), images: [], preserveProjectWithoutImageMerge: true };
    }, () => {});
    return result;
  } };
  const painting = useBitmapLayerPaintingController({ api: api as never,
    captureWorkspace: () => a.adapter.owner.captureEffectAdmission(),
    captureEffectCompletion: () => a.adapter.owner.captureEffectCompletion(), projectRef: a.ref,
    folderPath: a.root, bitmapLayerWriteQueueRef: { current: a.queue },
    createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {}, updateProject: () => {} });
  const shot = a.ref.current.shots[0];
  const url = `data:image/png;base64,${(await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toBuffer()).toString("base64")}`;
  await expect(painting.handleBitmapSelectionTransform(shot, shot.layers![0].id, url)).rejects.toThrow(/required metadata failure/);
  expect(await loading).toBe(false);
  expect(reads).toBe(0);
  expect(await fs.readFile(b.metadataPath)).toEqual(bJson);
  expect(pendingBakeForProject(a.ref.current).shots.s.state).toBe("pending");
  const failedSave = await a.adapter.save();
  expect(failedSave).toBe(false);
  const hide = vi.fn();
  finishSaveAndClose(new Map([["r5-completion-close", { destroy: hide }]]),
    { requestId: "r5-completion-close", saved: failedSave });
  expect(hide).not.toHaveBeenCalled(); // service seam, NOT native Close UI evidence
  expect(await fs.readFile(a.ref.current.shots[0].imagePath)).toEqual(beforeTiff);
  failures = false;
  expect(await a.adapter.save()).toBe(true);
  expect(a.adapter.owner.captureEffectAdmission()()).toBe(true);
  const rgba = await sharp(a.ref.current.shots[0].imagePath).ensureAlpha().raw().toBuffer();
  expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  expect(await fs.readFile(b.metadataPath)).toEqual(bJson);
});

it("r5 actual painting failure after a real PNG replacement retains unknown gate, not fabricated pending or safe cold reopen", async () => {
  const f = await fixture(); f.useRegisteredPersistence();
  await f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  const shot = f.ref.current.shots[0], oldTiff = await fs.readFile(shot.imagePath);
  let reads = 0, loading: Promise<boolean> | undefined;
  const api = { ...f.api, writeLayerPng: async (p: Parameters<typeof layer.writeLayerPng>[0]) => {
    await layer.writeLayerPng(p);
    loading = f.adapter.load(async () => { reads++; return { folderPath: f.root, folderName: "A", metadataPath: f.metadataPath,
      project: JSON.parse(await fs.readFile(f.metadataPath, "utf8")), images: [], preserveProjectWithoutImageMerge: true }; }, () => {});
    throw new Error("synthetic failed painting ACK after real replacement");
  } };
  const painting = useBitmapLayerPaintingController({ api: api as never,
    captureWorkspace: () => f.adapter.owner.captureEffectAdmission(), captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(),
    projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: f.queue },
    createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {}, updateProject: () => {} });
  const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toBuffer();
  await expect(painting.handleBitmapSelectionTransform(shot, shot.layers![0].id, `data:image/png;base64,${png.toString("base64")}`)).rejects.toThrow("failed painting ACK");
  expect(await loading).toBe(false); expect(reads).toBe(0);
  expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("unknown");
  expect(pendingBakeForProject(f.ref.current).shots.s.editToken).toBeUndefined();
  expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave()).toBe(false);
  expect(await fs.readFile(shot.imagePath)).toEqual(oldTiff);
  expect(await fs.readFile(path.join(f.root, shot.layers![0].bitmapPath))).toEqual(png);
  const destroy = vi.fn(); finishSaveAndClose(new Map([["failed-effect", { destroy }]]), { requestId: "failed-effect", saved: await f.adapter.save() });
  expect(destroy).not.toHaveBeenCalled(); // actual service seam, NOT native Close UI
});

it.each(["normal", "load"] as const)("r6 merge-visible %s preserves safe same-shot P2 using the actual generated merge id and physical output", async mode => {
  await mergeVisibleP2Case(mode, "safe");
});
it.each(["opacity", "blendMode", "dimensions", "participation"] as const)("r6 merge-visible refuses changed pixel dependency %s without false Save/Close", async change => {
  await mergeVisibleP2Case("load", change);
});

async function mergeVisibleP2Case(mode: "normal" | "load", change: "safe" | "opacity" | "blendMode" | "dimensions" | "participation") {
  const f = await fixture(); f.useRegisteredPersistence();
  await f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  f.adapter.owner.publishEdit(p => addBitmapLayer(p, "s", { name: "Paint", width: 4, height: 3 }), ["s"]);
  f.adapter.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s, layers: s.layers!.map((l, i) => i === 0 ? { ...l, locked: true } : l) })) }), ["s"]);
  const paint = f.ref.current.shots[0].layers!.at(-1)!;
  const green = await sharp({ create: { width: 4, height: 3, channels: 4, background: "green" } }).png().toBuffer();
  await layer.writeLayerPng({ folderPath: f.root, bitmapPath: paint.bitmapPath, dataUrl: `data:image/png;base64,${green.toString("base64")}` });
  expect(await f.adapter.save()).toBe(true);
  const original = f.ref.current, oldTiff = await fs.readFile(original.shots[0].imagePath), entered = barrier(), held = barrier();
  let mergedPath = "", mergeCalls = 0, snapshots: { bitmapPath: string; dataUrl?: string }[] = [], reads = 0;
  const api = { ...f.api, cleanupMergedLayerSources, mergeVisibleLayers: async (p: Parameters<typeof layer.mergeVisibleLayers>[0]) => {
    mergeCalls++; mergedPath = p.targetBitmapPath;
    const result = await createLayerAppHandlers().mergeVisible(p) as Awaited<ReturnType<typeof layer.mergeVisibleLayers>>;
    entered.release(); await held.promise; return result;
  } };
  vi.stubGlobal("window", { storyboard: api });
  const actions = useBitmapLayerActions({ captureEnsureScope: () => f.adapter.owner.captureEffectAdmission(),
    captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(), isImageImportLocked: () => false,
    projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: f.queue },
    createTransparentLayerDataUrl: async () => "",
    createHistoryEntry: async (paths = []) => {
      snapshots = await Promise.all(paths.map(async bitmapPath => ({ bitmapPath,
        dataUrl: await layer.readLayerPng({ folderPath: f.root, bitmapPath }) })));
      return { project: f.ref.current, layerAssets: snapshots };
    }, getHistoryLayerAssets: entry => entry.layerAssets,
    rebaseAddHistoryEntry: (entry, project) => ({ ...entry, project }),
    recordUndoEntry: () => {}, markShotsDirty: () => {},
    updateProject: update => { expect(f.adapter.owner.publishEdit(update, ["s"])).toBe(true); }, setStatus: () => {} });
  let loading: Promise<boolean> | undefined;
  try {
    const work = actions.handleMergeVisibleBitmapLayers("s"); await entered.promise;
    expect(mergeCalls).toBe(1);
    expect(snapshots.find(s => s.bitmapPath === paint.bitmapPath)?.dataUrl).toBeTruthy();
    expect(f.adapter.owner.publishEdit(p => ({ ...p, name: "safe project P2", shots: p.shots.map(s => ({ ...s,
      scriptText: "safe same-shot P2", layers: s.layers!.map((l, i) => {
        if (i === 0) return { ...l, name: "safe retained-layer P2" };
        if (change === "opacity") return { ...l, opacity: 0.5 };
        if (change === "blendMode") return { ...l, blendMode: "multiply" };
        if (change === "dimensions") return { ...l, width: l.width + 1 };
        if (change === "participation") return { ...l, visible: false };
        return l;
      }) })) }), ["s"])).toBe(true);
    if (mode === "load") loading = f.adapter.load(async () => { reads++; return {
      folderPath: f.root, folderName: "A", metadataPath: f.metadataPath,
      project: JSON.parse(await fs.readFile(f.metadataPath, "utf8")), images: [], preserveProjectWithoutImageMerge: true }; }, () => {});
    held.release(); await work;
    const mergedBytes = await fs.readFile(path.join(f.root, mergedPath));
    expect([...((await sharp(mergedBytes).ensureAlpha().raw().toBuffer()).subarray(0, 4))]).toEqual([0, 128, 0, 255]);
    expect(mergeCalls).toBe(1);
    if (change !== "safe") {
      expect(await loading).toBe(false); expect(reads).toBe(0);
      expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("unknown");
      expect(pendingBakeForProject(f.ref.current).shots.s.editToken).toBeUndefined();
      expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave(f.ref.current)).toBe(false);
      const destroy = vi.fn(); finishSaveAndClose(new Map([["merge-P2", { destroy }]]), { requestId: "merge-P2", saved: await f.adapter.save() });
      expect(destroy).not.toHaveBeenCalled(); expect(await fs.readFile(original.shots[0].imagePath)).toEqual(oldTiff);
      expect(await fs.readFile(path.join(f.root, mergedPath))).toEqual(mergedBytes);
      return; // same-process gate, not a cold-reset recovery PASS
    }
    if (loading) expect(await loading).toBe(true);
    expect(f.ref.current.name).toBe("safe project P2");
    expect(f.ref.current.shots[0].scriptText).toBe("safe same-shot P2");
    expect(f.ref.current.shots[0].layers![0].name).toBe("safe retained-layer P2");
    const target = f.ref.current.shots[0].layers!.find(l => l.bitmapPath === mergedPath)!;
    expect(target).toBeTruthy(); expect(f.ref.current.shots[0].activeLayerId).toBe(target.id);
    expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("pending");
    expect(await f.adapter.autosave(f.ref.current), String(f.errors)).toBe(true);
    expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).shots[0].scriptText).toBe("safe same-shot P2");
    expect(await f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")))).toBe(true);
    expect(f.ref.current.shots[0].layers!.find(l => l.id === target.id)?.bitmapPath).toBe(mergedPath);
    expect(await f.adapter.save()).toBe(true);
    expect(f.ref.current.shots[0].scriptText).toBe("safe same-shot P2");
    expect([...((await sharp(f.ref.current.shots[0].imagePath).ensureAlpha().raw().toBuffer()).subarray(0, 4))]).toEqual([0, 128, 0, 255]);
    expect(mergeCalls).toBe(1);
  } finally { held.release(); vi.unstubAllGlobals(); }
}

it.each((["clear", "delete", "merge-down", "merge-selected", "merge-visible", "history"] as const)
  .flatMap(kind => [{ kind, failed: false }, { kind, failed: true }]))("r5 actual $kind completed/failed=$failed effect before reload keeps metadata and Save honest", async ({ kind, failed }) => {
  const f = await fixture(); f.useRegisteredPersistence();
  await f.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  f.adapter.owner.publishEdit(p => addBitmapLayer(p, "s", { name: "Paint", width: 4, height: 3 }), ["s"]);
  let shot = f.ref.current.shots[0];
  const paint = shot.layers!.at(-1)!;
  const green = await sharp({ create: { width: 4, height: 3, channels: 4, background: "green" } }).png().toBuffer();
  await layer.writeLayerPng({ folderPath: f.root, bitmapPath: paint.bitmapPath, dataUrl: `data:image/png;base64,${green.toString("base64")}` });
  expect(await f.adapter.save()).toBe(true); // REAL output establishes H0 for the two-layer fixture
  shot = f.ref.current.shots[0];
  let loading: Promise<boolean> | undefined, reads = 0;
  const after = async <T,>(effect: Promise<T>): Promise<T> => {
    const result = await effect;
    loading = f.adapter.owner.load(async () => { reads++; return JSON.parse(await fs.readFile(f.metadataPath, "utf8")); });
    if (failed) throw new Error("synthetic failure after actual asset effect: no completion ACK");
    return result;
  };
  const api = { ...f.api, cleanupMergedLayerSources,
    writeLayerPng: (p: Parameters<typeof layer.writeLayerPng>[0]) => after(layer.writeLayerPng(p)),
    deleteLayerPng: (p: Parameters<typeof layer.deleteLayerPng>[0]) => after(layer.deleteLayerPng(p)),
    mergeLayerDown: (p: Parameters<typeof layer.mergeLayerDown>[0]) => after(layer.mergeLayerDown(p)),
    mergeVisibleLayers: (p: Parameters<typeof layer.mergeVisibleLayers>[0]) => after(Promise.resolve(createLayerAppHandlers().mergeVisible(p))) };
  const transparent = await sharp({ create: { width: 4, height: 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  if (kind === "history") {
    const history = useProjectHistoryController({ api,
      captureInstalledHistory: () => { const id = f.ref.current.id; return () => f.ref.current.id === id; },
      captureWorkspace: () => f.adapter.owner.captureEffectAdmission(),
      captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(),
      isImageImportLocked: () => false, bitmapLayerWriteQueueRef: { current: f.queue },
      fileNameSyncStateRef: { current: "synced" }, folderPathRef: { current: f.root },
      projectRef: f.ref, maxEntries: 60, selectedShotIdsRef: { current: ["s"] },
      scriptImportCheckIdRef: { current: 0 }, markShotsDirty: () => {}, selectShotsByIds: () => {},
      setAutosaveRevision: () => {}, setFileNameSyncState: () => {}, setProject: () => {},
      setScriptImportNeeded: () => {}, setStatus: () => {}, setWorkspaceSaveState: () => {},
      publishProject: (p, ids) => f.adapter.owner.publishEdit(p, ids) });
    history.recordUndoEntry({ project: { ...f.ref.current, name: "restored completed metadata" },
      selectedShotIds: ["s"], fileNameSyncState: "synced",
      layerAssets: [{ bitmapPath: paint.bitmapPath, dataUrl: `data:image/png;base64,${transparent.toString("base64")}` }] });
    await history.applyUndoEntry();
  } else {
    vi.stubGlobal("window", { storyboard: api });
    const installedHistory = useProjectHistoryController({ api, isImageImportLocked: () => false,
      bitmapLayerWriteQueueRef: { current: f.queue }, fileNameSyncStateRef: { current: 'synced' },
      folderPathRef: { current: f.root }, projectRef: f.ref, maxEntries: 60,
      selectedShotIdsRef: { current: ['s'] }, scriptImportCheckIdRef: { current: 0 },
      markShotsDirty: () => {}, selectShotsByIds: () => {}, setAutosaveRevision: () => {},
      setFileNameSyncState: () => {}, setProject: () => {}, setScriptImportNeeded: () => {},
      setStatus: () => {}, setWorkspaceSaveState: () => {} });
    const actions = useBitmapLayerActions({ captureEnsureScope: () => f.adapter.owner.captureEffectAdmission(),
      captureCompletedHistory: () => installedHistory.recordUndoEntry,
      captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(), isImageImportLocked: () => false,
      projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: f.queue },
      createTransparentLayerDataUrl: async () => `data:image/png;base64,${transparent.toString("base64")}`,
      createHistoryEntry: async (paths = []) => ({ project: f.ref.current, layerAssets: await Promise.all(paths.map(async bitmapPath => ({
        bitmapPath, dataUrl: await layer.readLayerPng({ folderPath: f.root, bitmapPath }) }))) }),
      getHistoryLayerAssets: entry => entry.layerAssets,
      rebaseAddHistoryEntry: (entry, project) => ({ ...entry, project }),
      recordUndoEntry: () => {}, markShotsDirty: () => {},
      updateProject: () => {}, setStatus: () => {} });
    try {
      if (kind === "clear") await actions.handleClearBitmapLayer("s", paint.id);
      if (kind === "delete") await actions.handleRemoveBitmapLayer("s", paint.id);
      if (kind === "merge-down") await actions.handleMergeBitmapLayerDown("s", paint.id);
      if (kind === "merge-selected") await actions.handleMergeBitmapLayers("s", paint.id, shot.layers!.map(l => l.id));
      if (kind === "merge-visible") await actions.handleMergeVisibleBitmapLayers("s");
    } catch (error) { if (!failed) throw error; }
    finally { vi.unstubAllGlobals(); }
  }
  if (failed) {
    await expect(loading).rejects.toThrow("no completion ACK"); // owner.load propagates; App adapter catches to false
    expect(reads).toBe(0);
    expect(f.adapter.owner.captureEffectAdmission()()).toBe(false);
    expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("unknown");
    expect(pendingBakeForProject(f.ref.current).shots.s.editToken).toBeUndefined();
    expect(await f.adapter.save()).toBe(false);
    expect(await f.adapter.autosave()).toBe(false);
    // Gate is same-process safety, not a durable record or a cold-reopen recovery claim.
    return;
  }
  expect(await loading).toBe(true);
  expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("pending");
  const target = f.ref.current.shots[0];
  if (kind === "delete" || kind.startsWith("merge")) expect(target.layers!.some(l => l.id === paint.id)).toBe(false);
  if (kind === "clear") expect(target.layers!.find(l => l.id === paint.id)?.cleared).toBe(true);
  if (kind === "history") expect(f.ref.current.name).toBe("restored completed metadata");
  expect(await f.adapter.save()).toBe(true);
  const rgba = await sharp(f.ref.current.shots[0].imagePath).ensureAlpha().raw().toBuffer();
  expect([...rgba.subarray(0, 4)]).toEqual(kind.startsWith("merge") ? [0, 128, 0, 255] : [255, 0, 0, 255]);
});

async function fixture(options: { matteMode?: "embedded" | "expanded"; secondShot?: { matteMode?: "embedded" | "expanded" } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "script-import-chain-")); dirs.push(root);
  const imagePath = path.join(root, "a.tiff");
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).tiff().toFile(imagePath);
  const scanned = addImportedImages(createProject("Synthetic"), [{ imagePath, fileName: "a.tiff", width: 4, height: 3 }]).shots[0];
  let p: Project = { ...createProject("Synthetic"), shots: [{ ...scanned, id: "s", order: 0, scriptText: "old line" }], pendingBake: { version: 1, shots: {} } };
  p = { ...p, shots: p.shots.map(s => ensureBitmapLayerMetadata(s)) };
  const s0 = p.shots[0];
  await fs.mkdir(path.dirname(path.join(root, s0.layers![0].bitmapPath)), { recursive: true });
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).png().toFile(path.join(root, s0.layers![0].bitmapPath));
  const presentation = options.matteMode
    ? { ...s0.presentation, matte: { mode: options.matteMode, barHeight: 0.1 } }
    : s0.presentation;
  p = { ...p, shots: [{ ...s0, presentation, swb: { ...s0.swb!, status: "owned" as const } }] };
  p = { ...p, pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: await hash(imagePath) } } } };
  // A second owned shot with no scene matte: when the scene demands a matte this is an
  // existing-only mismatch that the prepare must still inherit for (newIds stays empty).
  if (options.secondShot) {
    const imagePath2 = path.join(root, "b.tiff");
    await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).tiff().toFile(imagePath2);
    const scanned2 = addImportedImages(createProject("Synthetic"), [{ imagePath: imagePath2, fileName: "b.tiff", width: 4, height: 3 }]).shots[0];
    let t = ensureBitmapLayerMetadata({ ...scanned2, id: "t", order: 1, scriptText: "second line" });
    await fs.mkdir(path.dirname(path.join(root, t.layers![0].bitmapPath)), { recursive: true });
    await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(path.join(root, t.layers![0].bitmapPath));
    t = { ...t, presentation: options.secondShot.matteMode ? { ...t.presentation, matte: { mode: options.secondShot.matteMode, barHeight: 0.1 } } : t.presentation, swb: { ...t.swb!, status: "owned" as const } };
    p = { ...p, shots: [...p.shots, t], pendingBake: { version: 1, shots: { ...p.pendingBake!.shots, t: { state: "synced", acceptedOutputIdentity: await hash(imagePath2) } } } };
  }
  const originalTiff = await fs.readFile(imagePath);
  const metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json");
  const mdPath = path.join(root, script.storyboardScriptFileName);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, `${JSON.stringify(p, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, options.secondShot ? "1. new line\n2. second line\n" : "1. new line\n", "utf8");

  const recovery = { current: undefined as string | undefined };
  const errors: unknown[] = [], writes: Project[] = [];
  let mdFault = false, beforePersist: (() => Promise<void>) | undefined, effectFault: (() => Promise<void>) | undefined;
  let afterEffect: (() => Promise<void>) | undefined, lastScan: FolderScanPayload | undefined, layerDirFault = false;
  let failLayersMkdirOn = 0, layersMkdirCount = 0;
  let unlinkFault: ((filePath: string) => boolean) | undefined;
  let handler!: (e: unknown, payload: ImportSwbFormatPayload) => Promise<FolderScanPayload>;
  let saveHandler!: (e: unknown, payload: WorkspacePayload) => Promise<WorkspacePayload>;
  const assetHandlers: Record<string, Function> = {};
  const bindings = {
    ...fs, ...renames, ...bitmap, ...safety, ...layer, ...script, prepareProtectedLayerReplacement, withLayerFileOperation, mapWithConcurrency,
    removeOwnedFile: (receipt: OwnedFileReceipt): Promise<void> => removeOwnedFile(receipt, bindings.unlink),
    path, sharp, createHash, randomUUID,
    createBlankShot, createProjectFromStoryboardScriptMarkdown, createImportedImageRecords, createPreview, pixelFingerprint, previewRootForFolder,
    createWorkspaceAssetAppHandlers, registerWorkspaceAssetIpcHandlers,
    createWorkspacePendingAppHandlers, registerWorkspacePendingIpcHandlers, beginPendingFileTransaction,
    manualImageImportAdmission, automaticImageImportAdmission, recoverFailedImport, hasPendingFileTransaction,
    ImportRecoveryIncompleteError, normalSaveImportFailure, workspaceEffectFailure,
    recoverFailedSave, withSuccessfulSaveArtifactCleanup, ...tiffPreparation, bitmapLayersForShot: orderedBitmapLayersForShot,
    writePhotoshopLayeredTiffsForInPlaceSave, saveProgressShotIds, countSaveProgressShots,
    cleanupDeletedShotLayerDirectories, stagePendingDeletedShotFiles, trashPendingDeletedShotFiles,
    app: { getAppPath: () => process.cwd() }, process,
    resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    // Preserve original pre-effect refusal controls at the new filesystem port.
    writeProtectedLayerFile: async (...args: Parameters<typeof protectedWriter>) => {
      const directory = path.dirname(args[1]);
      if (layerDirFault && directory.includes("layers")) throw new Error("blank layer dir failed");
      if (directory.includes("layers")) { layersMkdirCount += 1; if (failLayersMkdirOn && layersMkdirCount === failLayersMkdirOn) throw new Error("simulated layer directory failure"); }
      return protectedWriter(...args);
    },
    createWorkspaceTaskProgressReporter: () => () => {},
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => { if (args[0] === mdPath && mdFault) throw new Error("required MD failed after JSON"); await fs.writeFile(...args); },
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      return fs.mkdir(...args);
    },
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (unlinkFault?.(String(args[0]))) { const error = new Error("simulated unlink failure") as NodeJS.ErrnoException; error.code = "EPERM"; throw error; }
      return fs.unlink(...args);
    },
    ipcMain: { handle: (name: string, fn: typeof handler) => { if (name === "workspace:save") saveHandler = fn; else if (name === "workspace:importSwbFormat") handler = fn; else assetHandlers[name] = fn; } }
  };
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  let createExpression = "";
  const findCreate = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(tree) === "createFromStoryboardScript") createExpression = n.initializer.getText(tree);
    ts.forEachChild(n, findCreate);
  };
  findCreate(tree);
  if (!createExpression) throw new Error("production Create callback missing");
  const selected = tree.statements.filter(n => ts.isVariableStatement(n) && scriptNames.includes(n.declarationList.declarations[0].name.getText(tree)));
  expect(selected).toHaveLength(scriptNames.length);
  const block = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  const pendingAndCopy = source.slice(source.indexOf("  registerWorkspaceAssetIpcHandlers("), source.indexOf("  registerImageIpcHandlers("));
  const compiled = ts.transpileModule(`${selected.map(n => n.getText(tree)).join("\n")}\n${source.slice(source.indexOf('  ipcMain.handle("workspace:save"'), source.indexOf('  ipcMain.handle("workspace:exportPhotoshopTiffs"'))}\n${block}\n${pendingAndCopy}\n; return { create: (${createExpression}), persist: writeProjectFiles, ensure: ensureProjectLayerAssets, admit: assertNormalSaveAdmission, readonly: ensureStoryboardScriptMarkdown, records: createImageRecords };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const keys = Object.keys(bindings).filter(k => k !== "default");
  const chain = new Function("isCertifiedPendingBakeEntry", ...keys, compiled)(isCertifiedPendingBakeEntry, ...keys.map(k => (bindings as Record<string, unknown>)[k])) as {
    create: (options: CreateProjectFromStoryboardScriptOptions) => Promise<FolderScanPayload>;
    persist: (metadataPath: string, folderPath: string, project: Project) => Promise<void>;
    ensure: (project: Project, folderPath: string, options?: { includeExternalShots?: boolean }) => Promise<void>;
    admit: (payload: ProjectPayload, renamed: boolean, _unused?: never) => Promise<void>;
    readonly: (folderPath: string, project?: Project, readOnly?: boolean) => Promise<boolean>;
  };
  const autosaveHandlers: Record<string, (event: unknown, payload: ProjectPayload) => Promise<unknown>> = {};
  // Observe the registered admission seam while delegating unchanged production logic.
  const normalAutosaveAdmission = vi.fn((payload: ProjectPayload) => payload.normalSave ? chain.admit(payload, false) : undefined);
  registerWorkspacePersistenceIpcHandlers({ handle: (name: string, fn: (event: unknown, payload: ProjectPayload) => Promise<unknown>) => { autosaveHandlers[name] = fn; } }, {
    assertAdmission: normalAutosaveAdmission,
    assertEnsureAdmission: async payload=>{if(payload.normalSave&&await hasPendingFileTransaction(payload.folderPath))throw new Error("Pending transaction prevents asset initialization; assets retained");},
    ensureProjectLayerAssets: (project, folderPath, o) => chain.ensure(project, folderPath, o),
    writeProjectFiles: (m, f, pr) => chain.persist(m, f, pr)
  });

  const ref = { current: p }, queue = createBitmapLayerWriteQueue(), published = vi.fn();
  let notifyProject: (project: Project) => void = () => {};
  let requireRegistered = false;
  const api = {
    importSwbFormat: vi.fn(async (payload: ImportSwbFormatPayload) => {
      await effectFault?.();
      // Plain production main result: no preload-side Error is fabricated or decoded here.
      // The actual renderer adapter consumes and decodes this result after the bridge seam.
      const raw = await handler({ sender: {} }, payload);
      if (!("ok" in raw)) lastScan = raw;
      await afterEffect?.();
      return raw;
    }),
    readOutputIdentity: hash,
    ensureLayerAssets: async (payload: { project: Project; folderPath: string }) => { await chain.ensure(payload.project, payload.folderPath); return payload; },
    readLayerPng: layer.readLayerPng, writeLayerPng: layer.writeLayerPng, deleteLayerPng: layer.deleteLayerPng,
    copyShotAssets: (payload: unknown) => assetHandlers["workspace:copyShotAssets"]({}, payload),
    moveShotsToPending: (payload: unknown, ids: string[]) => assetHandlers["workspace:moveShotsToPending"]({}, payload, ids),
    restoreShotsFromPending: (payload: unknown, ids: string[]) => assetHandlers["workspace:restoreShotsFromPending"]({}, payload, ids),
    // Exact workspace:save handler, production output modules/admission/ACK and required persistence.
    // Owned fixture shots take the real no-conversion Import branch; no Trash is requested.
    saveWorkspace: vi.fn(async (payload: SaveWorkspacePayload) => saveHandler({ sender: {} }, payload)),
    autosaveWorkspace: async (payload: WorkspacePayload) => {
      writes.push(payload.project);
      await beforePersist?.();
      if (requireRegistered) return autosaveHandlers["workspace:autosave"](undefined, payload);
      await chain.persist(metadataPath, root, payload.project);
      return payload;
    }
  };
  const adapter = await createAppRootActor({ projectRef: ref, setProject: project => notifyProject(project), queue, freshToken: () => "fresh",
    paths: () => ({ folderPath: root, metadataPath }), api: () => api as unknown as Window["storyboard"],
    assertAdmission: () => { if (recovery.current) throw new Error(recovery.current); },
    assertImportAdmission: () => { if (recovery.current) throw new Error(recovery.current); },
    onImportRecoveryRequired: message => { recovery.current = message; }, onSave: () => {}, onError: e => errors.push(e) });
  return {
    normalAutosaveAdmission,ensureRegisteredAssets:(payload:WorkspacePayload)=>autosaveHandlers["workspace:ensureLayerAssets"](undefined,payload),mainCreate: chain.create, root, ref, api, adapter, queue, recovery, errors, io: api.importSwbFormat, originalTiff, imagePath, metadataPath, mdPath, published, writes,
    get lastScan() { return lastScan; },
    onProject: (fn: (project: Project) => void) => { notifyProject = fn; },
    useRegisteredPersistence: () => { requireRegistered = true; },
    readonly: chain.readonly as ((folderPath: string, project: Project, readOnly: boolean) => Promise<boolean>),
    run: (extra: Partial<Parameters<typeof adapter.scriptImport>[0]> = {}) =>
      adapter.scriptImport({ blankShotPreset: "16:9", dirtyShotIds: [], prepare: async (project: Project) => project, published, ...extra }),
    autosaveRegistered: async () => { requireRegistered = true; try { return await adapter.owner.autosave(); } finally { requireRegistered = false; } },
    setMdFault: () => { mdFault = true; },
    clearMdFault:()=>{mdFault=false;},
    setLayerDirFault: () => { layerDirFault = true; },
    setFailLayersMkdirOn: (count: number) => { failLayersMkdirOn = count; },
    setUnlinkFault: (fn: (filePath: string) => boolean) => { unlinkFault = fn; },
    get layersMkdirCount() { return layersMkdirCount; },
    beforePersist: (fn: () => Promise<void>) => { beforePersist = fn; },
    setFaultEffect: (fn: () => Promise<void>) => { effectFault = fn; },
    setAfterEffect: (fn: () => Promise<void>) => { afterEffect = fn; }
  };
}
type ProjectPayload = { project: Project; folderPath: string; metadataPath: string; normalSave?: boolean };

// Cumulative P0-A: actual App declarations/controller options, registered normal
// autosave and production Save. Clock/React rendering and pre-rendered canvas
// input are fixture boundaries; no claim of cold process/UI brush geometry.
const cumulativeAppPorts = async (f: Awaited<ReturnType<typeof fixture>>, enabled = true) => {
  const noop = () => {};
  let serial = 0;
  const adapter = await createAppRootActor({ projectRef: f.ref, setProject: noop, queue: f.queue,
    freshToken: () => `cumulative-${++serial}`, paths: () => ({ folderPath: f.root, metadataPath: f.metadataPath }),
    api: () => f.api as unknown as Window["storyboard"], onSave: noop, onError: e => f.errors.push(e) });
  const bindings = { normalSaveAppEnabled: enabled, normalSaveAppAdapterRef: { current: adapter }, projectRef: f.ref,
    recordProjectUndoEntry: noop, changedShotIdsForBitmapRevision, historyDirtyShotIds, projectAcceptedExternalEdits,
    bumpShotBitmapRevisions, setProject: noop, setShotBitmapRevisionById: noop, setWorkspaceSaveState: noop,
    setFileNameSyncState: noop, setAutosaveRevision: noop, scriptImportCheckIdRef: { current: 0 },
    setScriptImportNeeded: noop, setStatus: noop, folderPath: f.root, metadataPath: f.metadataPath,
    folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath },
    workspaceRecoveryRequiredRef: f.recovery,
    bitmapLayerWriteQueueRef: { current: f.queue }, window: { storyboard: f.api },
    createHistoryEntryFromLayerAssets: (assets: unknown) => assets, recordUndoEntry: noop, markShotsDirty: noop };
  const workspaceSession = runApp("workspaceSession", { ...bindings, createWorkspaceSession,
    aiApplyWorkspaceIdentityRef: { current: {} } });
  const updateProject = runApp("updateProject", bindings);
  // Execute the actual newly wired App declaration, not a substitute admission.
  const admitAssetIntent = runApp("admitAssetIntent", bindings);
  const tree = ts.createSourceFile("App.tsx", sourceApp, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const options = (controller: string, extra: Record<string, unknown> = {}) => {
    let expression = "";
    const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(tree) === controller) expression = n.arguments[0].getText(tree); ts.forEachChild(n, visit); };
    visit(tree); expect(expression).toBeTruthy();
    const b = appCallerAdapterScope({ ...bindings, updateProject, workspaceSession, admitAssetIntent, ...extra });
    return new Function(...Object.keys(b), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(b));
  };
  const persist = runApp("persistWorkspace", bindings);
  const ordinaryAutosave = async () => {
    f.useRegisteredPersistence();
    let fire!: () => void, settle!: () => void;
    const ack = new Promise<void>(r => { settle = r; });
    const cleanup = registerWorkspaceAutosave({ autosaveRevision: 1, hasStoryboardApi: true,
      folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath }, projectRef: f.ref,
      persistWorkspace: async (...args) => { try { await persist(...args); } finally { settle(); } },
      setAutosaveError: noop, setStatus: noop, setWorkspaceSaveState: noop,
      timers: { setTimeout: callback => { fire = callback; return 1; }, clearTimeout: noop } });
    expect(fire).toBeTypeOf("function"); fire(); await ack; cleanup?.();
    expect(f.errors, f.errors.map(String).join("\n")).toEqual([]);
    expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")), JSON.stringify({ writes: f.writes, current: f.ref.current })).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
    expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  };
  return { adapter, updateProject, ordinaryAutosave,
    painting: useBitmapLayerPaintingController(options("useBitmapLayerPaintingController")),
    metadata: useLayerMetadataActionController(options("useLayerMetadataActionController", {
      setDeleteTarget: noop, shotSelectionAnchorIdRef: { current: undefined }
    })) };
};

for (const mode of ["brush", "eraser", "transform", "opacity", "hidden", "dimensions"] as const) {
  it(`cumulative actual App ${mode} publication survives ordinary autosave/disk reload and production Save`, async () => {
    const f = await fixture(), ports = await cumulativeAppPorts(f), shot = f.ref.current.shots[0], l = shot.layers![0];
    const h0 = await hash(f.imagePath);
    const originalComposite = await sharp(f.imagePath).ensureAlpha().raw().toBuffer();
    if (["brush", "eraser", "transform"].includes(mode)) {
      // Renderer supplies its actual renderedDataUrl fast-path; use synthetic
      // known RGBA to test transport/publication/output, not replace a writer.
      const color = mode === "eraser" ? { r: 0, g: 0, b: 0, alpha: 0 } : "blue";
      const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: color } }).png().toBuffer();
      const url = `data:image/png;base64,${png.toString("base64")}`;
      if (mode === "transform") await ports.painting.handleBitmapSelectionTransform(shot, l.id, url);
      else await ports.painting.handleBitmapStroke(shot, l.id, { id: "stroke", tool: mode as "brush" | "eraser", color: "blue", size: 1, opacity: 1, points: [0, 0, 1, 1] }, url);
      expect(await sharp(path.join(f.root, l.bitmapPath)).ensureAlpha().raw().toBuffer()).toEqual(await sharp(png).ensureAlpha().raw().toBuffer());
    } else if (mode === "opacity" || mode === "hidden") {
      ports.metadata.handleUpdateLayer(shot.id, l.id, mode === "opacity" ? { opacity: 0.5 } : { visible: false });
    } else {
      // Dimensions publication seam, NOT a GUI matte/resize controller proof.
      ports.updateProject((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s,
        swb: { ...s.swb!, canvasHeight: 1230 }, layers: s.layers!.map(x => ({ ...x, height: 1230 })) })) }), false);
    }
    expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "cumulative-1", acceptedOutputIdentity: h0 });
    await ports.ordinaryAutosave();
    expect(await hash(f.imagePath)).toBe(h0);
    const persisted = JSON.parse(await fs.readFile(f.metadataPath, "utf8"));
    // A→B→A and same-dir reload read through the actual owner queue. This is
    // same-process JSON reopen; new-process cold coverage remains a later gate.
    expect(await ports.adapter.owner.load(async () => createProject("B"))).toBe(true);
    expect(await ports.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")))).toBe(true);
    expect(f.ref.current.pendingBake!.shots.s).toEqual(persisted.pendingBake.shots.s);
    expect(f.ref.current.pendingBake!.shots.s.editToken).toBeTruthy();
    expect(await ports.adapter.save(), String(f.errors)).toBe(true);
    const saved = f.ref.current.shots[0], image = saved.imagePath;
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(4); expect(info.height).toBe(mode === "dimensions" ? 1230 : 3);
    // Existing single-layer all-hidden exporter policy: no composite bake;
    // TIFF metadata is still written. Do not change that policy in this fix.
    const expected = mode === "opacity" ? [255, 127, 127] : mode === "hidden" ? [...originalComposite.subarray(0, 3)] : mode === "eraser" ? [255, 255, 255] : mode === "brush" || mode === "transform" ? [0, 0, 255] : [255, 0, 0];
    expect([...data.subarray(0, 3)]).toEqual(expected);
    expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "synced", acceptedOutputIdentity: await hash(image) });
    expect(f.ref.current.pendingBake!.shots.s.editToken).toBeUndefined();
    expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
    if (mode === "opacity") expect(saved.layers![0].opacity).toBe(0.5);
    if (mode === "hidden") expect(saved.layers![0].visible).toBe(false);
    const xmp = (await sharp(image).metadata()).xmpAsString!;
    const encoded = /<swb:metadata>([^<]+)<\/swb:metadata>/.exec(xmp)![1];
    const actualTiffMetadata = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    expect(actualTiffMetadata.canvasHeight).toBe(mode === "dimensions" ? 1230 : 3);
    expect(actualTiffMetadata.layers[0]).toMatchObject({
      visible: mode !== "hidden", opacity: mode === "opacity" ? 0.5 : 1,
      height: mode === "dimensions" ? 1230 : 3
    });
  });
}

it("canonical legacy 2 — actual App autosaved paint survives fresh adapter reconstruction without an in-memory dirty tracker", async () => {
  const f = await fixture(), producer = await cumulativeAppPorts(f), shot = f.ref.current.shots[0], layer = shot.layers![0];
  const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toBuffer();
  await producer.painting.handleBitmapSelectionTransform(shot, layer.id, `data:image/png;base64,${png.toString("base64")}`);
  const token = f.ref.current.pendingBake!.shots.s.editToken;
  await producer.ordinaryAutosave();
  // Fresh Node process reconstructs the production adapter/owner from real JSON
  // with read-only real identity ports. No tracker, token factory or writer is shared.
  // Full Electron UI/native lifecycle remains separate; actual TIFF Save below is real.
  const child = spawnSync(process.execPath, ["scripts/normal-save-reopen-probe.mjs", f.root, f.metadataPath], { encoding: "utf8", env: process.env, timeout: 30000 });
  expect(child.status, child.stderr).toBe(0);
  const reopenedDisk = JSON.parse(child.stdout);
  expect(reopenedDisk.pid).not.toBe(process.pid);
  expect(reopenedDisk.readOnly).toBe(true);
  expect(reopenedDisk.project).toEqual(JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  f.ref.current = reopenedDisk.project;
  const reopened = await cumulativeAppPorts(f);
  expect(reopened.adapter).not.toBe(producer.adapter);
  expect(await reopened.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")))).toBe(true);
  expect(f.ref.current.pendingBake!.shots.s.editToken).toBe(token);
  expect(await reopened.adapter.save(), String(f.errors)).toBe(true);
  const saved = f.ref.current.shots[0];
  expect(await sharp(saved.imagePath).ensureAlpha().raw().toBuffer()).toEqual(await sharp(png).ensureAlpha().raw().toBuffer());
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "synced", acceptedOutputIdentity: await hash(saved.imagePath) });
  expect(f.ref.current.pendingBake!.shots.s.editToken).toBeUndefined();
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
});

it("cumulative actual App queued painting refuses a newer load request before its first PNG effect", async () => {
  const f = await fixture(), ports = await cumulativeAppPorts(f), shot = f.ref.current.shots[0], layer = shot.layers![0];
  const original = await fs.readFile(path.join(f.root, layer.bitmapPath));
  const gate = barrier();
  const held = f.queue.runExclusive(() => gate.promise);
  const pixels = await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toBuffer();
  const write = ports.painting.handleBitmapSelectionTransform(shot, layer.id, `data:image/png;base64,${pixels.toString("base64")}`);
  const load = ports.adapter.owner.load(async () => JSON.parse(await fs.readFile(f.metadataPath, "utf8")));
  gate.release(); await held; await write; expect(await load).toBe(true);
  expect(await fs.readFile(path.join(f.root, layer.bitmapPath))).toEqual(original);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("synced");
});

it("canonical legacy 5 — actual normal autosave and Save do not rebake an unedited external original", async () => {
  const f = await fixture();
  const external = f.ref.current.shots[0];
  // Fixture baseline is a real completed TIFF with synced H0, never an edit token.
  f.ref.current = { ...f.ref.current, shots: [{ ...external, swb: { ...external.swb!, status: "non-swb" } }] };
  const ports = await cumulativeAppPorts(f), original = await fs.readFile(f.imagePath);
  expect(await ports.adapter.load(async () => ({ folderPath: f.root, metadataPath: f.metadataPath, folderName: "Synthetic", images: [], project: f.ref.current }), () => {})).toBe(true);
  f.useRegisteredPersistence();
  const metadata = await fs.readFile(f.metadataPath), md = await fs.readFile(f.mdPath);
  // Unimported external source is deliberately refused by actual normal admission,
  // not made "certified" to get a green test. Neither call may convert/rebake it.
  expect(await ports.adapter.autosave(f.ref.current)).toBe(false);
  expect(f.normalAutosaveAdmission).toHaveBeenCalledTimes(1);
  expect(f.normalAutosaveAdmission.mock.calls[0][0]).toMatchObject({ normalSave: true, folderPath: f.root, metadataPath: f.metadataPath });
  expect(f.normalAutosaveAdmission.mock.calls[0][0].project).toBe(f.ref.current);
  expect(f.writes).toEqual([f.ref.current]);
  expect(f.errors).toHaveLength(1);
  expect(String(f.errors[0])).toContain("not certified");
  expect(await fs.readFile(f.imagePath)).toEqual(original);
  expect(await fs.readFile(f.metadataPath)).toEqual(metadata);
  expect(await fs.readFile(f.mdPath)).toEqual(md);
  expect(pendingBakeForProject(f.ref.current).shots.s.editToken).toBeUndefined();
  expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("synced");
  expect(f.api.saveWorkspace).not.toHaveBeenCalled();
  expect(await ports.adapter.save()).toBe(false);
  expect(f.api.saveWorkspace).toHaveBeenCalledTimes(1);
  expect(f.api.saveWorkspace.mock.calls[0][0]).toMatchObject({ normalSave: true, folderPath: f.root, metadataPath: f.metadataPath, dirtyShotIds: [] });
  expect(f.errors).toHaveLength(2);
  expect(String(f.errors[1])).toContain("not certified");
  expect(await fs.readFile(f.imagePath)).toEqual(original);
  expect(await fs.readFile(f.metadataPath)).toEqual(metadata);
  expect(await fs.readFile(f.mdPath)).toEqual(md);
  expect(f.normalAutosaveAdmission).toHaveBeenCalledTimes(1); // Save error cannot masquerade as autosave admission.
  expect(pendingBakeForProject(f.ref.current).shots.s.editToken).toBeUndefined();
  expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("synced");
  expect(f.api.saveWorkspace.mock.calls.every(([payload]) => payload.dirtyShotIds?.length === 0)).toBe(true);
});

it("canonical legacy 6 — actual normal Save omits parked roots and retains undefined versus empty selection semantics", async () => {
  const f = await fixture({ secondShot: {} }), ports = await cumulativeAppPorts(f);
  const parked = f.ref.current.shots[1], parkedPath = parked.imagePath;
  // Real Pending transaction moves the synthetic root and publishes its new path.
  expect(await ports.adapter.pending("park", p => ({ ...p, shots: p.shots.filter(s => s.id !== "t"), parkedShots: [parked] }), ["t"])).toBe(true);
  const original = await fs.readFile(f.ref.current.parkedShots![0].imagePath);
  ports.metadata.handleUpdateLayer("s", f.ref.current.shots[0].layers![0].id, { opacity: 0.5 });
  await ports.ordinaryAutosave();
  expect(await ports.adapter.save(), String(f.errors)).toBe(true);
  expect(await fs.readFile(f.ref.current.parkedShots![0].imagePath)).toEqual(original);
  expect(f.ref.current.parkedShots![0].id).toBe("t");
  expect(countSaveProgressShots(f.ref.current, new Set(["t"]))).toBe(0);
  expect(countSaveProgressShots(f.ref.current, saveProgressShotIds([], []))).toBe(0);
  expect(countSaveProgressShots(f.ref.current, saveProgressShotIds(undefined, []))).toBe(1);
  expect(f.api.saveWorkspace.mock.calls[0][0].dirtyShotIds).toEqual(["s"]);
});
