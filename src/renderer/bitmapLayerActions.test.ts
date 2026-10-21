import { afterEach, describe, expect, it, vi } from "vitest";
import { addGeneratedShot, bitmapLayersForShot, createProject } from "../shared/projectOps";
import type { BitmapLayer } from "../shared/types";
import { useBitmapLayerActions, visibleLayerBelow, type BitmapLayerProjectUpdate } from "./bitmapLayerActions";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useDeleteActionController } from "./deleteActionController";

const setupRemoval = (singleLayer = false) => {
  const project = addGeneratedShot(createProject("Synthetic"), {
    imagePath: "/synthetic/candidate.tiff", fileName: "candidate.tiff", width: 2, height: 2
  });
  const shot = project.shots[0];
  if (singleLayer) shot.layers = [shot.layers![0]];
  const target = shot.layers![0];
  shot.activeLayerId = target.id;
  const projectRef = { current: project };
  // Synthetic pixels only; no real workspace files are touched.
  const pixels = new Map(shot.layers!.map((item) => [item.bitmapPath, `candidate-pixels:${item.id}`]));
  const deleteLayerPng = vi.fn(async ({ bitmapPath }: { bitmapPath: string }) => { pixels.delete(bitmapPath); });
  vi.stubGlobal("window", { storyboard: { deleteLayerPng } });
  const queue = createBitmapLayerWriteQueue();
  const createHistoryEntry = vi.fn(async (_paths?: string[]) => "undo");
  const recordUndoEntry = vi.fn();
  const markShotsDirty = vi.fn();
  const updateProject = vi.fn((update: BitmapLayerProjectUpdate) => {
    projectRef.current = typeof update === "function" ? update(projectRef.current) : update;
  });
  const controller = useBitmapLayerActions({
    isImageImportLocked: () => false,
    projectRef, folderPath: "/synthetic", bitmapLayerWriteQueueRef: { current: queue },
    createTransparentLayerDataUrl: vi.fn(async () => "unused"), createHistoryEntry,
    recordUndoEntry, markShotsDirty, updateProject, setStatus: vi.fn()
  });
  return { controller, projectRef, shot, target, pixels, deleteLayerPng, queue,
    createHistoryEntry, recordUndoEntry, markShotsDirty, updateProject };
};

afterEach(() => vi.unstubAllGlobals());

describe("bitmap layer removal controller", () => {
  it("does not remove a locked layer", async () => {
    const state = setupRemoval();
    state.target.locked = true;
    const before = structuredClone(state.projectRef.current);
    await state.controller.handleRemoveBitmapLayer(state.shot.id, state.target.id);
    expect(state.deleteLayerPng).not.toHaveBeenCalled();
    expect(state.projectRef.current).toEqual(before);
    expect(state.pixels.get(state.target.bitmapPath)).toBe(`candidate-pixels:${state.target.id}`);
    expect(state.createHistoryEntry).not.toHaveBeenCalled();
  });

  it("removes only the requested layer's metadata and pixels and records undo", async () => {
    const state = setupRemoval();
    const remaining = state.shot.layers![1];
    await state.controller.handleRemoveBitmapLayer(state.shot.id, state.target.id);
    const shot = state.projectRef.current.shots[0];
    expect(bitmapLayersForShot(shot).map((item) => item.id)).toEqual([remaining.id]);
    expect(shot.activeLayerId).toBe(remaining.id);
    expect(state.pixels.has(state.target.bitmapPath)).toBe(false);
    expect(state.pixels.get(remaining.bitmapPath)).toBe(`candidate-pixels:${remaining.id}`);
    expect(state.deleteLayerPng).toHaveBeenCalledExactlyOnceWith({
      folderPath: "/synthetic", bitmapPath: state.target.bitmapPath
    });
    expect(state.createHistoryEntry).toHaveBeenCalledExactlyOnceWith([state.target.bitmapPath]);
    expect(state.recordUndoEntry).toHaveBeenCalledExactlyOnceWith("undo");
    expect(state.markShotsDirty).toHaveBeenCalledExactlyOnceWith([state.shot.id]);
    expect(state.updateProject).toHaveBeenCalledExactlyOnceWith(expect.any(Function), false, false);
  });

  it.each(["replacement", "locked", "last layer", "missing layer", "missing shot"])(
    "revalidates %s after waiting for queued pixel writes",
    async (change) => {
      const state = setupRemoval();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const pendingWrite = state.queue.enqueue(state.target.bitmapPath, () => gate);
      const removal = state.controller.handleRemoveBitmapLayer(state.shot.id, state.target.id);
      if (change === "replacement") state.projectRef.current = structuredClone(state.projectRef.current);
      if (change === "locked") state.target.locked = true;
      if (change === "last layer") state.shot.layers = [state.target];
      if (change === "missing layer") state.shot.layers = [state.shot.layers![1]];
      if (change === "missing shot") state.projectRef.current.shots = [];
      const before = structuredClone(state.projectRef.current);
      release();
      await Promise.all([pendingWrite, removal]);
      expect(state.projectRef.current).toEqual(before);
      expect(state.pixels.get(state.target.bitmapPath)).toBe(`candidate-pixels:${state.target.id}`);
      expect(state.deleteLayerPng).not.toHaveBeenCalled();
      expect(state.createHistoryEntry).not.toHaveBeenCalled();
      expect(state.recordUndoEntry).not.toHaveBeenCalled();
      expect(state.markShotsDirty).not.toHaveBeenCalled();
      expect(state.updateProject).not.toHaveBeenCalled();
    }
  );

  it("preserves the final candidate layer's pixels and metadata without side effects", async () => {
    const state = setupRemoval(true);
    const before = structuredClone(state.projectRef.current);
    await state.controller.handleRemoveBitmapLayer(state.shot.id, state.target.id);
    expect(state.deleteLayerPng).not.toHaveBeenCalled();
    expect(state.pixels.get(state.target.bitmapPath)).toBe(`candidate-pixels:${state.target.id}`);
    expect(state.projectRef.current).toEqual(before);
    expect(state.createHistoryEntry).not.toHaveBeenCalled();
    expect(state.recordUndoEntry).not.toHaveBeenCalled();
    expect(state.markShotsDirty).not.toHaveBeenCalled();
    expect(state.updateProject).not.toHaveBeenCalled();
  });
});


