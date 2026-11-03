import { describe, expect, it } from "vitest";
import {
  initialStoryboardInteractionState,
  sameDeleteTarget,
  sameLayerSelection
} from "./storyboardInteractionState";

describe("storyboardInteractionState", () => {
  it("uses the existing selection and drag defaults", () => {
    expect(initialStoryboardInteractionState()).toEqual({
      activeDragType: undefined,
      activeShotIds: [],
      dragPreviewShotIds: [],
      storyboardInsertionIndicator: undefined,
      parkingInsertionIndicator: undefined,
      activeParkedShotIds: [],
      selectedShotIds: [],
      deleteTarget: { type: "shot" },
      selectedBitmapLayerIds: undefined
    });
  });

  it("keeps the same bitmap layer selection only when shot and layer order match", () => {
    expect(sameLayerSelection({ shotId: "shot-1", layerIds: ["a", "b"] }, "shot-1", ["a", "b"])).toBe(true);
    expect(sameLayerSelection(undefined, "shot-1", ["a"])).toBe(false);
    expect(sameLayerSelection({ shotId: "shot-2", layerIds: ["a"] }, "shot-1", ["a"])).toBe(false);
    expect(sameLayerSelection({ shotId: "shot-1", layerIds: ["a", "b"] }, "shot-1", ["b", "a"])).toBe(false);
    expect(sameLayerSelection({ shotId: "shot-1", layerIds: ["a"] }, "shot-1", ["a", "b"])).toBe(false);
  });

  it("recognizes equivalent delete targets without relying on object identity", () => {
    expect(sameDeleteTarget({ type: "shot" }, { type: "shot" })).toBe(true);
    expect(
      sameDeleteTarget(
        { type: "layer", shotId: "shot-1", layerId: "paint" },
        { type: "layer", shotId: "shot-1", layerId: "paint" }
      )
    ).toBe(true);
    expect(
      sameDeleteTarget(
        { type: "layer", shotId: "shot-1", layerId: "paint" },
        { type: "layer", shotId: "shot-2", layerId: "paint" }
      )
    ).toBe(false);
  });
});
