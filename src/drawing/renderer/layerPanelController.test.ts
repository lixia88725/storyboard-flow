import { describe, expect, it } from "vitest";
import {
  isLayerPanelOpenForShot,
  layerSelectionForPanelState,
  nextLayerPanelOpenState
} from "./layerPanelController";

describe("layerPanelController", () => {
  it("only reports the layer panel open for the primary selected shot", () => {
    expect(isLayerPanelOpenForShot(true, "shot-1", "shot-1")).toBe(true);
    expect(isLayerPanelOpenForShot(true, "shot-2", "shot-1")).toBe(false);
    expect(isLayerPanelOpenForShot(false, "shot-1", "shot-1")).toBe(false);
    expect(isLayerPanelOpenForShot(true, "shot-1", undefined)).toBe(false);
  });

  it("toggles the primary selected shot and opens when switching from another shot", () => {
    expect(nextLayerPanelOpenState(true, "shot-1", "shot-1")).toBe(false);
    expect(nextLayerPanelOpenState(false, "shot-1", "shot-1")).toBe(true);
    expect(nextLayerPanelOpenState(false, "shot-2", "shot-1")).toBe(true);
    expect(nextLayerPanelOpenState(true, "shot-2", "shot-1")).toBe(true);
  });

  it("keeps a closed layer panel selection stable when already empty", () => {
    const current: string[] = [];

    expect(
      layerSelectionForPanelState({
        availableLayerIds: ["layer-image"],
        hasShot: true,
        isOpen: false,
        selectedLayerIds: current
      })
    ).toBe(current);
  });

  it("clears closed layer panel selection and filters missing layers while open", () => {
    expect(
      layerSelectionForPanelState({
        availableLayerIds: ["layer-image"],
        hasShot: true,
        isOpen: false,
        selectedLayerIds: ["paint"]
      })
    ).toEqual([]);

    expect(
      layerSelectionForPanelState({
        availableLayerIds: ["layer-image"],
        hasShot: true,
        isOpen: true,
        selectedLayerIds: ["paint", "layer-image"]
      })
    ).toEqual(["layer-image"]);
  });
});
