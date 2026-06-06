import { describe, expect, it } from "vitest";
import {
  getAnimationViewport,
  getZoomPreviewState,
  getStableBoardTop,
  maxStoryboardZoom,
  nextWheelStoryboardZoom,
  normalizeStoryboardZoom,
  sameAnimationViewport
} from "./animationViewport";

describe("animation viewport", () => {
  it("fits the image into the visible board area when animation mode starts", () => {
    const viewport = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 220,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });

    expect(viewport.isAnimationMode).toBe(true);
    expect(viewport.imageWidth).toBeCloseTo(928.8, 1);
    expect(viewport.imageHeight).toBe(586);
  });

  it("does not jump into animation mode before the zoomed image reaches the visible board area", () => {
    const before = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 150,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });
    const nextStep = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 155,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });

    expect(before.isAnimationMode).toBe(false);
    expect(nextStep.isAnimationMode).toBe(false);
    expect(nextStep.imageWidth - before.imageWidth).toBeCloseTo(21.5, 1);
  });

  it("uses further zoom to enlarge the image beyond the fitted size", () => {
    const fitted = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 220,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });
    const zoomed = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 250,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(zoomed.imageWidth).toBeGreaterThan(fitted.imageWidth);
    expect(zoomed.imageHeight).toBeGreaterThan(fitted.imageHeight);
  });

  it("keeps storyboard mode before the image can fill the visible board area", () => {
    const viewport = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 150,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });

    expect(viewport.isAnimationMode).toBe(false);
  });

  it("keeps animation mode through the threshold step while zooming back out", () => {
    const stillAnimation = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 215,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });
    const storyboardMode = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 210,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(stillAnimation.isAnimationMode).toBe(true);
    expect(storyboardMode.isAnimationMode).toBe(false);
  });

  it("keeps the board top stable when scrolling in animation mode", () => {
    expect(getStableBoardTop(120, 0)).toBe(120);
    expect(getStableBoardTop(-180, 300)).toBe(120);
  });

  it("keeps animation mode stable after the page scrolls the board upward", () => {
    const beforeScroll = getAnimationViewport({
      boardWidth: 1200,
      boardTop: getStableBoardTop(120, 0),
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 220,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });
    const afterScroll = getAnimationViewport({
      boardWidth: 1200,
      boardTop: getStableBoardTop(-180, 300),
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 220,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(beforeScroll.isAnimationMode).toBe(true);
    expect(afterScroll.isAnimationMode).toBe(true);
    expect(afterScroll.imageWidth).toBe(beforeScroll.imageWidth);
  });

  it("uses the provided image aspect ratio for animation sizing", () => {
    const scope = {
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 220,
      isAnimationMode: false
    };
    const wide = getAnimationViewport({ ...scope, imageAspectRatio: 2581 / 1080 });
    const tall = getAnimationViewport({ ...scope, imageAspectRatio: 1544 / 1080 });

    expect(wide.imageHeight).toBeLessThan(tall.imageHeight);
    expect(Math.round(wide.imageWidth / wide.imageHeight)).toBeCloseTo(Math.round(2581 / 1080), 0);
    expect(tall.imageHeight).toBe(Math.round(tall.imageWidth / (1544 / 1080)));
  });

  it("keeps the animation frame stable across different image aspect ratios", () => {
    const scope = {
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 260,
      isAnimationMode: true
    };
    const wide = getAnimationViewport({ ...scope, imageAspectRatio: 2581 / 1080 });
    const tall = getAnimationViewport({ ...scope, imageAspectRatio: 1544 / 1080 });

    expect(wide.frameWidth).toBe(tall.frameWidth);
    expect(wide.frameHeight).toBe(tall.frameHeight);
    expect(wide.imageHeight).not.toBe(tall.imageHeight);
  });

  it("enters animation mode at max zoom when a wide image would otherwise need more zoom", () => {
    const viewport = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 260,
      maxZoomLevel: 260,
      isAnimationMode: false,
      imageAspectRatio: 2581 / 1080
    });

    expect(viewport.isAnimationMode).toBe(true);
    expect(viewport.imageWidth).toBe(1200);
    expect(viewport.imageHeight).toBe(Math.round(1200 / (2581 / 1080)));
  });

  it("normalizes storyboard zoom to the supported stepped range", () => {
    expect(normalizeStoryboardZoom(27)).toBe(25);
    expect(normalizeStoryboardZoom(28)).toBe(30);
    expect(normalizeStoryboardZoom(4)).toBe(25);
    expect(normalizeStoryboardZoom(maxStoryboardZoom + 20)).toBe(maxStoryboardZoom);
  });

  it("steps wheel zoom from the current zoom level", () => {
    expect(nextWheelStoryboardZoom(100, -1)).toBe(105);
    expect(nextWheelStoryboardZoom(100, 1)).toBe(95);
    expect(nextWheelStoryboardZoom(25, 1)).toBe(25);
    expect(nextWheelStoryboardZoom(maxStoryboardZoom, -1)).toBe(maxStoryboardZoom);
  });

  it("compares animation viewport state before updating React state", () => {
    const viewport = {
      isAnimationMode: true,
      imageWidth: 1200,
      imageHeight: 760,
      frameWidth: 1200,
      frameHeight: 760
    };

    expect(sameAnimationViewport(viewport, { ...viewport })).toBe(true);
    expect(sameAnimationViewport(viewport, { ...viewport, imageHeight: 761 })).toBe(false);
  });

  it("builds a stepped zoom preview state with CSS variables matching storyboard layout", () => {
    const preview = getZoomPreviewState({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 128,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });

    expect(preview.zoomLevel).toBe(130);
    expect(preview.cssVariables).toEqual({
      shotScale: "1.3",
      animationImageWidth: "559px",
      animationImageHeight: "353px",
      animationFrameWidth: "1200px",
      animationFrameHeight: "586px"
    });
  });

  it("builds an animation zoom preview from the same viewport math as final state", () => {
    const preview = getZoomPreviewState({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 250,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });
    const finalViewport = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: preview.zoomLevel,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(preview.viewport).toEqual(finalViewport);
    expect(preview.cssVariables.animationImageWidth).toBe(`${finalViewport.imageWidth}px`);
    expect(preview.cssVariables.animationImageHeight).toBe(`${finalViewport.imageHeight}px`);
  });
});
