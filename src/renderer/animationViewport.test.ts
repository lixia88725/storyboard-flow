import { describe, expect, it } from "vitest";
import { getAnimationViewport, getStableBoardTop } from "./animationViewport";

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
});
