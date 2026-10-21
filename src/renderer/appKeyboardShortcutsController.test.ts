import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppKeyboardBlurHandler,
  createAppKeyboardKeyDownHandler,
  createAppKeyboardKeyUpHandler,
  createAppKeyboardWheelHandler,
  eraserHoldDelayMs
} from "./appKeyboardShortcutsController";
import type { Project, Shot } from "../shared/types";
import { createShotSelectionController } from "./shotSelectionController";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import { useDeleteActionController } from "./deleteActionController";
import { useClipboardActionController } from "./clipboardActionController";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { ClipboardSelection } from "./clipboardSelection";
import type { DeleteTarget } from "./deleteTarget";
import type { SelectedBitmapLayerIds } from "./storyboardInteractionState";
import { addGeneratedShot, createProject } from "../shared/projectOps";
import { useBitmapLayerActions, type BitmapLayerProjectUpdate } from "./bitmapLayerActions";

const keyboardEvent = (key: string, options: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    preventDefault: vi.fn(),
    ...options
  }) as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };

const wheelEvent = (deltaY: number, options: Partial<WheelEvent> = {}) =>
  ({
    clientX: 320,
    clientY: 240,
    deltaY,
    preventDefault: vi.fn(),
    ...options
  }) as WheelEvent & { preventDefault: ReturnType<typeof vi.fn> };

const shot = (id: string, order: number): Shot => ({
  id,
  order,
  imagePath: `${id}.tiff`,
  fileName: `${id}.tiff`
});

const createHarness = (overrides: Partial<Parameters<typeof createAppKeyboardKeyDownHandler>[0]> = {}) => {
  const selectedShotIdsRef = { current: ["shot-1"] };
  const shotSelectionAnchorIdRef = { current: "shot-1" as string | undefined };
  const setSelectedShotIds = vi.fn((value: string[] | ((current: string[]) => string[])) => {
    selectedShotIdsRef.current =
      typeof value === "function" ? value(selectedShotIdsRef.current) : value;
  });
  const options = {
    isImageImportLocked: () => false,
    activeSketchTool: "brush" as const,
    isAddShotMenuOpen: false,
    isAnimationMode: false,
    isImportHelpOpen: false,
    isRecentMenuOpen: false,
    isSaveMenuOpen: false,
    orderedShots: [shot("shot-1", 0), shot("shot-2", 1), shot("shot-3", 2)],
    selectedBitmapLayerIdsRef: { current: undefined },
    selectedShotIdsRef,
    navigateShotSelection: ({ selectedIds, anchorId }: { selectedIds: string[]; anchorId: string | undefined }) => {
      selectedShotIdsRef.current = selectedIds;
      shotSelectionAnchorIdRef.current = anchorId;
    },
    measureGridColumns: vi.fn(() => 2),
    hasOpenShortcutBlockingMenu: vi.fn(() => false),
    handleAddShot: vi.fn(),
    handleClearBitmapLayer: vi.fn(),
    handleCopySelection: vi.fn(),
    handleDeleteKeyPress: vi.fn(),
    handleMergeBitmapLayers: vi.fn(),
    handlePasteSelection: vi.fn(),
    handleSaveProject: vi.fn(),
    handleStoryboardZoomShortcut: vi.fn(),
    applyRedoEntry: vi.fn(),
    applyUndoEntry: vi.fn(),
    setActiveSketchTool: vi.fn(),
    setBrushOpacity: vi.fn(),
    setBrushSize: vi.fn(),
    setEraserOpacity: vi.fn(),
    setEraserSize: vi.fn(),
    setIsOnionSkinEnabled: vi.fn(),
    setSelectedShotIds,
    setStatus: vi.fn(),
    pendingEraserHoldRef: { current: undefined },
    spacePanActiveRef: { current: false },
    temporarySketchToolOverrideRef: { current: undefined },
    zZoomActiveRef: { current: false },
    setIsSpacePanActive: vi.fn(),
    ...overrides
  };

  return {
    blurHandler: createAppKeyboardBlurHandler(options),
    handler: createAppKeyboardKeyDownHandler(options),
    keyUpHandler: createAppKeyboardKeyUpHandler(options),
    wheelHandler: createAppKeyboardWheelHandler(options),
    options,
    selectedShotIdsRef,
    shotSelectionAnchorIdRef
  };
};

