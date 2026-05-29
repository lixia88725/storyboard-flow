const baseShotWidth = 430;
const zoomStep = 5;
export const maxStoryboardZoom = 260;

type AnimationViewportInput = {
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

type AnimationViewport = {
  isAnimationMode: boolean;
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
};

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
