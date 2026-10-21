import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => void) => effect(), useCallback: (fn: unknown) => fn
}));
import { addGeneratedShot, createProject } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useProjectHistoryController } from "./projectHistoryController";
import { useBitmapLayerActions, type BitmapLayerProjectUpdate } from "./bitmapLayerActions";
import { useClipboardActionController } from "./clipboardActionController";
import { createShotPresentationController } from "./shotPresentationController";

const setup = () => {
  const projectRef = { current: addGeneratedShot(createProject("P0"), {
    imagePath: "/synthetic/a.tiff", fileName: "a.tiff", width: 2, height: 2
  }) };
  const shot = projectRef.current.shots[0];
  const queue = createBitmapLayerWriteQueue();
  const identity = { current: {} };
  const folderPathRef = { current: "/synthetic" };
  const selectedShotIdsRef = { current: [shot.id] };
  const pixels = new Map(shot.layers!.map(l => [l.bitmapPath, `old:${l.id}`]));
  const api = {
    readLayerPng: vi.fn(async ({ bitmapPath }: { bitmapPath: string }) => pixels.get(bitmapPath)),
    writeLayerPng: vi.fn(async ({ bitmapPath, dataUrl }: { bitmapPath: string; dataUrl: string }) => { pixels.set(bitmapPath, dataUrl); return {} as never; }),
    deleteLayerPng: vi.fn(async ({ bitmapPath }: { bitmapPath: string }) => { pixels.delete(bitmapPath); return {} as never; }),
    mergeLayerDown: vi.fn(async () => ({} as never)),
    mergeVisibleLayers: vi.fn(async () => ({} as never)),
    copyLayerPng: vi.fn(async ({ targetBitmapPath }: { targetBitmapPath: string }) => {
      pixels.set(targetBitmapPath, "copied"); return {} as never;
    }),
    copyShotAssets: vi.fn(async () => ({} as never)),
    ensureLayerAssets: vi.fn(async () => ({} as never))
  };
  vi.stubGlobal("window", { storyboard: api });
  const setProject = vi.fn();
  const markShotsDirty = vi.fn();
  const updateProject = vi.fn((update: BitmapLayerProjectUpdate) => {
    projectRef.current = typeof update === "function" ? update(projectRef.current) : update;
  });
  const history = useProjectHistoryController({
    isImageImportLocked: () => false, api, bitmapLayerWriteQueueRef: { current: queue },
    projectRef, folderPathRef, fileNameSyncStateRef: { current: "unsynced" },
    selectedShotIdsRef, maxEntries: 60, scriptImportCheckIdRef: { current: 0 },
    markShotsDirty, setProject, selectShotsByIds: vi.fn(), setAutosaveRevision: vi.fn(),
    setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(), setStatus: vi.fn(),
    setWorkspaceSaveState: vi.fn()
  });
  const recordUndoEntry = vi.fn(history.recordUndoEntry);
  const actions = useBitmapLayerActions({
    isImageImportLocked: () => false, projectRef, folderPath: "/synthetic",
    bitmapLayerWriteQueueRef: { current: queue }, createHistoryEntry: history.createHistoryEntry,
    createTransparentLayerDataUrl: async () => "transparent", recordUndoEntry,
    getWorkspaceIdentity: () => identity.current,
    markShotsDirty, updateProject, setStatus: vi.fn()
  });
  const deferRead = () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { entered = r; });
    api.readLayerPng.mockImplementation(async ({ bitmapPath }) => {
      const original = pixels.get(bitmapPath); entered(); await gate; return original;
    });
    return { release, started };
  };
  const edit = () => {
    projectRef.current = { ...projectRef.current, name: "P1",
      dialogues: [{ id: "dialogue-new", shotId: shot.id, order: 0, text: "new dialogue" }],
      shots: projectRef.current.shots.map(s => ({ ...s, scriptText: "new dialogue/action" })) };
  };
  const invoke = (action: string) => {
    const ids = shot.layers!.map(l => l.id);
    if (action === "clear") return actions.handleClearBitmapLayer(shot.id, ids[1]);
    if (action === "remove") return actions.handleRemoveBitmapLayer(shot.id, ids[1]);
    if (action === "down") return actions.handleMergeBitmapLayerDown(shot.id, ids[1]);
    if (action === "selected") return actions.handleMergeBitmapLayers(shot.id, ids[1], ids);
    if (action === "visible") return actions.handleMergeVisibleBitmapLayers(shot.id);
    return actions.handleAddBitmapLayer(shot.id);
  };
  return { projectRef, shot, queue, identity, api, history, recordUndoEntry, markShotsDirty, updateProject, setProject, deferRead, edit, invoke, pixels, selectedShotIdsRef };
};
afterEach(() => vi.unstubAllGlobals());