// State setters deliberately do not commit React state/effects in this harness.
// Consecutive events must use the controllers' live refs, not a rerender.
const createNavigationHarness = (isAnimationMode = false) => {
  const selectedShotIdsRef = { current: ["shot-1"] };
  const shotSelectionAnchorIdRef = { current: "shot-1" as string | undefined };
  const deleteTargetRef = { current: { type: "layer", shotId: "shot-1", layerId: "paint" } as DeleteTarget };
  const selectedBitmapLayerIdsRef = {
    current: { shotId: "shot-1", layerIds: ["paint"] } as SelectedBitmapLayerIds | undefined
  };
  const setDeleteTarget = (target: DeleteTarget) => { deleteTargetRef.current = target; };
  const setSelectedShotIds = vi.fn();
  const selection = createShotSelectionController({
    blurActiveFormControl: vi.fn(), isEditableTarget: () => false,
    orderedShotIds: ["shot-1", "shot-2", "shot-3"],
    selectedShotIdsRef, shotSelectionAnchorIdRef, selectedBitmapLayerIdsRef,
    setDeleteTarget, setSelectedBitmapLayerIds: vi.fn(), setSelectedShotIds
  });
  const projectRef = { current: {
    id: "project", name: "Project", createdAt: "2026-06-01", updatedAt: "2026-06-01",
    dialogues: [], shots: [shot("shot-1", 0), shot("shot-2", 1), shot("shot-3", 2)].map((item) => ({
      ...item, activeLayerId: "paint", layers: [{
        id: "paint", name: "Paint", kind: "paint" as const, order: 0,
        visible: true, locked: false, opacity: 1, blendMode: "normal" as const,
        bitmapPath: `${item.id}/paint.png`, width: 10, height: 10
      }]
    }))
  } as Project };
  const layerActions = useLayerMetadataActionController({
    markShotsDirty: vi.fn(), setDeleteTarget, shotSelectionAnchorIdRef,
    updateProject: (update) => {
      projectRef.current = typeof update === "function" ? update(projectRef.current) : update;
    }
  });
  const handleRemoveBitmapLayer = vi.fn(async () => {});
  const deletion = useDeleteActionController({
    isImageImportLocked: () => false,
    deleteTargetRef, projectRef, selectedShotIdsRef,
    selectSingleShot: selection.selectSingleShot, setDeleteTarget,
    setStatus: vi.fn(), handleRemoveBitmapLayer,
    updateProject: (update) => {
      projectRef.current = typeof update === "function" ? update(projectRef.current) : update;
    }
  });
  const clipboardSelectionRef = { current: undefined as ClipboardSelection | undefined };
  const clipboard = useClipboardActionController({
    isImageImportLocked: () => false,
    api: undefined, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
    clipboardSelectionRef, createHistoryEntry: async () => undefined, deleteTargetRef,
    folderPath: undefined, metadataPath: undefined, projectRef, selectedShotIdsRef,
    markShotsDirty: vi.fn(), queuePasteAnimation: vi.fn(), recordUndoEntry: vi.fn(),
    selectSingleShot: selection.selectSingleShot, setClipboardSelection: vi.fn(),
    setDeleteTarget, setSelectedBitmapLayerIds: vi.fn(), setStatus: vi.fn(), updateProject: vi.fn()
  });
  const { handler } = createHarness({
    selectedShotIdsRef, selectedBitmapLayerIdsRef,
    isAnimationMode, orderedShots: projectRef.current.shots, navigateShotSelection: selection.navigateShotSelection,
    handleDeleteKeyPress: deletion.handleDeleteKeyPress,
    handleCopySelection: clipboard.handleCopySelection
  });
  return { handler, selection, layerActions, selectedShotIdsRef, shotSelectionAnchorIdRef,
    deleteTargetRef, selectedBitmapLayerIdsRef, projectRef, handleRemoveBitmapLayer,
    clipboardSelectionRef, setSelectedShotIds };
};

