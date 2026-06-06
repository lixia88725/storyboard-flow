const baseShotWidth = 430;
const zoomStep = 5;
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
  isAnimationMode: wasAnimationMode,
  imageAspectRatio
}: AnimationViewportInput): AnimationViewport => {
  const safeAspectRatio = imageAspectRatio > 0 ? imageAspectRatio : 420 / 265;
  const visibleTop = Math.max(boardTop, margin);
  const visibleHeight = Math.max(1, viewportHeight - visibleTop - reservedBottom - margin);
  const frameWidth = boardWidth;
  const frameHeight = Math.round(visibleHeight);
  const fitWidth = Math.min(frameWidth, frameHeight * safeAspectRatio);
  const fitHeight = Math.round(fitWidth / safeAspectRatio);
  const fitZoom = (fitWidth / baseShotWidth) * 100;
  const animationStartZoom = Math.min(maxZoomLevel, Math.ceil(fitZoom / zoomStep) * zoomStep);
  const animationEndZoom = animationStartZoom - zoomStep;
  const isAnimationMode = wasAnimationMode
    ? zoomLevel >= animationEndZoom
    : zoomLevel >= animationStartZoom;
  const imageWidth = isAnimationMode
    ? fitWidth * (zoomLevel / animationStartZoom)
    : baseShotWidth * (zoomLevel / 100);

  return {
    isAnimationMode,
    imageWidth,
    imageHeight: Math.round(imageWidth / safeAspectRatio || fitHeight),
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
