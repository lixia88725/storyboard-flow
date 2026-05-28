export const sketchCanvasSize = {
  width: 420,
  height: 265
};

export type CanvasSize = {
  width: number;
  height: number;
};

type ClientRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const sketchPointFromClientPoint = (
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  canvasSize: CanvasSize = sketchCanvasSize
): { x: number; y: number } => {
  const x = ((clientX - rect.left) / rect.width) * canvasSize.width;
  const y = ((clientY - rect.top) / rect.height) * canvasSize.height;
  return { x, y };
};
