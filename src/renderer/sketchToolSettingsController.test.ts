import { describe, expect, it } from "vitest";
import {
  defaultSketchToolSettings,
  nextSketchToolSettingsForRadialDrag,
  nextSketchToolSettingsForRadialPreset,
  nextToolRadialMenuConfig,
  nextToolRadialMenuSlotsConfig
} from "./sketchToolSettingsController";
import { defaultToolRadialMenuConfig } from "./toolRadialMenu";

describe("sketchToolSettingsController", () => {
  it("creates the default sketch tool settings used by the app shell", () => {
    expect(defaultSketchToolSettings()).toEqual({
      tool: "brush",
      brushColor: "#f05a28",
      brushSize: 4,
      brushOpacity: 1,
      brushSoftness: 0,
      eraserSize: 18,
      eraserOpacity: 1,
      eraserSoftness: 0
    });
  });

  it("applies radial presets to the current sketch tool settings", () => {
    expect(
      nextSketchToolSettingsForRadialPreset(defaultSketchToolSettings(), {
        id: "brush-blue",
        type: "preset",
        label: "Blue",
        tool: "brush",
        color: "#0033ff",
        applyColor: true,
        size: 12,
        applySize: true
      })
    ).toEqual({
      ...defaultSketchToolSettings(),
      brushColor: "#0033ff",
      brushSize: 12
    });
  });

  it("applies radial drag changes to the active tool settings", () => {
    expect(nextSketchToolSettingsForRadialDrag(defaultSketchToolSettings(), "opacity", 0.5)).toEqual({
      ...defaultSketchToolSettings(),
      brushOpacity: 0.5
    });

    expect(
      nextSketchToolSettingsForRadialDrag(
        { ...defaultSketchToolSettings(), tool: "eraser" },
        "softness",
        0.8
      )
    ).toEqual({
      ...defaultSketchToolSettings(),
      tool: "eraser",
      eraserSoftness: 0.8
    });
  });

  it("updates a radial slot through the same normalized config path as the radial menu", () => {
    const config = defaultToolRadialMenuConfig();

    expect(
      nextToolRadialMenuConfig(config, "eraser", 0, {
        id: "empty-eraser",
        type: "empty"
      }).eraser.slots[0]
    ).toEqual({
      id: "empty-eraser",
      type: "empty",
      label: undefined
    });
  });

  it("updates radial slots in one normalized config write", () => {
    const config = defaultToolRadialMenuConfig();
    const nextBrushSlots = config.brush.slots.map((slot, index) =>
      index === 1 ? { id: "empty-size", type: "empty" as const } : slot
    );

    const next = nextToolRadialMenuSlotsConfig(config, "brush", nextBrushSlots);

    expect(next.brush.slots[1]).toEqual({
      id: "empty-size",
      type: "empty",
      label: undefined
    });
    expect(next.eraser.slots.map(({ id, type, label }) => ({ id, type, label }))).toEqual(
      config.eraser.slots.map(({ id, type, label }) => ({ id, type, label }))
    );
  });
});
