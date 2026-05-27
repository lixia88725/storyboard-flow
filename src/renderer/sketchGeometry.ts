export const sketchCanvasSize = {
  width: 420,
  height: 265
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
  rect: ClientRectLike
): { x: number; y: number } => {
  const x = ((clientX - rect.left) / rect.width) * sketchCanvasSize.width;
  const y = ((clientY - rect.top) / rect.height) * sketchCanvasSize.height;
  return { x, y };
};
