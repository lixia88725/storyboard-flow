import { afterEach, describe, expect, it, vi } from "vitest";
import type { Shot } from "../shared/types";
import { getAnimationViewport, maxStoryboardZoom } from "./animationViewport";
import { animationViewportMargin } from "./animationModeLayoutController";
import {
  applyZoomPreviewCssVariablesToBoard,
  storyboardZoomPreviewStateFromBoard,
  storyboardZoomStyleVariables
} from "./storyboardZoomController";

const shot: Shot = {
  id: "shot-1",
  imagePath: "shot-1.tiff",
  fileName: "shot-1.tiff",
  order: 1,
  swb: {
    version: 1,
    status: "owned",
    canvasWidth: 1920,
    canvasHeight: 1080
  }
};

describe("storyboardZoomController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("applies live zoom preview variables for both storyboard and Japanese storyboard views", () => {
    const styleProperties = new Map<string, string>();
    const board = {
      style: {
        setProperty: (property: string, value: string) => styleProperties.set(property, value)
      }
    } as unknown as HTMLElement;

    applyZoomPreviewCssVariablesToBoard(board, {
      shotScale: "1.5",
      animationImageWidth: "640px",
      animationImageHeight: "360px",
      animationFrameWidth: "700px",
      animationFrameHeight: "420px"
    });

    expect(styleProperties.get("--shot-scale")).toBe("1.5");
    expect(styleProperties.get("--japanese-storyboard-zoom")).toBe("1.5");
    expect(styleProperties.get("--animation-image-width")).toBe("640px");
  });

  it("builds zoom preview state from the animation viewport measurement", () => {
    const timeline = {
      getBoundingClientRect: () => ({ top: 650 }) as DOMRect
    };
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === ".timeline" ? timeline : null)
    });

    const board = {
      querySelector: () => ({}),
      getBoundingClientRect: () => ({ width: 960, top: 40 }) as DOMRect
    } as unknown as HTMLElement;
    const scrollContainer = {
      clientHeight: 900,
      getBoundingClientRect: () => ({ width: 1200, top: 8, bottom: 800 }) as DOMRect,
      scrollBy: () => undefined,
      scrollLeft: 0,
      scrollTop: 20
    } as unknown as HTMLDivElement;
    const preview = storyboardZoomPreviewStateFromBoard({
      board,
      scrollContainer,
      viewportShot: shot,
      zoomLevel: 260,
      isAnimationMode: true
    });
    const expectedViewport = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 52,
      viewportHeight: 900,
      reservedBottom: 150,
      margin: animationViewportMargin,
      zoomLevel: 260,
      maxZoomLevel: maxStoryboardZoom,
      isAnimationMode: true,
      imageAspectRatio: 1920 / 1080
    });

    expect(preview?.viewport).toEqual(expectedViewport);
    expect(preview?.cssVariables.animationImageWidth).toBe(`${expectedViewport.imageWidth}px`);
    expect(preview?.cssVariables.animationImageHeight).toBe(`${expectedViewport.imageHeight}px`);
  });
});
