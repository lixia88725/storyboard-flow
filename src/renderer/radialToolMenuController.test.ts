import { describe, expect, it } from "vitest";
import {
  closeRadialToolMenuState,
  nextRadialSlotConfig,
  openRadialToolMenuState,
  updateRadialDragSettings
} from "./radialToolMenuController";
import { defaultToolRadialMenuConfig } from "./toolRadialMenu";

const baseSettings = {
  tool: "brush" as const,
  brushColor: "#f05a28",
  brushSize: 4,
  brushOpacity: 1,
  brushSoftness: 0,
  eraserSize: 18,
  eraserOpacity: 1,
  eraserSoftness: 0
};

describe("radialToolMenuController", () => {
  it("updates only the active brush drag setting", () => {
    expect(updateRadialDragSettings(baseSettings, "size", 12)).toEqual({
      ...baseSettings,
      brushSize: 12
    });
    expect(updateRadialDragSettings(baseSettings, "opacity", 0.6)).toEqual({
      ...baseSettings,
      brushOpacity: 0.6
    });
    expect(updateRadialDragSettings(baseSettings, "softness", 0.75)).toEqual({
      ...baseSettings,
      brushSoftness: 0.75
    });
  });

  it("updates only the active eraser drag setting", () => {
    const eraserSettings = { ...baseSettings, tool: "eraser" as const };

    expect(updateRadialDragSettings(eraserSettings, "size", 32)).toEqual({
      ...eraserSettings,
      eraserSize: 32
    });
    expect(updateRadialDragSettings(eraserSettings, "opacity", 0.45)).toEqual({
      ...eraserSettings,
      eraserOpacity: 0.45
    });
    expect(updateRadialDragSettings(eraserSettings, "softness", 0.25)).toEqual({
      ...eraserSettings,
      eraserSoftness: 0.25
    });
  });

  it("keeps settings unchanged when drag updates are sent while Select is active", () => {
    const selectSettings = { ...baseSettings, tool: "select" as const };

    expect(updateRadialDragSettings(selectSettings, "size", 20)).toEqual(selectSettings);
  });

  it("replaces one radial slot and normalizes the saved config", () => {
    const config = defaultToolRadialMenuConfig();
    const next = nextRadialSlotConfig(config, "brush", 1, {
      id: "custom-empty",
      type: "empty"
    });

    expect(next.brush.slots[1]).toEqual({
      id: "custom-empty",
      type: "empty",
      label: undefined
    });
    expect(next.brush.slots).toHaveLength(8);
    expect(next.eraser.slots).toHaveLength(8);
  });

  it("opens and closes radial menu state without leaking closing animation state", () => {
    const open = openRadialToolMenuState({ tool: "brush", x: 10, y: 20 });

    expect(open).toEqual({ tool: "brush", x: 10, y: 20, isClosing: false });
    expect(closeRadialToolMenuState(open, false)).toEqual({
      tool: "brush",
      x: 10,
      y: 20,
      isClosing: true
    });
    expect(closeRadialToolMenuState(open, true)).toBeUndefined();
    expect(closeRadialToolMenuState(undefined, false)).toBeUndefined();
  });
});
