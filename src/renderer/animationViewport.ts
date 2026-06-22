const baseShotWidth = 430;
const zoomStep = 5;
const fallbackAnimationShotChromeHeight = 84;
export const minStoryboardZoom = 25;
export const maxStoryboardZoom = 260;

export type AnimationViewportInput = {
  boardWidth: number;
  boardTop: number;
  viewportHeight: number;
  reservedBottom: number;
  margin: number;
  zoomLevel: number;
  maxZoomLevel?: number;
  isAnimationMode: boolean;
  imageAspectRatio: number;
  cardChromeHeight?: number;
};

export type AnimationViewport = {
  isAnimationMode: boolean;
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
};

export type ZoomPreviewCssVariables = {
  shotScale: string;
  animationImageWidth: string;
  animationImageHeight: string;
  animationFrameWidth: string;
  animationFrameHeight: string;
};

export type ZoomPreviewState = {
  zoomLevel: number;
  viewport: AnimationViewport;
  cssVariables: ZoomPreviewCssVariables;
};

export const normalizeStoryboardZoom = (
  zoomLevel: number,
  minZoomLevel = minStoryboardZoom,
  maxZoomLevel = maxStoryboardZoom
): number => {
  const steppedZoom = Math.round(zoomLevel / zoomStep) * zoomStep;
  return Math.min(maxZoomLevel, Math.max(minZoomLevel, steppedZoom));
};

export const nextWheelStoryboardZoom = (
  currentZoomLevel: number,
  deltaY: number,
  maxZoomLevel = maxStoryboardZoom
): number => {
  const direction = deltaY < 0 ? 1 : -1;
  return normalizeStoryboardZoom(currentZoomLevel + direction * zoomStep, minStoryboardZoom, maxZoomLevel);
};

export const nextKeyboardStoryboardZoom = (
  currentZoomLevel: number,
  direction: "in" | "out",
  maxZoomLevel = maxStoryboardZoom
): number => {
  const nextZoom = currentZoomLevel + (direction === "in" ? zoomStep : -zoomStep);
  return normalizeStoryboardZoom(nextZoom, minStoryboardZoom, maxZoomLevel);
};

export const sameAnimationViewport = (a: AnimationViewport, b: AnimationViewport): boolean =>
  a.isAnimationMode === b.isAnimationMode &&
  a.imageWidth === b.imageWidth &&
  a.imageHeight === b.imageHeight &&
  a.frameWidth === b.frameWidth &&
  a.frameHeight === b.frameHeight;

export const getStableBoardTop = (boardViewportTop: number, scrollY: number): number => {
  return boardViewportTop + scrollY;
};

export const getAnimationViewport = ({
  boardWidth,
  boardTop,
  viewportHeight,
  reservedBottom,
  margin,
  zoomLevel,
  maxZoomLevel = maxStoryboardZoom,
  imageAspectRatio,
  cardChromeHeight
}: AnimationViewportInput): AnimationViewport => {
  const safeAspectRatio = imageAspectRatio > 0 ? imageAspectRatio : 420 / 265;
  const visibleTop = Math.max(boardTop, margin);
  const visibleHeight = Math.max(1, viewportHeight - visibleTop - reservedBottom - margin);
  const shotChromeHeight =
    cardChromeHeight !== undefined && Number.isFinite(cardChromeHeight)
      ? Math.max(0, cardChromeHeight)
      : fallbackAnimationShotChromeHeight;
  const fittedFrameHeight = Math.max(1, Math.round(visibleHeight - shotChromeHeight));
  const fitWidth = Math.min(boardWidth, fittedFrameHeight * safeAspectRatio);
  const isAnimationMode = zoomLevel >= maxZoomLevel;
  const imageWidth = isAnimationMode
    ? fitWidth
    : baseShotWidth * (zoomLevel / 100);
  const imageHeight = Math.round(imageWidth / safeAspectRatio);
  const frameWidth = isAnimationMode ? imageWidth : boardWidth;
  const frameHeight = isAnimationMode ? imageHeight : fittedFrameHeight;

  return {
    isAnimationMode,
    imageWidth,
    imageHeight,
    frameWidth,
    frameHeight
  };
};

export const getZoomPreviewState = (input: AnimationViewportInput): ZoomPreviewState => {
  const zoomLevel = normalizeStoryboardZoom(input.zoomLevel, minStoryboardZoom, input.maxZoomLevel ?? maxStoryboardZoom);
  const viewport = getAnimationViewport({ ...input, zoomLevel });

  return {
    zoomLevel,
    viewport,
    cssVariables: {
      shotScale: String(zoomLevel / 100),
      animationImageWidth: `${viewport.imageWidth}px`,
      animationImageHeight: `${viewport.imageHeight}px`,
      animationFrameWidth: `${viewport.frameWidth}px`,
      animationFrameHeight: `${viewport.frameHeight}px`
    }
  };
};
