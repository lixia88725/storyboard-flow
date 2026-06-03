export const sketchCanvasSize = {
  width: 420,
  height: 265
};

export type CanvasSize = {
  width: number;
  height: number;
};

export type StrokeLike = {
  tool?: "brush" | "eraser";
  points: number[];
};

export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SelectionCorner = "nw" | "ne" | "sw" | "se";

type ClientRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type ClientPointLike = {
  clientX: number;
  clientY: number;
};
type PointerStartLike = {
  button?: number;
  isPrimary?: boolean;
};
type PointerIdentityLike = {
  pointerId?: number;
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

export const sketchPointsFromClientPoints = (
  points: ClientPointLike[],
  rect: ClientRectLike,
  canvasSize: CanvasSize = sketchCanvasSize
): Point[] => points.map((point) => sketchPointFromClientPoint(point.clientX, point.clientY, rect, canvasSize));

export const shouldStartSketchPointer = (event: PointerStartLike): boolean => {
  return (event.button === undefined || event.button === 0) && event.isPrimary !== false;
};

export const shouldHandleSketchPointer = (
  event: PointerIdentityLike,
  activePointerId: number | undefined
): boolean => {
  return activePointerId === undefined || event.pointerId === activePointerId;
};

export const shouldAppendStrokePoint = (
  stroke: StrokeLike,
  point: { x: number; y: number },
  minDistance: number
): boolean => {
  const lastX = stroke.points[stroke.points.length - 2];
  const lastY = stroke.points[stroke.points.length - 1];

  if (lastX === undefined || lastY === undefined) {
    return true;
  }

  const dx = point.x - lastX;
  const dy = point.y - lastY;
  return dx * dx + dy * dy >= minDistance * minDistance;
};

export const shouldCommitStroke = (stroke: StrokeLike): boolean => {
  return stroke.points.length >= 2;
};

export const latestStrokeSegment = (
  stroke: StrokeLike
): readonly [number, number, number, number] | undefined => {
  if (stroke.points.length < 4) {
    return undefined;
  }

  const startIndex = stroke.points.length - 4;
  return [
    stroke.points[startIndex],
    stroke.points[startIndex + 1],
    stroke.points[startIndex + 2],
    stroke.points[startIndex + 3]
  ];
};

export const layerDropPlacementFromClientY = (
  clientY: number,
  rowTop: number,
  rowHeight: number
): "before" | "after" => {
  return clientY < rowTop + rowHeight / 2 ? "after" : "before";
};

export type LayerRowDragIntent = "opacity" | "reorder";

export const layerRowDragIntentFromDelta = (
  deltaX: number,
  deltaY: number,
  threshold = 6
): LayerRowDragIntent | undefined => {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (Math.max(absX, absY) < threshold) {
    return undefined;
  }

  return absX > absY ? "opacity" : "reorder";
};

export const layerOpacityFromClientX = (
  clientX: number,
  rowLeft: number,
  rowWidth: number
): number => {
  if (rowWidth <= 0) {
    return 1;
  }

  const rawOpacity = (clientX - rowLeft) / rowWidth;
  return Math.round(Math.min(1, Math.max(0, rawOpacity)) * 100) / 100;
};

export type BlendMenuDirection = "down" | "up";

export const blendMenuDirectionFromRects = (
  rowTop: number,
  rowBottom: number,
  listTop: number,
  listBottom: number,
  menuHeight = 96
): BlendMenuDirection => {
  const spaceAbove = rowTop - listTop;
  const spaceBelow = listBottom - rowBottom;
  return spaceBelow < menuHeight && spaceAbove > spaceBelow ? "up" : "down";
};

export const shouldRenderLiveStroke = (stroke: { tool?: "brush" | "eraser" }): boolean => {
  return stroke.tool !== "eraser";
};

export const shouldKeepCommittedStrokePreview = (stroke: { tool?: "brush" | "eraser" }): boolean => {
  return stroke.tool === "brush";
};

export const liveStrokePreviewOpacity = (
  stroke: { tool?: "brush" | "eraser"; opacity?: number },
  layerOpacity = 1
): number => {
  const strokeOpacity = stroke.opacity ?? 1;
  return stroke.tool === "eraser" ? strokeOpacity : strokeOpacity * layerOpacity;
};

export const bitmapSelectionBounds = (points: Point[]): Bounds | undefined => {
  if (points.length === 0) {
    return undefined;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
};

export const bitmapSelectionHitTarget = (
  point: Point,
  bounds: Bounds,
  handleRadius: number
): { type: "scale"; corner: SelectionCorner } | { type: "move" } | { type: "none" } => {
  const corners: Array<{ corner: SelectionCorner; point: Point }> = [
    { corner: "nw", point: { x: bounds.x, y: bounds.y } },
    { corner: "ne", point: { x: bounds.x + bounds.width, y: bounds.y } },
    { corner: "sw", point: { x: bounds.x, y: bounds.y + bounds.height } },
    { corner: "se", point: { x: bounds.x + bounds.width, y: bounds.y + bounds.height } }
  ];

  const handleRadiusSquared = handleRadius * handleRadius;
  const hitCorner = corners.find((item) => {
    const dx = point.x - item.point.x;
    const dy = point.y - item.point.y;
    return dx * dx + dy * dy <= handleRadiusSquared;
  });

  if (hitCorner) {
    return { type: "scale", corner: hitCorner.corner };
  }

  if (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  ) {
    return { type: "move" };
  }

  return { type: "none" };
};

export const bitmapSelectionHandleRadiusForStage = (
  canvasSize: CanvasSize,
  stageSize: CanvasSize,
  screenRadius: number
): number => {
  const scaleX = stageSize.width / canvasSize.width;
  const scaleY = stageSize.height / canvasSize.height;
  const scale = Math.min(scaleX, scaleY);

  return scale > 0 ? screenRadius / scale : screenRadius;
};

export const scaleBitmapSelectionBounds = (
  bounds: Bounds,
  corner: SelectionCorner,
  point: Point
): Bounds => {
  const opposite = {
    nw: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ne: { x: bounds.x, y: bounds.y + bounds.height },
    sw: { x: bounds.x + bounds.width, y: bounds.y },
    se: { x: bounds.x, y: bounds.y }
  }[corner];

  const left = Math.min(opposite.x, point.x);
  const right = Math.max(opposite.x, point.x);
  const top = Math.min(opposite.y, point.y);
  const bottom = Math.max(opposite.y, point.y);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
};
