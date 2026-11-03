import { describe, expect, it } from "vitest";
import { initialBoardViewState } from "./boardViewState";

describe("boardViewState", () => {
  it("uses the existing storyboard zoom and animation defaults", () => {
    expect(initialBoardViewState()).toEqual({
      zoomLevel: 100,
      isZoomScrubbing: false,
      isAnimationMode: false,
      animationImageSize: { width: 430, height: 271 },
      animationFrameSize: { width: 430, height: 271 }
    });
  });
});
