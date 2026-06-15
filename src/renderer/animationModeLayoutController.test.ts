import { describe, expect, it } from "vitest";
import type { Shot } from "../shared/types";
import { getAnimationViewport, maxStoryboardZoom } from "./animationViewport";
import {
  animationReservedBottom,
  animationViewportFromBoard,
  animationViewportMargin
} from "./animationModeLayoutController";

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

describe("animationModeLayoutController", () => {
  it("does not measure animation layout before a shot exists in the board", () => {
    const board = {
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 960, top: 10 }) as DOMRect
    } as unknown as HTMLElement;

    expect(
      animationViewportFromBoard({
        board,
        scrollContainer: null,
        viewportShot: shot,
        zoomLevel: 200,
        isAnimationMode: false
      })
    ).toBeUndefined();
  });

  it("builds the same viewport input that App previously assembled inline", () => {
    const board = {
      querySelector: () => ({}),
      getBoundingClientRect: () => ({ width: 960, top: 10 }) as DOMRect
    } as unknown as HTMLElement;
    const scrollContainer = {
      clientHeight: 720,
      scrollBy: () => undefined,
      scrollLeft: 0,
      scrollTop: 20
    } as unknown as HTMLDivElement;

    const viewport = animationViewportFromBoard({
      board,
      scrollContainer,
      viewportShot: shot,
      zoomLevel: 200,
      isAnimationMode: false
    });

    expect(viewport).toEqual(
      getAnimationViewport({
        boardWidth: 960,
        boardTop: 30,
        viewportHeight: 720,
        reservedBottom: animationReservedBottom,
        margin: animationViewportMargin,
        zoomLevel: 200,
        maxZoomLevel: maxStoryboardZoom,
        isAnimationMode: false,
        imageAspectRatio: 1920 / 1080
      })
    );
  });
});
