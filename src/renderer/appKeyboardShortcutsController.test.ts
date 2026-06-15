import { describe, expect, it, vi } from "vitest";
import { createAppKeyboardKeyDownHandler } from "./appKeyboardShortcutsController";
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
    isShortcutMenuOpen: false,
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
    ...overrides
  };

  return {
    handler: createAppKeyboardKeyDownHandler(options),
    options,
    selectedShotIdsRef,
    shotSelectionAnchorIdRef
  };
};

describe("appKeyboardShortcutsController", () => {
  it("ignores shortcuts when a blocking menu is open", () => {
    const { handler, options } = createHarness({ isSaveMenuOpen: true });
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

  it("moves keyboard shot selection with arrow keys", () => {
    const { handler, selectedShotIdsRef, shotSelectionAnchorIdRef } = createHarness();
    const event = keyboardEvent("ArrowDown");

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(selectedShotIdsRef.current).toEqual(["shot-3"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-3");
  });
});
