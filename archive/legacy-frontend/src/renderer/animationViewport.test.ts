import { describe, expect, it } from "vitest";
import {
  getAnimationViewport,
  getZoomPreviewState,
  getStableBoardTop,
  maxStoryboardZoom,
  nextKeyboardStoryboardZoom,
  normalizeStoryboardZoom,
  sameAnimationViewport
} from "./animationViewport";

describe("animation viewport", () => {
  it("enters animation mode only at max zoom", () => {
    const beforeMax = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 255,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });
    const atMax = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: maxStoryboardZoom,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });

    expect(beforeMax.isAnimationMode).toBe(false);
    expect(atMax.isAnimationMode).toBe(true);
    expect(atMax.imageWidth).toBeCloseTo(795.6, 1);
    expect(atMax.imageHeight).toBe(502);
  });

  it("keeps normal storyboard scaling below max zoom", () => {
    const before = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 250,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });
    const nextStep = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 255,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });

    expect(before.isAnimationMode).toBe(false);
    expect(nextStep.isAnimationMode).toBe(false);
    expect(nextStep.imageWidth - before.imageWidth).toBeCloseTo(21.5, 1);
  });

  it("aligns the animation frame to the fitted image size", () => {
    const viewport = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: maxStoryboardZoom,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(viewport.frameWidth).toBe(viewport.imageWidth);
    expect(viewport.frameHeight).toBe(viewport.imageHeight);
  });

  it("leaves room for the animation shot header and dialogue chrome", () => {
    const cardChromeHeight = 84;
    const viewportHeight = 1110;
    const boardTop = 22;
    const reservedBottom = 84;
    const margin = 14;
    const visibleHeight = viewportHeight - Math.max(boardTop, margin) - reservedBottom - margin;
    const viewport = getAnimationViewport({
      boardWidth: 1740,
      boardTop,
      viewportHeight,
      reservedBottom,
      margin,
      zoomLevel: 260,
      isAnimationMode: true,
      imageAspectRatio: 16 / 9
    });

    expect(viewport.imageHeight + cardChromeHeight).toBeLessThanOrEqual(visibleHeight);
  });

  it("uses measured shot chrome height when fitting animation mode", () => {
    const viewportHeight = 1110;
    const boardTop = 22;
    const reservedBottom = 84;
    const margin = 14;
    const measuredChromeHeight = 160;
    const visibleHeight = viewportHeight - Math.max(boardTop, margin) - reservedBottom - margin;
    const viewport = getAnimationViewport({
      boardWidth: 1740,
      boardTop,
      viewportHeight,
      reservedBottom,
      margin,
      zoomLevel: 260,
      isAnimationMode: true,
      imageAspectRatio: 16 / 9,
      cardChromeHeight: measuredChromeHeight
    });

    expect(viewport.imageHeight + measuredChromeHeight).toBeLessThanOrEqual(visibleHeight);
    expect(viewport.imageHeight).toBeLessThan(906);
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

  it("exits animation mode immediately below max zoom", () => {
    const storyboardMode = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 255,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });
    const animationMode = getAnimationViewport({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: maxStoryboardZoom,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(storyboardMode.isAnimationMode).toBe(false);
    expect(animationMode.isAnimationMode).toBe(true);
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
      zoomLevel: maxStoryboardZoom,
      isAnimationMode: false,
      imageAspectRatio: 420 / 265
    });
    const afterScroll = getAnimationViewport({
      boardWidth: 1200,
      boardTop: getStableBoardTop(-180, 300),
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: maxStoryboardZoom,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(beforeScroll.isAnimationMode).toBe(true);
    expect(afterScroll.isAnimationMode).toBe(true);
    expect(afterScroll.imageWidth).toBe(beforeScroll.imageWidth);
  });

  it("uses the provided image aspect ratio for animation width", () => {
    const scope = {
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: maxStoryboardZoom,
      isAnimationMode: true
    };
    const wide = getAnimationViewport({ ...scope, imageAspectRatio: 2581 / 1080 });
    const tall = getAnimationViewport({ ...scope, imageAspectRatio: 1544 / 1080 });

    expect(wide.imageWidth).toBeGreaterThan(tall.imageWidth);
    expect(wide.imageHeight).toBe(tall.imageHeight);
    expect(Math.round(wide.imageWidth / wide.imageHeight)).toBeCloseTo(Math.round(2581 / 1080), 0);
    expect(tall.imageHeight).toBe(Math.round(tall.imageWidth / (1544 / 1080)));
  });

  it("keeps the animation frame matched to each fitted image aspect ratio", () => {
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

    expect(wide.frameHeight).toBeLessThanOrEqual(502);
    expect(tall.frameHeight).toBe(502);
    expect(wide.imageWidth).not.toBe(tall.imageWidth);
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
    expect(viewport.imageWidth).toBeCloseTo(1199.7, 1);
    expect(viewport.imageHeight).toBe(502);
  });

  it("normalizes storyboard zoom to the supported stepped range", () => {
    expect(normalizeStoryboardZoom(27)).toBe(25);
    expect(normalizeStoryboardZoom(28)).toBe(30);
    expect(normalizeStoryboardZoom(4)).toBe(25);
    expect(normalizeStoryboardZoom(maxStoryboardZoom + 20)).toBe(maxStoryboardZoom);
  });

  it("steps keyboard zoom from the current zoom level", () => {
    expect(nextKeyboardStoryboardZoom(100, "in")).toBe(105);
    expect(nextKeyboardStoryboardZoom(100, "out")).toBe(95);
    expect(nextKeyboardStoryboardZoom(25, "out")).toBe(25);
    expect(nextKeyboardStoryboardZoom(maxStoryboardZoom, "in")).toBe(maxStoryboardZoom);
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
      animationFrameHeight: "502px"
    });
  });

  it("builds a non-animation zoom preview until max zoom", () => {
    const preview = getZoomPreviewState({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: 255,
      isAnimationMode: true,
      imageAspectRatio: 420 / 265
    });

    expect(preview.viewport.isAnimationMode).toBe(false);
    expect(preview.cssVariables.shotScale).toBe("2.55");
  });

  it("builds an animation zoom preview from the same viewport math as final state at max zoom", () => {
    const preview = getZoomPreviewState({
      boardWidth: 1200,
      boardTop: 120,
      viewportHeight: 900,
      reservedBottom: 180,
      margin: 14,
      zoomLevel: maxStoryboardZoom,
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
