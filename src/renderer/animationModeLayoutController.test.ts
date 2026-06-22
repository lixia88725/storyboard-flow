import { afterEach, describe, expect, it, vi } from "vitest";
import type { Shot } from "../shared/types";
import { getAnimationViewport, maxStoryboardZoom } from "./animationViewport";
import {
  animationCenteringScrollDelta,
  animationReservedBottom,
  animationShotChromeHeightFromElement,
  animationViewportInputFromBoard,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      getBoundingClientRect: () => ({ width: 960, top: 8, bottom: 728 }) as DOMRect,
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
        boardTop: 22,
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

  it("centers the animation image in scroll-container coordinates", () => {
    expect(
      animationCenteringScrollDelta({
        elementRect: { top: 140, bottom: 940, height: 800 },
        scrollContainerRect: { top: 110, bottom: 1220 },
        scrollContainerHeight: 1110,
        timelineRect: { top: 1115 },
        margin: 14
      })
    ).toBe(-72);
  });

  it("uses scroll-container coordinates and the real timeline reserve for viewport input", () => {
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

    expect(
      animationViewportInputFromBoard({
        board,
        scrollContainer,
        viewportShot: shot,
        zoomLevel: 260,
        isAnimationMode: true
      })
    ).toEqual({
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
  });

  it("measures animation shot chrome from the rendered shot and image stage", () => {
    const imageStage = {
      getBoundingClientRect: () => ({ height: 600 }) as DOMRect
    };
    const renderedShot = {
      querySelector: (selector: string) => (selector === ".image-stage" ? imageStage : null),
      getBoundingClientRect: () => ({ height: 724 }) as DOMRect
    } as unknown as HTMLElement;

    expect(animationShotChromeHeightFromElement(renderedShot)).toBe(124);
  });

  it("passes measured animation shot chrome into viewport input while animation mode is active", () => {
    const imageStage = {
      getBoundingClientRect: () => ({ height: 600 }) as DOMRect
    };
    const renderedShot = {
      querySelector: (selector: string) => (selector === ".image-stage" ? imageStage : null),
      getBoundingClientRect: () => ({ top: 58, height: 724 }) as DOMRect
    };
    const board = {
      querySelector: () => renderedShot,
      getBoundingClientRect: () => ({ width: 960, top: 40 }) as DOMRect
    } as unknown as HTMLElement;
    const scrollContainer = {
      clientHeight: 900,
      getBoundingClientRect: () => ({ width: 1200, top: 8, bottom: 800 }) as DOMRect,
      scrollBy: () => undefined,
      scrollLeft: 0,
      scrollTop: 20
    } as unknown as HTMLDivElement;

    const input = animationViewportInputFromBoard({
      board,
      scrollContainer,
      viewportShot: shot,
      zoomLevel: 260,
      isAnimationMode: true
    });

    expect(input?.cardChromeHeight).toBe(124);
  });

  it("uses the rendered shot top when the animation grid has top inset", () => {
    const renderedShot = {
      getBoundingClientRect: () => ({ top: 58 }) as DOMRect
    };
    const board = {
      querySelector: () => renderedShot,
      getBoundingClientRect: () => ({ width: 960, top: 40 }) as DOMRect
    } as unknown as HTMLElement;
    const scrollContainer = {
      clientHeight: 900,
      getBoundingClientRect: () => ({ width: 1200, top: 8, bottom: 800 }) as DOMRect,
      scrollBy: () => undefined,
      scrollLeft: 0,
      scrollTop: 20
    } as unknown as HTMLDivElement;

    expect(
      animationViewportInputFromBoard({
        board,
        scrollContainer,
        viewportShot: shot,
        zoomLevel: 260,
        isAnimationMode: true
      })?.boardTop
    ).toBe(70);
  });

  it("measures the selected animation shot instead of the first shot", () => {
    const firstImageStage = {
      getBoundingClientRect: () => ({ height: 500 }) as DOMRect
    };
    const selectedImageStage = {
      getBoundingClientRect: () => ({ height: 600 }) as DOMRect
    };
    const firstShotElement = {
      querySelector: (selector: string) => (selector === ".image-stage" ? firstImageStage : null),
      getBoundingClientRect: () => ({ top: 40, height: 560 }) as DOMRect
    };
    const selectedShotElement = {
      querySelector: (selector: string) => (selector === ".image-stage" ? selectedImageStage : null),
      getBoundingClientRect: () => ({ top: 80, height: 720 }) as DOMRect
    };
    const board = {
      querySelector: (selector: string) =>
        selector === '[data-shot-id="shot-2"]' ? selectedShotElement : firstShotElement,
      getBoundingClientRect: () => ({ width: 960, top: 40 }) as DOMRect
    } as unknown as HTMLElement;
    const scrollContainer = {
      clientHeight: 900,
      getBoundingClientRect: () => ({ width: 1200, top: 8, bottom: 800 }) as DOMRect,
      scrollBy: () => undefined,
      scrollLeft: 0,
      scrollTop: 20
    } as unknown as HTMLDivElement;

    const input = animationViewportInputFromBoard({
      board,
      scrollContainer,
      viewportShot: { ...shot, id: "shot-2" },
      zoomLevel: 260,
      isAnimationMode: true
    });

    expect(input?.boardTop).toBe(92);
    expect(input?.cardChromeHeight).toBe(120);
  });
});
