import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppKeyboardKeyDownHandler,
  createAppKeyboardKeyUpHandler,
  eraserHoldDelayMs
} from "./appKeyboardShortcutsController";
import type { Shot } from "../shared/types";

const keyboardEvent = (key: string, options: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...options
  }) as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };

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
    activeSketchTool: "brush" as const,
    isAddShotMenuOpen: false,
    isAnimationMode: false,
    isImportHelpOpen: false,
    isRecentMenuOpen: false,
    isSaveMenuOpen: false,
    orderedShots: [shot("shot-1", 0), shot("shot-2", 1), shot("shot-3", 2)],
    selectedBitmapLayerIdsRef: { current: undefined },
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
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
    temporarySketchToolOverrideRef: { current: undefined },
    ...overrides
  };

  return {
    handler: createAppKeyboardKeyDownHandler(options),
    keyUpHandler: createAppKeyboardKeyUpHandler(options),
    options,
    selectedShotIdsRef,
    shotSelectionAnchorIdRef
  };
};

describe("appKeyboardShortcutsController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores shortcuts when a blocking menu is open", () => {
    const { handler, options } = createHarness({ isSaveMenuOpen: true });
    const event = keyboardEvent("b");

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.setActiveSketchTool).not.toHaveBeenCalled();
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
