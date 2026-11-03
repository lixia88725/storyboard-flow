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
export type BitmapSelectionHitTarget =
  | { type: "scale"; corner: SelectionCorner }
  | { type: "rotate" }
  | { type: "move" }
  | { type: "none" };

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

export const shouldCloseRadialMenuForSketchPointer = (event: PointerStartLike): boolean =>
  shouldStartSketchPointer(event);

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

export const strokeSegmentsFromPointOffset = (
  stroke: StrokeLike,
  pointOffset: number
): Array<readonly [number, number, number, number]> => {
  const pointCount = Math.floor(stroke.points.length / 2);
  const startPointOffset = Math.max(1, pointOffset);
  const segments: Array<readonly [number, number, number, number]> = [];

  for (let pointIndex = startPointOffset; pointIndex < pointCount; pointIndex += 1) {
    const previousOffset = (pointIndex - 1) * 2;
    const currentOffset = pointIndex * 2;
    segments.push([
      stroke.points[previousOffset],
      stroke.points[previousOffset + 1],
      stroke.points[currentOffset],
      stroke.points[currentOffset + 1]
    ]);
  }

  return segments;
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

export const shouldUseRenderedEraserDataUrl = ({
  layerId,
  pendingCommittedStrokes
}: {
  layerId: string;
  pendingCommittedStrokes: { layerId: string; stroke: { tool?: "brush" | "eraser" } }[];
}): boolean => {
  return !pendingCommittedStrokes.some(
    (pendingStroke) => pendingStroke.layerId === layerId && pendingStroke.stroke.tool === "brush"
  );
};

export const liveStrokePreviewOpacity = (
  stroke: { tool?: "brush" | "eraser"; opacity?: number },
  layerOpacity = 1
): number => {
  const strokeOpacity = stroke.opacity ?? 1;
  return stroke.tool === "eraser" ? strokeOpacity : strokeOpacity * layerOpacity;
};

export const shouldRestartStrokeForToolChange = (
  stroke: { tool?: "brush" | "eraser" },
  activeTool: "brush" | "eraser" | "select" | "blur" | "eyedropper"
): boolean => {
  return (activeTool === "brush" || activeTool === "eraser") && stroke.tool !== activeTool;
};

export const shouldClearBitmapSelectionForTool = (
  activeTool: "brush" | "eraser" | "select" | "blur" | "eyedropper"
): boolean => activeTool !== "select" && activeTool !== "blur";

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
  handleRadius: number,
  rotationHandleOffset = handleRadius * 2.5,
  canvasHeight = Number.POSITIVE_INFINITY
): BitmapSelectionHitTarget => {
  const rotationHandle = bitmapSelectionRotationHandlePoint(
    bounds,
    rotationHandleOffset,
    canvasHeight
  );
  const rotationDx = point.x - rotationHandle.x;
  const rotationDy = point.y - rotationHandle.y;
  const handleRadiusSquared = handleRadius * handleRadius;
  if (rotationDx * rotationDx + rotationDy * rotationDy <= handleRadiusSquared) {
    return { type: "rotate" };
  }

  const corners: Array<{ corner: SelectionCorner; point: Point }> = [
    { corner: "nw", point: { x: bounds.x, y: bounds.y } },
    { corner: "ne", point: { x: bounds.x + bounds.width, y: bounds.y } },
    { corner: "sw", point: { x: bounds.x, y: bounds.y + bounds.height } },
    { corner: "se", point: { x: bounds.x + bounds.width, y: bounds.y + bounds.height } }
  ];

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

export const bitmapSelectionCenter = (bounds: Bounds): Point => ({
  x: bounds.x + bounds.width / 2,
  y: bounds.y + bounds.height / 2
});

export const bitmapSelectionRotationHandlePoint = (
  bounds: Bounds,
  offset: number,
  canvasHeight = Number.POSITIVE_INFINITY
): Point => {
  const above = bounds.y - offset;
  const below = bounds.y + bounds.height + offset;
  return {
    x: bounds.x + bounds.width / 2,
    y:
      above >= 0
        ? above
        : below <= canvasHeight
          ? below
          : Math.min(canvasHeight, Math.max(0, bounds.y + offset))
  };
};

export const rotationRadiansBetweenPoints = (
  center: Point,
  startPoint: Point,
  currentPoint: Point
): number => {
  const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
  const currentAngle = Math.atan2(currentPoint.y - center.y, currentPoint.x - center.x);
  let delta = currentAngle - startAngle;
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
};

export const rotatePointAroundCenter = (
  point: Point,
  center: Point,
  radians: number
): Point => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
};

export const bitmapSelectionBoundsCorners = (bounds: Bounds): Point[] => [
  { x: bounds.x, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  { x: bounds.x, y: bounds.y + bounds.height }
];

export const rotatedBitmapSelectionBounds = (
  bounds: Bounds,
  radians: number
): { bounds: Bounds; points: Point[] } => {
  const center = bitmapSelectionCenter(bounds);
  const points = bitmapSelectionBoundsCorners(bounds).map((point) =>
    rotatePointAroundCenter(point, center, radians)
  );
  return {
    bounds: bitmapSelectionBounds(points) ?? bounds,
    points
  };
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