// U2-b exercises shared live entry + execution-point admission.
// Exercise the real keyboard -> clear controller -> real queue path, with synthetic IPC.
const createImportClearHarness = () => {
  const project = addGeneratedShot(createProject("Synthetic U2-b"), {
    imagePath: "/synthetic/u2b.tiff", fileName: "u2b.tiff", width: 2, height: 2
  });
  const activeShot = project.shots[0];
  const activeLayer = activeShot.layers!.find((layer) => !layer.locked)!;
  activeShot.activeLayerId = activeLayer.id;
  const projectRef = { current: project };
  const importLockedRef = { current: false };
  const queue = createBitmapLayerWriteQueue();
  const pixels = new Map([[activeLayer.bitmapPath, "original synthetic pixels"]]);
  const writeLayerPng = vi.fn(async ({ bitmapPath, dataUrl }: { bitmapPath: string; dataUrl: string }) => {
    pixels.set(bitmapPath, dataUrl);
  });
  vi.stubGlobal("window", { storyboard: { writeLayerPng } });
  const createHistoryEntry = vi.fn(async () => "clear undo");
  const recordUndoEntry = vi.fn();
  const updateProject = vi.fn((update: BitmapLayerProjectUpdate) => {
    projectRef.current = typeof update === "function" ? update(projectRef.current) : update;
  });
  const actions = useBitmapLayerActions({
    isImageImportLocked: () => importLockedRef.current,
    projectRef, folderPath: "/synthetic", bitmapLayerWriteQueueRef: { current: queue },
    createTransparentLayerDataUrl: async () => "transparent synthetic pixels",
    createHistoryEntry, recordUndoEntry, markShotsDirty: vi.fn(), updateProject, setStatus: vi.fn()
  });
  const pending: Promise<void>[] = [];
  const h = createHarness({
    isImageImportLocked: () => importLockedRef.current,
    orderedShots: project.shots, selectedShotIdsRef: { current: [activeShot.id] },
    handleClearBitmapLayer: (shotId, layerId) => {
      const task = actions.handleClearBitmapLayer(shotId, layerId);
      pending.push(task);
      return task;
    }
  });
  return { ...h, importLockedRef, queue, pending, projectRef, activeLayer, pixels,
    writeLayerPng, createHistoryEntry, recordUndoEntry, updateProject };
};

