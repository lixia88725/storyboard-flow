import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppKeyboardBlurHandler,
  createAppKeyboardKeyDownHandler,
  createAppKeyboardKeyUpHandler,
  createAppKeyboardWheelHandler,
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

describe("appKeyboardShortcutsController", () => {
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
