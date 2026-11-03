export type CanvasFitBox = { width: number; height: number };

/**
 * Largest box of the given aspect ratio that fits inside the available area.
 * Returns undefined when the area or the aspect ratio cannot be measured, so the
 * caller can fall back instead of collapsing the canvas to nothing.
 */
export const fitCanvasBox = ({
  containerWidth,
  containerHeight,
  aspectRatio
}: {
  containerWidth: number;
  containerHeight: number;
  aspectRatio: number;
}): CanvasFitBox | undefined => {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(containerHeight)) {
    return undefined;
  }
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return undefined;
  }
  if (containerWidth <= 0 || containerHeight <= 0) {
    return undefined;
  }

  // Width is the binding dimension unless height runs out first.
  const width = Math.min(containerWidth, containerHeight * aspectRatio);
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(width / aspectRatio))
  };
};

/** Content box of an element, excluding its padding; undefined when unmeasurable. */
export const contentBoxOf = (element: {
  clientWidth: number;
  clientHeight: number;
} | null, padding: { left: number; top: number; right: number; bottom: number }): {
  width: number;
  height: number;
} | undefined => {
  if (!element) {
    return undefined;
  }
  const width = element.clientWidth - padding.left - padding.right;
  const height = element.clientHeight - padding.top - padding.bottom;
  return width > 0 && height > 0 ? { width, height } : undefined;
};
