import { expect, it, vi } from "vitest";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createProject, parkShotGroup } from "../shared/projectOps";
import { workspaceCloseGuardPayload } from "./workspaceCloseGuardController";
import { autosaveErrorReducer } from "./autosaveError";
import { useStoryboardDragEndController } from "./storyboardDragEndController";
import * as history from "./projectHistoryController";
it("Pending history rebases concurrent metadata undo to moved namespace and rejects changed lineage", async () => {
  const before = project(), after = parkShotGroup(before, ["s"]);
  after.parkedShots![0].imagePath = "/w/Pending/a.tiff";
  after.pendingBake!.shots.s = { state: "synced", acceptedOutputIdentity: h1 };
  const entry = { project: before, selectedShotIds: ["s"], fileNameSyncState: "synced" as const };
  const changed = { ...entry, project: { ...before, shots: before.shots.map(s => ({ ...s, imagePath: "/different.tiff" })) } };
  // Arrays pop from the end. A compatible entry after the boundary survives;
  // the old [entry, changed] expectation incorrectly jumped a rejected step.
  expect(history.rebasePendingHistoryEntries([entry, changed], before, after, ["s"], p => parkShotGroup(p, ["s"]))).toEqual([]);
  const result = history.rebasePendingHistoryEntries([changed, entry], before, after, ["s"], p => parkShotGroup(p, ["s"]));
  expect(result).toHaveLength(1); expect(result[0].project.parkedShots![0].imagePath).toBe("/w/Pending/a.tiff");
  expect(result[0].fileNameSyncState).toBe("unsynced");
  const projectRef = { current: { ...after, name: "P2" } }, queue = createBitmapLayerWriteQueue();
  const { createNormalSaveProjectOwner } = await import("./normalSaveProjectOwner");
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue, freshToken: () => "undo-fresh", readIdentity: async () => h1, persist: async () => {}, output: async () => [] });
  expect(owner.publishEdit(result[0].project, ["s"])).toBe(true);
  expect(projectRef.current.name).toBe("P"); expect(projectRef.current.parkedShots![0].imagePath).toBe("/w/Pending/a.tiff");
  expect(projectRef.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "undo-fresh", acceptedOutputIdentity: h1 });
});
const deferred = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
async function dragFixture(kind: "park" | "restore") {
  const projectRef = { current: project() }, queue = createBitmapLayerWriteQueue(), gate = deferred(), entered = deferred();
  if (kind === "restore") { projectRef.current = parkShotGroup(projectRef.current, ["s"]) as any; projectRef.current.parkedShots![0].imagePath = "/w/Pending/a.tiff";
    projectRef.current.shots = [{ id: "peer", imagePath: "/w/peer.tiff", fileName: "peer.tiff", order: 0, swb: { version: 1, status: "owned", canvasWidth: 4, canvasHeight: 3 } } as any];
    (projectRef.current.pendingBake.shots as any).peer = { state: "synced", acceptedOutputIdentity: h0 };
  }
  let epoch = {};
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue, freshToken: () => "t2", paths: () => ({ folderPath: "/w", metadataPath: "/w/p.json" }), onSave: () => {}, onError: () => {},
    api: () => ({ readOutputIdentity: async p => p.includes("Pending") && kind === "park" ? h1 : h0, saveWorkspace: vi.fn(), autosaveWorkspace: async () => {},
      moveShotsToPending: async () => { entered.release(); await gate.promise; return [{ shotId: "s", imagePath: "/w/Pending/a.tiff", fileName: "a.tiff", normalSaveOutput: { shotId: "s", sourcePath: "/w/a.tiff", targetPath: "/w/Pending/a.tiff", fileName: "a.tiff", capturedToken: "t1", outputHash: h1 } }]; },
      restoreShotsFromPending: async () => { entered.release(); await gate.promise; return [{ shotId: "s", imagePath: "/w/a.tiff", fileName: "a.tiff", normalSaveOutput: { shotId: "s", sourcePath: "/w/Pending/a.tiff", targetPath: "/w/a.tiff", fileName: "a.tiff", capturedToken: "t1", outputHash: h0 } }]; } }) });
  const status = vi.fn(), selection = vi.fn(), target = vi.fn(), inherit = vi.fn(async (_p: any, _mode: any, _ids: any, _options: any) => true);
  const controller = useStoryboardDragEndController({ projectRef, selectedShotIdsRef: { current: ["s"] }, pendingTransition: adapter.pending,
    capturePendingScope: () => { const c = epoch; return () => c === epoch; },
    pendingVersion: () => adapter.owner.capture().sequence, updateProject: vi.fn(), setStatus: status,
    flushInsertionTargetsFromDragEnd: () => ({ storyboardInsertionTarget: kind === "restore" ? { targetShotId: "peer", placement: "after" } : undefined, parkingInsertionTarget: undefined }),
    isDragEndInsideParkingShelf: () => kind === "park", isDragEndInsideStoryboard: () => true, isDragEndPointerInsideStoryboard: () => true,
    inheritSceneMatte: inherit, queuePasteAnimation: () => {}, resetActiveDragState: () => {}, selectSingleShot: selection, setDeleteTarget: target } as any);
  controller.handleDragEnd({ active: { data: { current: { type: kind === "park" ? "shot" : "parked-shot", shotId: "s" } } }, over: { data: { current: { type: kind === "park" ? "parking-zone" : "shot", shotId: "peer" } } } } as any);
  await entered.promise;
  return { adapter, projectRef, gate, status, selection, target, inherit, switchEpoch: () => { epoch = {}; } };
}
it("actual inheritance queued in an old Pending scope performs no new UI publication", async () => {
  const { createShotPresentationController } = await import("./shotPresentationController");
  const projectRef = { current: project() }, queue = createBitmapLayerWriteQueue(), gate = deferred();
  const block = queue.runExclusive(() => gate.promise), update = vi.fn(), status = vi.fn();
  let current = true;
  const presentation = createShotPresentationController({ api: {} as any, bitmapLayerWriteQueueRef: { current: queue }, folderPath: "/w", metadataPath: "/w/p.json", projectRef,
    shotPresentationActionRef: { current: undefined }, createHistoryEntry: async () => ({ project: projectRef.current, selectedShotIds: [], fileNameSyncState: "synced" }),
    markShotsDirty: vi.fn(), recordUndoEntry: vi.fn(), setStatus: status, updateProject: update, createMatteOverlay: () => undefined, createDialogueOverlay: () => undefined, expandBitmapLayer: vi.fn() } as any);
  const operation = presentation.handleInheritSceneMatte(projectRef.current, undefined, ["s"], { expectedProject: projectRef.current, isCurrent: () => current } as any);
  current = false; gate.release(); await block;
  expect(await operation).toBe(false); expect(update).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled();
});
it("actual restore drag reads late scene presentation and suppresses completion after another await changes epoch", async () => {
  const f = await dragFixture("restore"), inherited = deferred();
  f.inherit.mockImplementation(async () => { await inherited.promise; return true; });
  const { applyProjectMatte } = await import("../shared/projectOps");
  f.adapter.owner.publishEdit(p => applyProjectMatte(p, "embedded", ["peer"]), []);
  f.gate.release(); await new Promise(r => setTimeout(r, 5));
  expect(f.inherit).toHaveBeenCalled(); expect(f.inherit.mock.calls[0][1]).toBe("embedded");
  f.switchEpoch(); f.status.mockClear(); inherited.release(); await new Promise(r => setTimeout(r, 5));
  expect(f.selection).not.toHaveBeenCalled(); expect(f.target).not.toHaveBeenCalled(); expect(f.status).not.toHaveBeenCalled();
});
it.each(["park", "restore"] as const)("actual drag %s completion retains concurrent P2 project edits", async kind => {
  const f = await dragFixture(kind); f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), ["s"]);
  f.gate.release(); await new Promise(r => setTimeout(r, 5));
  expect(f.projectRef.current.name).toBe("P2");
});
it.each(["park", "restore"] as const)("actual drag %s stale epoch has no late current UI writes", async kind => {
  const f = await dragFixture(kind); f.switchEpoch(); const load = f.adapter.owner.load(project());
  f.status.mockClear(); f.gate.release(); await load; await new Promise(r => setTimeout(r, 5));
  expect(f.status).not.toHaveBeenCalled(); expect(f.selection).not.toHaveBeenCalled(); expect(f.target).not.toHaveBeenCalled();
});
const h0 = "0".repeat(64), h1 = "1".repeat(64);
const project = () => ({ ...createProject("P"), shots: [{ id: "s", imagePath: "/w/a.tiff", fileName: "a.tiff", order: 0 }], pendingBake: { version: 1 as const, shots: { s: { state: "pending" as const, editToken: "t1", acceptedOutputIdentity: h0 } } } });
export async function appCallbacks(rebasePendingHistory: (...args: any[]) => void = vi.fn()) {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "normalSaveAppCallbacks") declaration = n; ts.forEachChild(n, visit); }; visit(tree);
  const state = { workspaceSaveState: "saved", fileNameSyncState: "synced", revision: 0 };
  const workspaceSaveStateRef = { current: "saved" }, fileNameSyncStateRef = { current: "synced" };
  const bindings = { workspaceRecoveryRequiredRef: { current: undefined }, needsSwbImport: false,
    setWorkspaceSaveState: (v: string) => { state.workspaceSaveState = v; }, workspaceSaveStateRef,
    setFileNameSyncState: (v: string) => { state.fileNameSyncState = v; }, fileNameSyncStateRef,
    setAutosaveRevision: (fn: (n: number) => number) => { state.revision = fn(state.revision); },
    formatSaveFailureStatus: (await import("./saveErrors")).formatSaveFailureStatus,
    setAutosaveError: vi.fn(), rebasePendingHistory, autosaveErrorReducer, setSaveErrorDialog: vi.fn(), setStatus: vi.fn(), setWorkspaceTask: vi.fn() };
  const callbacks = new Function(...Object.keys(bindings), ts.transpile(`const ${declaration!.getText(tree)}; return normalSaveAppCallbacks;`))(...Object.values(bindings));
  return { state, workspaceSaveStateRef, fileNameSyncStateRef, callbacks, bindings };
}
it("actual history controller Undo survives Pending P2 merge with moved paths and fresh token", async () => {
  const { createSyncedHistoryStackSetter, appendHistoryEntry } = await import("./historyStackController");
  const { createNormalSaveProjectOwner } = await import("./normalSaveProjectOwner");
  const source = await readFile(new URL("./projectHistoryController.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("history.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(tree) === "useProjectHistoryController")!;
  const { useProjectHistoryController: _hook, ...historyHelpers } = history;
  const bindings = { ...historyHelpers, appendHistoryEntry, useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, () => {}],
    useSyncedHistoryStackController: ({ stackRef, setStack }: any) => createSyncedHistoryStackSetter(stackRef, setStack) };
  const hook = new Function(...Object.keys(bindings), ts.transpile(`${declaration.getText(tree).replace(/^export /, "")} return useProjectHistoryController;`))(...Object.values(bindings));
  const projectRef = { current: project() }, queue = createBitmapLayerWriteQueue(), gate = deferred(), entered = deferred();
  (projectRef.current.shots[0] as any).layers = [{ id: "base", bitmapPath: "base.png", opacity: 1 }];
  let owner!: ReturnType<typeof createNormalSaveProjectOwner>, token = 1;
  const controller = hook({ projectRef, bitmapLayerWriteQueueRef: { current: queue }, api: undefined, maxEntries: 20,
    isImageImportLocked: () => false, fileNameSyncStateRef: { current: "synced" }, folderPathRef: { current: "/w" }, selectedShotIdsRef: { current: ["s"] },
    publishProject: (p: any, ids: string[]) => owner.publishEdit(p, ids), markShotsDirty: () => {}, selectShotsByIds: () => {}, scriptImportCheckIdRef: { current: 0 },
    setAutosaveRevision: () => {}, setFileNameSyncState: () => {}, setProject: () => {}, setScriptImportNeeded: () => {}, setStatus: () => {}, setWorkspaceSaveState: () => {} });
  const callbacks = await appCallbacks(controller.rebasePendingHistory);
  owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue, freshToken: () => `t${++token}`, readIdentity: async s => s.imagePath.includes("Pending") ? h1 : h0, persist: async () => {}, output: async () => [], onPendingPublication: callbacks.callbacks.onPendingPublication });
  const operation = owner.pending(p => parkShotGroup(p, ["s"]), ["s"], true, async () => { entered.release(); await gate.promise; return [{ shotId: "s", sourcePath: "/w/a.tiff", targetPath: "/w/Pending/a.tiff", fileName: "a.tiff", outputHash: h1, capturedToken: "t1" }]; });
  await entered.promise; controller.recordProjectUndoEntry();
  owner.publishEdit(p => ({ ...p, name: "P2", shots: p.shots.map(s => ({ ...s, layers: s.layers!.map(l => ({ ...l, opacity: 0.5 })) })) }), ["s"]);
  gate.release(); expect(await operation).toBe(true); await controller.applyUndoEntry();
  expect(projectRef.current.name).toBe("P"); expect(projectRef.current.parkedShots![0].imagePath).toBe("/w/Pending/a.tiff");
  expect(projectRef.current.parkedShots![0].layers![0].opacity).toBe(1);
  expect(projectRef.current.pendingBake.shots.s).toMatchObject({ state: "pending", editToken: "t3", acceptedOutputIdentity: h1 });
});
it.each([true, false])("actual App Pending publication durable=%s marks namespace unsynced and blocks Close without dirty", async durable => {
  const f = await appCallbacks(); f.callbacks.onPendingPublication({ durable });
  expect(f.state.fileNameSyncState).toBe("unsynced"); expect(f.fileNameSyncStateRef.current).toBe("unsynced");
  expect(f.state.workspaceSaveState).toBe(durable ? "saved" : "saving"); expect(f.workspaceSaveStateRef.current).toBe(f.state.workspaceSaveState);
  expect(f.state.revision).toBe(durable ? 0 : 1);
  expect(workspaceCloseGuardPayload({ ...f.state, dirtyShotCount: 0 } as any).hasUnsavedChanges).toBe(true);
});
it("Pending late folder scope cannot publish unknown or error into the new current UI", async () => {
  const projectRef = { current: project() }, original = projectRef.current, gate = deferred(), entered = deferred(), setProject = vi.fn(), error = vi.fn();
  let paths = { folderPath: "/w", metadataPath: "/w/p.json" };
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject, queue: createBitmapLayerWriteQueue(), freshToken: () => "t2", paths: () => paths, onSave: () => {}, onError: error,
    api: () => ({ readOutputIdentity: async p => p.includes("Pending") ? h1 : h0, saveWorkspace: vi.fn(), autosaveWorkspace: vi.fn(), restoreShotsFromPending: vi.fn(),
      moveShotsToPending: async () => { entered.release(); await gate.promise; return [{ shotId: "s", imagePath: "/w/Pending/a.tiff", fileName: "a.tiff", normalSaveOutput: { shotId: "s", sourcePath: "/w/a.tiff", targetPath: "/w/Pending/a.tiff", fileName: "a.tiff", capturedToken: "t1", outputHash: h1 } }]; } }) });
  const operation = adapter.pending("park", p => parkShotGroup(p, ["s"]), ["s"]); await entered.promise;
  paths = { folderPath: "/new", metadataPath: "/new/p.json" }; gate.release();
  expect(await operation).toBe(false); expect(projectRef.current).toBe(original); expect(setProject).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