describe("U2-b image Import execution gate", () => {
  it.each([
    ["v", { metaKey: true }, "handlePasteSelection"],
    ["Delete", {}, "handleDeleteKeyPress"],
    ["Backspace", {}, "handleDeleteKeyPress"],
    ["Escape", {}, "handleClearBitmapLayer"],
    ["e", { metaKey: true }, "handleMergeBitmapLayers"],
    ["a", {}, "handleAddShot"],
    ["z", { metaKey: true }, "applyUndoEntry"],
    ["z", { ctrlKey: true, shiftKey: true }, "applyRedoEntry"]
  ] as const)("blocks %s dispatch with the live image lock", (key, event, action) => {
    let locked = false;
    const target = addGeneratedShot(createProject("keyboard"), { imagePath: "/synthetic/k.tiff", fileName: "k.tiff", width: 2, height: 2 }).shots[0];
    const h = createHarness({ isImageImportLocked: () => locked, orderedShots: [target], selectedShotIdsRef: { current: [target.id] } });
    locked = true;
    h.handler(keyboardEvent(key, event));
    expect(h.options[action]).not.toHaveBeenCalled();
    locked = false;
    h.handler(keyboardEvent(key, event));
    expect(h.options[action]).toHaveBeenCalledOnce();
  });

  it("preserves navigation Copy zoom and typing Save with image lock", () => {
    const h = createHarness({ isImageImportLocked: () => true });
    h.handler(keyboardEvent("ArrowRight"));
    expect(h.selectedShotIdsRef.current).toEqual(["shot-2"]);
    h.handler(keyboardEvent("c", { metaKey: true }));
    expect(h.options.handleCopySelection).toHaveBeenCalledOnce();
    h.handler(keyboardEvent("+", { metaKey: true }));
    expect(h.options.handleStoryboardZoomShortcut).toHaveBeenCalledOnce();
    h.handler(keyboardEvent("s", { metaKey: true, target: { closest: (selector: string) => selector === "input" ? { type: "text" } : null } as unknown as EventTarget }));
    expect(h.options.handleSaveProject).toHaveBeenCalledOnce();
  });
  it("shared live gate blocks Clear while image Import is locked", async () => {
    const h = createImportClearHarness();
    h.importLockedRef.current = true;
    const before = structuredClone(h.projectRef.current);
    h.handler(keyboardEvent("Escape"));
    await Promise.all(h.pending);
    expect(h.writeLayerPng).not.toHaveBeenCalled();
    expect(h.createHistoryEntry).not.toHaveBeenCalled();
    expect(h.recordUndoEntry).not.toHaveBeenCalled();
    expect(h.updateProject).not.toHaveBeenCalled();
    expect(h.projectRef.current).toEqual(before);
  });

  it("shared live gate allows normal Clear after image Import unlocks", async () => {
    const h = createImportClearHarness();
    h.importLockedRef.current = true;
    h.handler(keyboardEvent("Escape"));
    h.importLockedRef.current = false;
    h.handler(keyboardEvent("Escape"));
    await Promise.all(h.pending);
    expect(h.writeLayerPng).toHaveBeenCalledOnce();
    expect(h.pixels.get(h.activeLayer.bitmapPath)).toBe("transparent synthetic pixels");
    expect(h.recordUndoEntry).toHaveBeenCalledExactlyOnceWith("clear undo");
    expect(h.updateProject).toHaveBeenCalledOnce();
  });

  it("must not perform Clear I/O or change metadata/history when image Import locks during queue wait", async () => {
    const h = createImportClearHarness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = h.queue.enqueue(h.activeLayer.bitmapPath, () => gate);
    h.handler(keyboardEvent("Escape"));
    expect(h.pending).toHaveLength(1);
    expect(h.writeLayerPng).not.toHaveBeenCalled();
    h.importLockedRef.current = true;
    const before = structuredClone(h.projectRef.current);
    release();
    await Promise.all([blocker, ...h.pending]);
    // Soft assertions retain all evidence of the same missing execution-point check.
    expect.soft(h.writeLayerPng).not.toHaveBeenCalled();
    expect.soft(h.createHistoryEntry).not.toHaveBeenCalled();
    expect.soft(h.recordUndoEntry).not.toHaveBeenCalled();
    expect.soft(h.updateProject).not.toHaveBeenCalled();
    expect.soft(h.pixels.get(h.activeLayer.bitmapPath)).toBe("original synthetic pixels");
    expect.soft(h.projectRef.current).toEqual(before);
  });
});