const setupImportAction = () => {
  const state = setupRemoval();
  const locked = { current: false };
  const writeLayerPng = vi.fn(async ({ bitmapPath, dataUrl }: { bitmapPath: string; dataUrl: string }) => { state.pixels.set(bitmapPath, dataUrl); });
  const mergeLayerDown = vi.fn(async () => { state.pixels.set(state.shot.layers![0].bitmapPath, "merged"); });
  const mergeVisibleLayers = vi.fn(async () => { state.pixels.set(state.shot.layers![0].bitmapPath, "merged"); });
  vi.stubGlobal("window", { storyboard: { writeLayerPng, deleteLayerPng: state.deleteLayerPng, mergeLayerDown, mergeVisibleLayers } });
  const canvas = vi.fn(async () => "transparent");
  const controller = useBitmapLayerActions({
    isImageImportLocked: () => locked.current,
    projectRef: state.projectRef, folderPath: "/synthetic", bitmapLayerWriteQueueRef: { current: state.queue },
    createTransparentLayerDataUrl: canvas, createHistoryEntry: state.createHistoryEntry,
    recordUndoEntry: state.recordUndoEntry, markShotsDirty: state.markShotsDirty, updateProject: state.updateProject, setStatus: vi.fn()
  });
  const invoke = (action: string) => {
    const ids = state.shot.layers!.map((l) => l.id);
    if (action === "clear") return controller.handleClearBitmapLayer(state.shot.id, ids[1]);
    if (action === "remove") return controller.handleRemoveBitmapLayer(state.shot.id, ids[1]);
    if (action === "down") return controller.handleMergeBitmapLayerDown(state.shot.id, ids[1]);
    return controller.handleMergeBitmapLayers(state.shot.id, ids[1], ids);
  };
  return { ...state, locked, invoke, writeLayerPng, mergeLayerDown, mergeVisibleLayers, canvas };
};

