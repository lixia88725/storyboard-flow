import type { CanvasSize } from "./sketchGeometry";

type StageResizeDecision =
  | { type: "ignore" }
  | { type: "apply"; size: CanvasSize }
  | { type: "defer"; size: CanvasSize };

export const normalizeMeasuredStageSize = (size: CanvasSize): CanvasSize => ({
  width: Math.round(size.width),
  height: Math.round(size.height)
});

export const sameStageSize = (a: CanvasSize, b: CanvasSize): boolean =>
  a.width === b.width && a.height === b.height;

export const nextStageResizeDecision = ({
  currentSize,
  measuredSize,
  shouldDefer
}: {
  currentSize: CanvasSize;
  measuredSize: CanvasSize;
  shouldDefer: boolean;
}): StageResizeDecision => {
  const nextSize = normalizeMeasuredStageSize(measuredSize);
  if (nextSize.width <= 0 || nextSize.height <= 0 || sameStageSize(currentSize, nextSize)) {
    return { type: "ignore" };
  }

  return shouldDefer ? { type: "defer", size: nextSize } : { type: "apply", size: nextSize };
};