describe("appKeyboardShortcutsController", () => {
  it("navigates from layer A to shot B then immediately copies and deletes B without a render", () => {
    const h = createNavigationHarness();
    h.handler(keyboardEvent("ArrowRight"));
    h.handler(keyboardEvent("c", { metaKey: true }));
    expect(h.clipboardSelectionRef.current).toEqual({ type: "shot", shotId: "shot-2" });
    expect(h.selectedShotIdsRef.current).toEqual(["shot-2"]);
    expect(h.shotSelectionAnchorIdRef.current).toBe("shot-2");
    expect(h.deleteTargetRef.current).toEqual({ type: "shot" });
    expect(h.selectedBitmapLayerIdsRef.current).toBeUndefined();
    h.handler(keyboardEvent("Delete"));
    expect(h.handleRemoveBitmapLayer).not.toHaveBeenCalled();
    expect(h.projectRef.current.shots.map((item) => item.id)).toEqual(["shot-1", "shot-3"]);
  });
  it.each([
    ["ArrowRight", "shot-1", "shot-2", false],
    ["ArrowLeft", "shot-2", "shot-1", false],
    ["ArrowDown", "shot-1", "shot-3", false],
    ["ArrowUp", "shot-3", "shot-1", false],
    ["ArrowRight", "shot-1", "shot-2", true]
  ] as const)("%s synchronously leaves layer focus (%s to %s; animation %s)", (key, from, to, animation) => {
    const h = createNavigationHarness(animation);
    h.selection.selectSingleShot(from);
    h.layerActions.handleSelectLayer(from, "paint");
    h.handler(keyboardEvent(key));
    expect(h.selectedShotIdsRef.current).toEqual([to]);
    expect(h.shotSelectionAnchorIdRef.current).toBe(to);
    expect(h.deleteTargetRef.current).toEqual({ type: "shot" });
    expect(h.selectedBitmapLayerIdsRef.current).toBeUndefined();
  });

  it("uses the live shot selection for repeated arrows before a render", () => {
    const h = createNavigationHarness(true);
    h.handler(keyboardEvent("ArrowRight"));
    h.handler(keyboardEvent("ArrowRight", { repeat: true }));
    h.handler(keyboardEvent("c", { ctrlKey: true }));
    expect(h.clipboardSelectionRef.current).toEqual({ type: "shot", shotId: "shot-3" });
  });

  it.each([["ArrowLeft", false], ["ArrowDown", true]] as const)("keeps layer focus when %s does not move (animation %s)", (key, animation) => {
    const h = createNavigationHarness(animation);
    h.handler(keyboardEvent(key));
    expect(h.selectedShotIdsRef.current).toEqual(["shot-1"]);
    expect(h.selectedBitmapLayerIdsRef.current).toEqual({ shotId: "shot-1", layerIds: ["paint"] });
    expect(h.setSelectedShotIds).not.toHaveBeenCalled();
    h.handler(keyboardEvent("c", { metaKey: true }));
    expect(h.clipboardSelectionRef.current).toEqual({ type: "layer", shotId: "shot-1", layerId: "paint" });
  });

  it("preserves explicit layer-row selection after navigation, including immediate Delete", () => {
    const h = createNavigationHarness();
    h.handler(keyboardEvent("ArrowRight"));
    h.layerActions.handleSelectLayer("shot-2", "paint");
    h.selection.selectSingleShot("shot-2");
    h.handler(keyboardEvent("c", { metaKey: true }));
    expect(h.clipboardSelectionRef.current).toEqual({ type: "layer", shotId: "shot-2", layerId: "paint" });
    h.handler(keyboardEvent("Delete"));
    expect(h.handleRemoveBitmapLayer).toHaveBeenCalledWith("shot-2", "paint");
    expect(h.projectRef.current.shots).toHaveLength(3);
  });

  it("preserves Shift card ranges and collapses multi-selection with an unmodified arrow", () => {
    const h = createNavigationHarness();
    h.selection.handleShotSelect("shot-3", { ctrlKey: false, metaKey: false, shiftKey: true, target: null });
    expect(h.selectedShotIdsRef.current).toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(h.shotSelectionAnchorIdRef.current).toBe("shot-1");
    expect(h.selectedBitmapLayerIdsRef.current).toBeUndefined();
    h.handler(keyboardEvent("ArrowRight", { shiftKey: true }));
    expect(h.selectedShotIdsRef.current).toEqual(["shot-1", "shot-2", "shot-3"]);
    h.handler(keyboardEvent("ArrowRight"));
    expect(h.selectedShotIdsRef.current).toEqual(["shot-2"]);
    expect(h.shotSelectionAnchorIdRef.current).toBe("shot-2");
  });

  it.each(["ArrowRight", "ArrowDown", "Delete", "c"])("leaves editable input %s to the input", (key) => {
    const h = createNavigationHarness();
    const target = { closest: (selector: string) => selector === "input" ? { type: "text" } : null } as unknown as EventTarget;
    const event = keyboardEvent(key, { target, metaKey: key === "c" });
    h.handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(h.selectedShotIdsRef.current).toEqual(["shot-1"]);
    expect(h.deleteTargetRef.current).toEqual({ type: "layer", shotId: "shot-1", layerId: "paint" });
    expect(h.clipboardSelectionRef.current).toBeUndefined();
    expect(h.handleRemoveBitmapLayer).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ignores shortcuts when a blocking menu is open", () => {
    const { handler, options } = createHarness({ isSaveMenuOpen: true });
    const event = keyboardEvent("b");

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.setActiveSketchTool).not.toHaveBeenCalled();
  });

  it("saves once from editable fields and open menus with Command or Control S", () => {
    const editableTarget = {
      closest: (selector: string) => (selector === "textarea, select" ? {} : null)
    } as unknown as EventTarget;
    const { handler, options } = createHarness({
      isSaveMenuOpen: true,
      hasOpenShortcutBlockingMenu: vi.fn(() => true)
    });
    const commandEvent = keyboardEvent("s", { metaKey: true, target: editableTarget });
    const controlEvent = keyboardEvent("s", { ctrlKey: true, target: editableTarget });
    const repeatedEvent = keyboardEvent("s", {
      metaKey: true,
      repeat: true,
      target: editableTarget
    });

    handler(commandEvent);
    handler(controlEvent);
    handler(repeatedEvent);

    expect(commandEvent.preventDefault).toHaveBeenCalled();
    expect(controlEvent.preventDefault).toHaveBeenCalled();
    expect(repeatedEvent.preventDefault).toHaveBeenCalled();
    expect(options.handleSaveProject).toHaveBeenCalledTimes(2);
  });

  it("prevents browser page zoom while a blocking menu is open", () => {
    const { handler, options } = createHarness({ isSaveMenuOpen: true });
    const event = keyboardEvent("+", { metaKey: true });

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(options.handleStoryboardZoomShortcut).not.toHaveBeenCalled();
  });

  it("ignores shortcuts when a DOM blocking menu is open", () => {
    const { handler, options } = createHarness({
      hasOpenShortcutBlockingMenu: vi.fn(() => true)
    });
    const event = keyboardEvent("b");

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.setActiveSketchTool).not.toHaveBeenCalled();
  });

  it("handles clipboard copy before shortcut actions", () => {
    const { handler, options } = createHarness();
    const event = keyboardEvent("c", { metaKey: true });

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(options.handleCopySelection).toHaveBeenCalled();
  });

  it("maps Command plus and minus to storyboard zoom instead of page zoom", () => {
    const { handler, options } = createHarness();
    const zoomInEvent = keyboardEvent("+", { metaKey: true });
    const zoomOutEvent = keyboardEvent("-", { metaKey: true });

    handler(zoomInEvent);
    handler(zoomOutEvent);

    expect(zoomInEvent.preventDefault).toHaveBeenCalled();
    expect(zoomOutEvent.preventDefault).toHaveBeenCalled();
    expect(options.handleStoryboardZoomShortcut).toHaveBeenNthCalledWith(1, "in");
    expect(options.handleStoryboardZoomShortcut).toHaveBeenNthCalledWith(2, "out");
  });

  it("zooms the storyboard with the mouse wheel while Z is held", () => {
    const { handler, keyUpHandler, wheelHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent("z");
    const wheelUpEvent = wheelEvent(-120);
    const wheelDownEvent = wheelEvent(120);
    const keyUpEvent = keyboardEvent("z");

    handler(keyDownEvent);
    expect(options.zZoomActiveRef.current).toBe(true);
    wheelHandler(wheelUpEvent);
    wheelHandler(wheelDownEvent);
    keyUpHandler(keyUpEvent);

    expect(keyDownEvent.preventDefault).toHaveBeenCalled();
    expect(wheelUpEvent.preventDefault).toHaveBeenCalled();
    expect(wheelDownEvent.preventDefault).toHaveBeenCalled();
    expect(keyUpEvent.preventDefault).toHaveBeenCalled();
    expect(options.zZoomActiveRef.current).toBe(false);
    expect(options.handleStoryboardZoomShortcut).toHaveBeenNthCalledWith(1, "in", {
      x: 320,
      y: 240
    });
    expect(options.handleStoryboardZoomShortcut).toHaveBeenNthCalledWith(2, "out", {
      x: 320,
      y: 240
    });
  });

  it("shows a zoom cursor while Z is held", () => {
    const addClass = vi.fn();
    const removeClass = vi.fn();
    vi.stubGlobal("document", {
      body: {
        classList: {
          add: addClass,
          remove: removeClass
        }
      }
    });
    const { handler, keyUpHandler } = createHarness();

    handler(keyboardEvent("z"));
    keyUpHandler(keyboardEvent("z"));

    expect(addClass).toHaveBeenCalledWith("is-z-zoom-active");
    expect(removeClass).toHaveBeenCalledWith("is-z-zoom-active");
  });

  it("clears shared Z zoom state when the window loses focus", () => {
    const removeClass = vi.fn();
    vi.stubGlobal("document", {
      body: {
        classList: {
          add: vi.fn(),
          remove: removeClass
        }
      }
    });
    const { blurHandler, handler, wheelHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent("z");
    const wheelDownEvent = wheelEvent(120);

    handler(keyDownEvent);
    expect(options.zZoomActiveRef.current).toBe(true);
    blurHandler();
    wheelHandler(wheelDownEvent);

    expect(keyDownEvent.preventDefault).toHaveBeenCalled();
    expect(removeClass).toHaveBeenCalledWith("is-z-zoom-active");
    expect(options.zZoomActiveRef.current).toBe(false);
    expect(wheelDownEvent.preventDefault).not.toHaveBeenCalled();
    expect(options.handleStoryboardZoomShortcut).not.toHaveBeenCalled();
  });

  it("keeps ordinary wheel scrolling when Z is not held", () => {
    const { wheelHandler, options } = createHarness();
    const event = wheelEvent(120);

    wheelHandler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.handleStoryboardZoomShortcut).not.toHaveBeenCalled();
  });

  it("does not start Z wheel zoom while typing in editable fields", () => {
    const editableTarget = {
      closest: (selector: string) => (selector === "textarea, select" ? {} : null)
    } as unknown as EventTarget;
    const { handler, wheelHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent("z", { target: editableTarget });
    const wheelDownEvent = wheelEvent(120);

    handler(keyDownEvent);
    wheelHandler(wheelDownEvent);

    expect(keyDownEvent.preventDefault).not.toHaveBeenCalled();
    expect(wheelDownEvent.preventDefault).not.toHaveBeenCalled();
    expect(options.handleStoryboardZoomShortcut).not.toHaveBeenCalled();
  });

  it("starts Space board pan outside editable fields", () => {
    const { handler, options } = createHarness();
    const event = keyboardEvent(" ");

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(options.spacePanActiveRef.current).toBe(true);
    expect(options.setIsSpacePanActive).toHaveBeenCalledWith(true);
  });

  it("does not start Space board pan while typing in editable fields", () => {
    const editableTarget = {
      closest: (selector: string) => (selector === "textarea, select" ? {} : null)
    } as unknown as EventTarget;
    const { handler, options } = createHarness();
    const event = keyboardEvent(" ", { target: editableTarget });

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.spacePanActiveRef.current).toBe(false);
    expect(options.setIsSpacePanActive).not.toHaveBeenCalled();
  });

  it("clears Space board pan on keyup and window blur", () => {
    const { blurHandler, handler, keyUpHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent(" ");
    const keyUpEvent = keyboardEvent(" ");

    handler(keyDownEvent);
    keyUpHandler(keyUpEvent);

    expect(keyUpEvent.preventDefault).toHaveBeenCalled();
    expect(options.spacePanActiveRef.current).toBe(false);
    expect(options.setIsSpacePanActive).toHaveBeenNthCalledWith(1, true);
    expect(options.setIsSpacePanActive).toHaveBeenNthCalledWith(2, false);

    handler(keyDownEvent);
    blurHandler();

    expect(options.spacePanActiveRef.current).toBe(false);
    expect(options.setIsSpacePanActive).toHaveBeenLastCalledWith(false);
  });

  it("handles delete without modifier keys", () => {
    const { handler, options } = createHarness();
    const event = keyboardEvent("Delete");

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(options.handleDeleteKeyPress).toHaveBeenCalled();
  });

  it("switches sketch tools from fixed shortcuts", () => {
    const { handler, options } = createHarness();
    const event = keyboardEvent("b");

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(options.setActiveSketchTool).toHaveBeenCalledWith("brush");
  });

  it("switches to eyedropper from the fixed I shortcut", () => {
    const { handler, options } = createHarness();
    const event = keyboardEvent("i");

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(options.setActiveSketchTool).toHaveBeenCalledWith("eyedropper");
  });

  it("temporarily switches from brush to eyedropper while Alt is held", () => {
    const { handler, keyUpHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent("Alt", { altKey: true });
    const keyUpEvent = keyboardEvent("Alt");

    handler(keyDownEvent);
    keyUpHandler(keyUpEvent);

    expect(keyDownEvent.preventDefault).toHaveBeenCalled();
    expect(options.setActiveSketchTool).toHaveBeenNthCalledWith(1, "eyedropper");
    expect(options.setActiveSketchTool).toHaveBeenNthCalledWith(2, "brush");
  });

  it("switches from brush to eraser permanently when E is tapped", () => {
    const { handler, keyUpHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent("e");
    const keyUpEvent = keyboardEvent("e");

    handler(keyDownEvent);
    keyUpHandler(keyUpEvent);

    expect(keyDownEvent.preventDefault).toHaveBeenCalled();
    expect(keyUpEvent.preventDefault).toHaveBeenCalled();
    expect(options.setActiveSketchTool).toHaveBeenCalledTimes(1);
    expect(options.setActiveSketchTool).toHaveBeenCalledWith("eraser");
  });

  it("temporarily switches from brush to eraser immediately while E is held", () => {
    vi.useFakeTimers();
    const { handler, keyUpHandler, options } = createHarness();
    const keyDownEvent = keyboardEvent("e");
    const keyUpEvent = keyboardEvent("e");

    handler(keyDownEvent);

    expect(keyDownEvent.preventDefault).toHaveBeenCalled();
    expect(options.setActiveSketchTool).toHaveBeenCalledTimes(1);
    expect(options.setActiveSketchTool).toHaveBeenCalledWith("eraser");

    vi.advanceTimersByTime(eraserHoldDelayMs);
    keyUpHandler(keyUpEvent);

    expect(keyUpEvent.preventDefault).toHaveBeenCalled();
    expect(options.setActiveSketchTool).toHaveBeenNthCalledWith(1, "eraser");
    expect(options.setActiveSketchTool).toHaveBeenNthCalledWith(2, "brush");
  });

  it("does not restore brush on E keyup after permanent eraser selection outside brush mode", () => {
    const { handler, keyUpHandler, options } = createHarness({ activeSketchTool: "select" });
    const keyDownEvent = keyboardEvent("e");
    const keyUpEvent = keyboardEvent("e");

    handler(keyDownEvent);
    keyUpHandler(keyUpEvent);

    expect(options.setActiveSketchTool).toHaveBeenCalledTimes(1);
    expect(options.setActiveSketchTool).toHaveBeenCalledWith("eraser");
  });

  it("does not temporarily switch tools while typing in editable fields", () => {
    const editableTarget = {
      closest: (selector: string) => (selector === "textarea, select" ? {} : null)
    } as unknown as EventTarget;
    const { handler, options } = createHarness();
    const event = keyboardEvent("e", { target: editableTarget });

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.setActiveSketchTool).not.toHaveBeenCalled();
  });

  it("moves keyboard shot selection with arrow keys", () => {
    const { handler, selectedShotIdsRef, shotSelectionAnchorIdRef } = createHarness();
    const event = keyboardEvent("ArrowDown");

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(selectedShotIdsRef.current).toEqual(["shot-3"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-3");
  });
});