it.each(["unknown", "md"])("Pending %s reaches actual App error and Close protection", async kind => {
  const f = await appCallbacks(), projectRef = { current: project() };
  if (kind === "unknown") projectRef.current.pendingBake.shots.s.state = "unknown" as any;
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t2",
    api: () => ({ readOutputIdentity: async p => p.includes("Pending") ? h1 : h0, saveWorkspace: vi.fn(), autosaveWorkspace: async () => { throw new Error("required MD failed after JSON"); },
      moveShotsToPending: async () => [{ shotId: "s", imagePath: "/w/Pending/a.tiff", fileName: "a.tiff", normalSaveOutput: { shotId: "s", sourcePath: "/w/a.tiff", targetPath: "/w/Pending/a.tiff", fileName: "a.tiff", capturedToken: "t1", outputHash: h1 } }], restoreShotsFromPending: vi.fn() }),
    paths: () => ({ folderPath: "/w", metadataPath: "/w/p.json" }), onSave: f.callbacks.onSave, onError: f.callbacks.onError, onPendingPublication: f.callbacks.onPendingPublication });
  expect(await adapter.pending("park", p => parkShotGroup(p, ["s"]), ["s"])).toBe(false);
  expect(f.bindings.setSaveErrorDialog).toHaveBeenCalled(); expect(f.state.workspaceSaveState).toBe("error"); expect(f.workspaceSaveStateRef.current).toBe("error");
  expect(workspaceCloseGuardPayload({ ...f.state, dirtyShotCount: 0 } as any).hasUnsavedChanges).toBe(true);
});
