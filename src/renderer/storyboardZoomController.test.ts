import { describe, expect, it } from "vitest";
import { storyboardZoomStyleVariables } from "./storyboardZoomController";

describe("storyboardZoomController", () => {
  it("builds fallback zoom CSS variables from board view state", () => {
    expect(
      storyboardZoomStyleVariables({
        animationFrameSize: { width: 430, height: 271 },
        animationImageSize: { width: 420, height: 236 },
        previewCssVariables: undefined,
        zoomLevel: 75
      })
    ).toEqual({
      "--shot-scale": 0.75,
      "--animation-image-width": "420px",
      "--animation-image-height": "236px",
      "--animation-frame-width": "430px",
      "--animation-frame-height": "271px"
    });
  });

  it("prefers live preview CSS variables while zoom scrubbing", () => {
    expect(
      storyboardZoomStyleVariables({
        animationFrameSize: { width: 430, height: 271 },
        animationImageSize: { width: 420, height: 236 },
        previewCssVariables: {
          shotScale: "0.8",
          animationImageWidth: "500px",
          animationImageHeight: "281px",
          animationFrameWidth: "520px",
          animationFrameHeight: "300px"
        },
        zoomLevel: 75
      })
    ).toEqual({
      "--shot-scale": "0.8",
      "--animation-image-width": "500px",
      "--animation-image-height": "281px",
      "--animation-frame-width": "520px",
      "--animation-frame-height": "300px"
    });
  });
});