describe("image Import bitmap admission", () => {
  it("does not retarget Delete when layer removal is rejected on queue departure", async () => {
    const s = setupImportAction();
    const target = s.shot.layers![1];
    const actions = useBitmapLayerActions({
      isImageImportLocked: () => s.locked.current, projectRef: s.projectRef,
      folderPath: "/synthetic", bitmapLayerWriteQueueRef: { current: s.queue },
      createHistoryEntry: s.createHistoryEntry, createTransparentLayerDataUrl: s.canvas,
      recordUndoEntry: s.recordUndoEntry, markShotsDirty: s.markShotsDirty, updateProject: s.updateProject, setStatus: vi.fn()
    });
    const setDeleteTarget = vi.fn();
    const deletion = useDeleteActionController({
      isImageImportLocked: () => s.locked.current, projectRef: s.projectRef,
      deleteTargetRef: { current: { type: "layer", shotId: s.shot.id, layerId: target.id } },
      selectedShotIdsRef: { current: [s.shot.id] },
      handleRemoveBitmapLayer: actions.handleRemoveBitmapLayer, setDeleteTarget,
      selectSingleShot: vi.fn(), setStatus: vi.fn(), updateProject: s.updateProject
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = s.queue.runExclusive(() => gate);
    const task = deletion.handleDeleteKeyPress();
    s.locked.current = true;
    release();
    await Promise.all([blocker, task]);
    expect(s.deleteLayerPng).not.toHaveBeenCalled();
    expect(setDeleteTarget).not.toHaveBeenCalled();
  });
  it.each(["clear", "remove", "down", "selected"])("rejects %s after read-only history preparation before first write", async (action) => {
    const s = setupImportAction();
    s.createHistoryEntry.mockImplementation(async () => { s.locked.current = true; return "undo"; });
    await s.invoke(action);
    expect(s.writeLayerPng).not.toHaveBeenCalled();
    expect(s.deleteLayerPng).not.toHaveBeenCalled();
    expect(s.mergeLayerDown).not.toHaveBeenCalled();
    expect(s.mergeVisibleLayers).not.toHaveBeenCalled();
    expect(s.updateProject).not.toHaveBeenCalled();
    expect(s.recordUndoEntry).not.toHaveBeenCalled();
  });
  it("rejects Clear after async canvas preparation before first write", async () => {
    const s = setupImportAction();
    s.canvas.mockImplementation(async () => { s.locked.current = true; return "transparent"; });
    await s.invoke("clear");
    expect(s.writeLayerPng).not.toHaveBeenCalled();
    expect(s.recordUndoEntry).not.toHaveBeenCalled();
    expect(s.updateProject).not.toHaveBeenCalled();
  });
  it.each(["clear", "remove", "down", "selected"])("rejects locked %s before enqueue or I/O", async (action) => {
    const s = setupImportAction();
    s.locked.current = true;
    const before = structuredClone(s.projectRef.current);
    await s.invoke(action);
    expect(s.createHistoryEntry).not.toHaveBeenCalled();
    expect(s.updateProject).not.toHaveBeenCalled();
    expect(s.projectRef.current).toEqual(before);
  });
  it.each(["clear", "remove", "down", "selected"])("rejects %s when locked during real queue wait", async (action) => {
    const s = setupImportAction();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = s.queue.runExclusive(() => gate);
    const task = s.invoke(action);
    s.locked.current = true;
    release();
    await Promise.all([blocker, task]);
    expect(s.createHistoryEntry).not.toHaveBeenCalled();
    expect(s.writeLayerPng).not.toHaveBeenCalled();
    expect(s.deleteLayerPng).not.toHaveBeenCalled();
    expect(s.mergeLayerDown).not.toHaveBeenCalled();
    expect(s.mergeVisibleLayers).not.toHaveBeenCalled();
    expect(s.recordUndoEntry).not.toHaveBeenCalled();
    expect(s.markShotsDirty).not.toHaveBeenCalled();
    expect(s.updateProject).not.toHaveBeenCalled();
  });
  it.each(["clear", "remove", "down", "selected"])("does not drop %s metadata/history when lock arrives after asset write starts", async (action) => {
    const s = setupImportAction();
    const target = s.shot.layers![1];
    const bottom = s.shot.layers![0];
    const lockOnWrite = async () => {
      if (action === "clear") s.pixels.set(target.bitmapPath, "transparent");
      else if (action === "remove") s.pixels.delete(target.bitmapPath);
      else { s.pixels.set(bottom.bitmapPath, "merged"); s.pixels.delete(target.bitmapPath); }
      s.locked.current = true;
    };
    s.writeLayerPng.mockImplementation(lockOnWrite);
    s.deleteLayerPng.mockImplementation(lockOnWrite);
    s.mergeLayerDown.mockImplementation(lockOnWrite);
    s.mergeVisibleLayers.mockImplementation(lockOnWrite);
    await s.invoke(action);
    expect(s.recordUndoEntry).toHaveBeenCalledOnce();
    expect(s.markShotsDirty).toHaveBeenCalledOnce();
    expect(s.updateProject).toHaveBeenCalledOnce();
    const liveLayers = s.projectRef.current.shots[0].layers!;
    if (action === "clear") {
      expect(liveLayers.find((l) => l.id === target.id)?.cleared).toBe(true);
      expect(s.pixels.get(target.bitmapPath)).toBe("transparent");
    } else {
      expect(liveLayers.map((l) => l.id)).toEqual([bottom.id]);
      expect(s.pixels.has(target.bitmapPath)).toBe(false);
      expect(s.pixels.has(bottom.bitmapPath)).toBe(true);
    }
  });
});

const layer = (id: string, visible = true): BitmapLayer => ({
  id,
  name: id,
  kind: "paint",
  bitmapPath: `.storyboard-workbench/layers/${id}.png`,
  visible,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  width: 100,
  height: 100
});

describe("bitmapLayerActions", () => {
  it("finds the nearest visible layer below the source layer", () => {
    expect(visibleLayerBelow([layer("bottom"), layer("hidden", false), layer("top")], "top")?.id)
      .toBe("bottom");
  });

  it("returns undefined when there is no visible layer below", () => {
    expect(visibleLayerBelow([layer("bottom", false), layer("top")], "top")).toBeUndefined();
    expect(visibleLayerBelow([layer("top")], "top")).toBeUndefined();
  });
});
