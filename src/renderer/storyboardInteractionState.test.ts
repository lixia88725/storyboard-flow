import { describe, expect, it } from "vitest";
import { initialStoryboardInteractionState } from "./storyboardInteractionState";

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
});
