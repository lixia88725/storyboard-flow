import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyRadialPresetSlot,
  clearRadialSlot,
  defaultToolRadialMenuConfig,
  radialCanvasContextMenuAction,
  radialDragPreviewState,
  radialDragValue,
  radialEditHoldDelayMs,
  radialEditMoveTolerancePx,
  radialPresetApplyDelayMs,
  registerRadialDragListeners,
  shouldApplyRadialPresetClick,
  shouldEnterRadialEditMode,
  shouldCloseRadialMenuFromOutsidePointerDown,
  normalizeToolRadialMenuConfig,
  swapRadialSlots
} from "./toolRadialMenu";

const radialToolMenuSource = readFileSync(new URL("./RadialToolMenu.tsx", import.meta.url), "utf8");
const workspaceBoardCss = readFileSync(new URL("./styles/workspace-board.css", import.meta.url), "utf8");

describe("toolRadialMenu", () => {
  it("defaults brush and eraser to eight local radial slots each", () => {
    const config = defaultToolRadialMenuConfig();

    expect(config.brush.slots).toHaveLength(8);
    expect(config.eraser.slots).toHaveLength(8);
    expect(config.brush.slots.map((slot) => slot.type)).toEqual([
      "preset",
      "size-drag",
      "preset",
      "opacity-drag",
      "preset",
      "softness-drag",
      "empty",
      "empty"
    ]);
    expect(config.eraser.slots.map((slot) => slot.type)).toEqual([
      "preset",
      "size-drag",
      "preset",
      "opacity-drag",
      "preset",
      "softness-drag",
      "empty",
      "empty"
    ]);
  });

  it("normalizes partial or invalid persisted config into safe eight-slot menus", () => {
    const config = normalizeToolRadialMenuConfig({
      brush: {
        slots: [
          {
            id: "custom",
            type: "preset",
            label: "Red",
            tool: "brush",
            color: "#ff0000",
            applyColor: true,
            size: 14,
            applySize: true,
            opacity: 0.4,
            applyOpacity: true,
            softness: 0.7,
            applySoftness: true
          },
          { id: "bad", type: "preset", label: "Broken", tool: "paint", size: -4 }
        ]
      }
    });

    expect(config.brush.slots).toHaveLength(8);
    expect(config.eraser.slots).toHaveLength(8);
    expect(config.brush.slots[0]).toMatchObject({
      id: "custom",
      type: "preset",
      tool: "brush",
      color: "#ff0000",
      size: 14,
      opacity: 0.4,
      softness: 0.7
    });
    expect(config.brush.slots[1].type).toBe("empty");
  });

  it("drops invalid persisted colors instead of feeding them to color inputs", () => {
    const config = normalizeToolRadialMenuConfig({
      brush: {
        slots: [
          {
            id: "bad-color",
            type: "preset",
            label: "Bad",
            tool: "brush",
            color: "red",
            applyColor: true
          }
        ]
      }
    });

    expect(config.brush.slots[0]).toMatchObject({
      type: "preset",
      color: undefined,
      applyColor: false
    });
  });

  it("removes color application from eraser presets during normalization", () => {
    const config = normalizeToolRadialMenuConfig({
      eraser: {
        slots: [
          {
            id: "red-eraser",
            type: "preset",
            label: "Red Eraser",
            tool: "eraser",
            color: "#ff0000",
            applyColor: true
          }
        ]
      }
    });

    expect(config.eraser.slots[0]).toMatchObject({
      type: "preset",
      tool: "eraser",
      color: undefined,
      applyColor: false
    });
  });

  it("applies only checked preset parameters and preserves the rest", () => {
    const slot = {
      id: "red",
      type: "preset" as const,
      label: "Red",
      tool: "brush" as const,
      color: "#ff0000",
      applyColor: true,
      size: 20,
      applySize: false,
      opacity: 0.35,
      applyOpacity: true,
      softness: 0.8,
      applySoftness: false
    };

    expect(
      applyRadialPresetSlot(
        {
          tool: "eraser",
          brushColor: "#111111",
          brushSize: 8,
          brushOpacity: 1,
          brushSoftness: 0.2,
          eraserSize: 30,
          eraserOpacity: 0.5,
          eraserSoftness: 0.3
        },
        slot
      )
    ).toEqual({
      tool: "brush",
      brushColor: "#ff0000",
      brushSize: 8,
      brushOpacity: 0.35,
      brushSoftness: 0.2,
      eraserSize: 30,
      eraserOpacity: 0.5,
      eraserSoftness: 0.3
    });
  });

  it("maps horizontal drag distance to clamped size, opacity, and softness values", () => {
    expect(radialDragValue({ kind: "size", initial: 10, deltaX: 40, min: 1, max: 64 })).toBe(14);
    expect(radialDragValue({ kind: "size", initial: 10, deltaX: -200, min: 1, max: 64 })).toBe(1);
    expect(radialDragValue({ kind: "opacity", initial: 0.5, deltaX: 50, min: 0.2, max: 1 })).toBe(0.75);
    expect(radialDragValue({ kind: "opacity", initial: 0.5, deltaX: -200, min: 0.2, max: 1 })).toBe(0.2);
    expect(radialDragValue({ kind: "softness", initial: 0.2, deltaX: 80, min: 0, max: 1 })).toBe(0.6);
    expect(radialDragValue({ kind: "softness", initial: 0.2, deltaX: -80, min: 0, max: 1 })).toBe(0);
  });

  it("summarizes drag values into compact live preview state", () => {
    expect(radialDragPreviewState({ kind: "size", value: 18, min: 1, max: 28 })).toEqual({
      label: "18px",
      diameter: 44,
      opacity: 1,
      softness: 0
    });

    expect(radialDragPreviewState({ kind: "opacity", value: 0.45, min: 0.2, max: 1 })).toEqual({
      label: "45%",
      diameter: 34,
      opacity: 0.45,
      softness: 0
    });

    expect(radialDragPreviewState({ kind: "softness", value: 0.7, min: 0, max: 1 })).toEqual({
      label: "70%",
      diameter: 34,
      opacity: 1,
      softness: 0.7
    });
  });

  it("keeps preset apply delayed enough for double-click editing to cancel the first click", () => {
    expect(shouldApplyRadialPresetClick(1)).toBe(true);
    expect(shouldApplyRadialPresetClick(2)).toBe(false);
    expect(radialPresetApplyDelayMs).toBeGreaterThanOrEqual(300);
  });

  it("enters radial edit mode only after a stable long hold", () => {
    expect(radialEditHoldDelayMs).toBe(550);
    expect(radialEditMoveTolerancePx).toBe(6);
    expect(
      shouldEnterRadialEditMode({
        elapsedMs: 550,
        startX: 100,
        startY: 100,
        currentX: 103,
        currentY: 104
      })
    ).toBe(true);
    expect(
      shouldEnterRadialEditMode({
        elapsedMs: 549,
        startX: 100,
        startY: 100,
        currentX: 100,
        currentY: 100
      })
    ).toBe(false);
    expect(
      shouldEnterRadialEditMode({
        elapsedMs: 550,
        startX: 100,
        startY: 100,
        currentX: 107,
        currentY: 100
      })
    ).toBe(false);
  });

  it("swaps radial slots by index without changing slot count", () => {
    const slots = defaultToolRadialMenuConfig().brush.slots;
    const swapped = swapRadialSlots(slots, 0, 6);

    expect(swapped).toHaveLength(8);
    expect(swapped[0]).toEqual(slots[6]);
    expect(swapped[6]).toEqual(slots[0]);
    expect(swapRadialSlots(slots, 2, 2)).toEqual(slots);
  });

  it("clears a radial slot into a normalized empty slot", () => {
    const slots = defaultToolRadialMenuConfig().brush.slots;
    const cleared = clearRadialSlot(slots, 0);

    expect(cleared).toHaveLength(8);
    expect(cleared[0]).toEqual({
      id: "brush-red",
      type: "empty",
      label: undefined
    });
    expect(cleared[1]).toEqual(slots[1]);
  });

  it("declares edit-mode UI affordances and reduced-motion safe jiggle CSS", () => {
    expect(radialToolMenuSource).toContain("isEditMode");
    expect(radialToolMenuSource).toContain("radial-tool-slot-delete");
    expect(radialToolMenuSource).toContain("onEditEmptySlot");
    expect(radialToolMenuSource).toContain("onKeyDown");
    expect(radialToolMenuSource).toContain("handleEditDragDrop");
    expect(radialToolMenuSource).toContain("editDropIndex = dropIndexFromPoint");
    expect(workspaceBoardCss).toContain(".radial-tool-menu.is-editing");
    expect(workspaceBoardCss).toContain("@keyframes radial-tool-slot-jiggle");
    expect(workspaceBoardCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(workspaceBoardCss).toContain("animation: none");
  });

  it("toggles the radial menu from canvas right-clicks without affecting menu internals", () => {
    expect(
      radialCanvasContextMenuAction({
        isCanvasTarget: true,
        isInsideRadialMenu: false,
        hasOpenRadialMenu: true,
        activeTool: "brush"
      })
    ).toBe("close");

    expect(
      radialCanvasContextMenuAction({
        isCanvasTarget: true,
        isInsideRadialMenu: false,
        hasOpenRadialMenu: false,
        activeTool: "brush"
      })
    ).toBe("open");

    expect(
      radialCanvasContextMenuAction({
        isCanvasTarget: true,
        isInsideRadialMenu: true,
        hasOpenRadialMenu: true,
        activeTool: "brush"
      })
    ).toBe("ignore");

    expect(
      radialCanvasContextMenuAction({
        isCanvasTarget: true,
        isInsideRadialMenu: false,
        hasOpenRadialMenu: false,
        activeTool: "select"
      })
    ).toBe("close");
  });

  it("leaves right-click close handling to the canvas context menu toggle", () => {
    expect(shouldCloseRadialMenuFromOutsidePointerDown({ button: 0, isPrimary: true })).toBe(true);
    expect(shouldCloseRadialMenuFromOutsidePointerDown({ button: 2, isPrimary: true })).toBe(false);
    expect(shouldCloseRadialMenuFromOutsidePointerDown({ button: 0, isPrimary: false })).toBe(false);
  });

  it("cleans up active radial drag listeners when the menu closes before pointerup", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, new Set([...(listeners.get(type) ?? []), listener]));
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      }
    };

    const cleanup = registerRadialDragListeners(target, () => undefined, () => undefined);

    expect(listeners.get("pointermove")?.size).toBe(1);
    expect(listeners.get("pointerup")?.size).toBe(1);
    expect(listeners.get("pointercancel")?.size).toBe(1);
    expect(listeners.get("mouseup")?.size).toBe(1);

    cleanup();

    expect(listeners.get("pointermove")?.size).toBe(0);
    expect(listeners.get("pointerup")?.size).toBe(0);
    expect(listeners.get("pointercancel")?.size).toBe(0);
    expect(listeners.get("mouseup")?.size).toBe(0);
  });
});