describe("real History and bitmap queue composition", () => {
  it("Paste pairs pre-copy PNG with latest metadata and preserves both through Undo/Redo", async () => {
    const s = setup();
    const destination = `.storyboard-workbench/layers/${s.shot.id}/layer-pasted.png`;
    s.pixels.set(destination, "pre-copy pixels");
    const target = s.shot.layers![1];
    const clipboard = useClipboardActionController({
      isImageImportLocked: () => false, api: s.api,
      captureWorkspace: () => ({ identity: s.identity.current, folderPath: "/synthetic", metadataPath: "/synthetic/project.json" }),
      isCurrentWorkspace: origin => origin.identity === s.identity.current,
      bitmapLayerWriteQueueRef: { current: s.queue },
      clipboardSelectionRef: { current: { type: "layer", shotId: s.shot.id, layerId: target.id } },
      createHistoryEntry: s.history.createHistoryEntry,
      refreshHistoryEntry: entry => s.history.createHistoryEntryFromLayerAssets(entry.layerAssets),
      createId: () => "pasted", deleteTargetRef: { current: { type: "layer", shotId: s.shot.id, layerId: target.id } },
      folderPath: "/synthetic", metadataPath: "/synthetic/project.json", projectRef: s.projectRef,
      selectedShotIdsRef: s.selectedShotIdsRef, markShotsDirty: s.markShotsDirty,
      queuePasteAnimation: vi.fn(), recordUndoEntry: s.recordUndoEntry, selectSingleShot: vi.fn(),
      setClipboardSelection: vi.fn(), setDeleteTarget: vi.fn(), setSelectedBitmapLayerIds: vi.fn(),
      setStatus: vi.fn(), updateProject: s.updateProject
    });
    const gate = s.deferRead(); const task = clipboard.handlePasteSelection();
    await gate.started; s.edit(); const latest = s.projectRef.current; gate.release(); await task;
    expect(s.recordUndoEntry).toHaveBeenCalledOnce();
    const captured = s.recordUndoEntry.mock.calls[0][0];
    expect(captured.project).toBe(latest);
    expect(captured.layerAssets).toEqual([{ bitmapPath: destination, dataUrl: "pre-copy pixels" }]);
    expect(s.pixels.get(destination)).toBe("copied");
    await s.history.applyUndoEntry();
    expect(s.projectRef.current).toBe(latest); expect(s.pixels.get(destination)).toBe("pre-copy pixels");
    await s.history.applyRedoEntry();
    expect(s.projectRef.current.name).toBe("P1");
    expect(s.projectRef.current.dialogues[0].text).toBe("new dialogue");
    expect(s.projectRef.current.shots[0].scriptText).toBe("new dialogue/action");
    expect(s.projectRef.current.shots[0].layers!.some(l => l.id === "layer-pasted")).toBe(true);
    expect(s.pixels.get(destination)).toBe("copied");
  });
  it("Presentation rejects stale metadata without recording or publishing a frozen entry", async () => {
    const s = setup();
    const presentation = createShotPresentationController({
      api: s.api as unknown as Window["storyboard"], projectRef: s.projectRef,
      bitmapLayerWriteQueueRef: { current: s.queue }, createHistoryEntry: s.history.createHistoryEntry,
      folderPath: "/synthetic", metadataPath: "/synthetic/project.json",
      markShotsDirty: s.markShotsDirty, recordUndoEntry: s.recordUndoEntry,
      setStatus: vi.fn(), shotPresentationActionRef: { current: undefined }, updateProject: s.updateProject,
      createMatteOverlay: () => "synthetic overlay"
    });
    const gate = s.deferRead(); const task = presentation.handleSetShotMatteMode("embedded");
    await gate.started; s.edit(); const latest = s.projectRef.current; gate.release(); await task;
    expect(s.recordUndoEntry).not.toHaveBeenCalled(); expect(s.updateProject).not.toHaveBeenCalled();
    expect(s.markShotsDirty).not.toHaveBeenCalled(); expect(s.projectRef.current).toBe(latest);
    await s.history.applyUndoEntry(); expect(s.setProject).not.toHaveBeenCalled();
  });
  it.each(["clear", "remove", "down", "selected", "visible", "add"])("cancels %s if metadata changes during snapshot reads", async action => {
    const s = setup(); const gate = s.deferRead(); const task = s.invoke(action);
    await gate.started; s.edit(); const latest = s.projectRef.current; gate.release(); await task;
    expect(s.api.writeLayerPng).not.toHaveBeenCalled();
    expect(s.api.deleteLayerPng).not.toHaveBeenCalled();
    expect(s.api.mergeLayerDown).not.toHaveBeenCalled();
    expect(s.api.mergeVisibleLayers).not.toHaveBeenCalled();
    expect(s.recordUndoEntry).not.toHaveBeenCalled();
    expect(s.updateProject).not.toHaveBeenCalled();
    expect(s.markShotsDirty).not.toHaveBeenCalled();
    await s.history.applyUndoEntry(); expect(s.setProject).not.toHaveBeenCalled();
    expect(s.projectRef.current).toBe(latest);
  });
  it.each(["clear", "remove", "down", "selected", "visible", "add"])("cancels %s if operation premises mutate in place during snapshot reads", async action => {
    const s = setup(); const gate = s.deferRead(); const task = s.invoke(action);
    await gate.started;
    const layer = s.projectRef.current.shots[0].layers![1];
    layer.locked = true; layer.visible = false; layer.bitmapPath = "changed.png";
    gate.release(); await task;
    expect(s.recordUndoEntry).not.toHaveBeenCalled(); expect(s.updateProject).not.toHaveBeenCalled();
    expect(s.api.writeLayerPng).not.toHaveBeenCalled(); expect(s.api.deleteLayerPng).not.toHaveBeenCalled();
    expect(s.api.mergeLayerDown).not.toHaveBeenCalled(); expect(s.api.mergeVisibleLayers).not.toHaveBeenCalled();
  });
  it.each(["clear", "remove", "down", "selected", "visible", "add"])("cancels %s on origin A→B→A even when the project object returns", async action => {
    const s = setup(); const gate = s.deferRead(); const original = s.projectRef.current;
    const task = s.invoke(action); await gate.started;
    s.identity.current = {}; s.projectRef.current = createProject("B");
    s.identity.current = {}; s.projectRef.current = original;
    gate.release(); await task;
    expect(s.recordUndoEntry).not.toHaveBeenCalled(); expect(s.updateProject).not.toHaveBeenCalled();
    expect(s.api.writeLayerPng).not.toHaveBeenCalled(); expect(s.api.deleteLayerPng).not.toHaveBeenCalled();
    expect(s.api.mergeLayerDown).not.toHaveBeenCalled(); expect(s.api.mergeVisibleLayers).not.toHaveBeenCalled();
  });
});
