import type {
  BitmapBlendMode,
  BitmapLayer,
  Shot,
  SketchBlendMode,
  SketchStroke,
  SketchTool
} from "../shared/types";
import { sketchCanvasSize, type CanvasSize } from "./sketchGeometry";

const eyedropperCursorSvg = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#f8fafc" stroke-width="4"><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/></g><g stroke="#8f99a8" stroke-width="2"><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/></g></svg>`
);

const eyedropperCursor = `url("data:image/svg+xml,${eyedropperCursorSvg}") 3 29, crosshair`;

export const shouldShowBrushCursorPreviewForTool = (tool: SketchTool): boolean =>
  tool === "brush" || tool === "eraser";

export const sketchCursorForTool = (tool: SketchTool): string =>
  tool === "eyedropper" ? eyedropperCursor : shouldShowBrushCursorPreviewForTool(tool) ? "none" : "crosshair";

export const brushCursorPreviewToolSize = (
  tool: SketchTool,
  sizes: { brushSize: number; eraserSize: number }
): number | undefined => {
  if (tool === "brush") {
    return sizes.brushSize;
  }

  if (tool === "eraser") {
    return sizes.eraserSize;
  }

  return undefined;
};

export const brushCursorPreviewDiameter = ({
  toolSize,
  stageSize
}: {
  toolSize: number;
  stageSize: CanvasSize;
}): number => Math.max(4, toolSize * (stageSize.width / sketchCanvasSize.width));

export const canvasBlendMode = (blendMode: BitmapBlendMode | SketchBlendMode | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "source-over";
};

export const cssBlendMode = (blendMode: BitmapLayer["blendMode"] | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "normal";
};

export const canvasSizeForShot = (shot: Shot): CanvasSize => {
  const width = shot.swb?.canvasWidth;
  const height = shot.swb?.canvasHeight;

  return width && height ? { width, height } : sketchCanvasSize;
};

export const aspectRatioForShot = (shot: Shot): number => {
  const canvasSize = canvasSizeForShot(shot);
  return canvasSize.width / canvasSize.height;
};

export type RgbaColor = readonly [number, number, number, number];

const hexComponent = (value: number): string =>
  Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");

export const rgbaToHex = (red: number, green: number, blue: number): string =>
  `#${hexComponent(red)}${hexComponent(green)}${hexComponent(blue)}`;

export const sampleImageDataColorAtPoint = (
  imageData: ImageData,
  point: { x: number; y: number }
): string | undefined => {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);

  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return undefined;
  }

  const offset = (y * imageData.width + x) * 4;
  const alpha = imageData.data[offset + 3];
  if (alpha <= 0) {
    return undefined;
  }

  return rgbaToHex(imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]);
};

export const hexToRgba = (hexColor: string): RgbaColor => {
  const normalized = hexColor.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized.split("").map((part) => `${part}${part}`).join("")
      : normalized;
  const value = Number.parseInt(expanded, 16);

  if (!Number.isFinite(value) || expanded.length !== 6) {
    return [0, 0, 0, 255];
  }

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
};

const samePixelColor = (
  data: Uint8ClampedArray,
  offset: number,
  target: RgbaColor
): boolean =>
  data[offset] === target[0] &&
  data[offset + 1] === target[1] &&
  data[offset + 2] === target[2] &&
  data[offset + 3] === target[3];

export const fillImageDataAtPoint = (
  imageData: ImageData,
  point: { x: number; y: number },
  fillColor: RgbaColor
): void => {
  const width = imageData.width;
  const height = imageData.height;
  const startX = Math.min(width - 1, Math.max(0, Math.floor(point.x)));
  const startY = Math.min(height - 1, Math.max(0, Math.floor(point.y)));
  const startOffset = (startY * width + startX) * 4;
  const data = imageData.data;
  const target: RgbaColor = [
    data[startOffset],
    data[startOffset + 1],
    data[startOffset + 2],
    data[startOffset + 3]
  ];

  if (samePixelColor(data, startOffset, fillColor)) {
    return;
  }

  const stack: Array<[number, number]> = [[startX, startY]];
  const visited = new Uint8Array(width * height);

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }

    const [x, y] = next;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }

    const index = y * width + x;
    if (visited[index]) {
      continue;
    }
    visited[index] = 1;

    const offset = index * 4;
    if (!samePixelColor(data, offset, target)) {
      continue;
    }

    data[offset] = fillColor[0];
    data[offset + 1] = fillColor[1];
    data[offset + 2] = fillColor[2];
    data[offset + 3] = fillColor[3];

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
};

export const drawStrokePathOnCanvas = (
  context: CanvasRenderingContext2D,
  stroke: SketchStroke,
  segment?: readonly [number, number, number, number]
) => {
  context.save();
  context.globalAlpha = stroke.opacity ?? 1;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowBlur = Math.max(0, stroke.size * (stroke.softness ?? 0));
  context.shadowColor = stroke.color;
  context.beginPath();

  if (!segment && stroke.points.length === 2) {
    context.fillStyle = stroke.color;
    context.arc(stroke.points[0], stroke.points[1], stroke.size / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  if (segment) {
    context.moveTo(segment[0], segment[1]);
    context.lineTo(segment[2], segment[3]);
  } else {
    context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index], stroke.points[index + 1]);
    }
  }

  context.stroke();
  context.restore();
};

export const shouldDrawStrokeToBitmapLayer = (stroke: Pick<SketchStroke, "points">): boolean =>
  stroke.points.length >= 2;

const loadImageUrl = (sourceUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load layer bitmap"));
    image.src = sourceUrl;
  });

export const drawImageUrl = async (
  context: CanvasRenderingContext2D,
  sourceUrl: string,
  width: number,
  height: number
): Promise<void> => {
  const image = await loadImageUrl(sourceUrl);
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
};

export const drawBitmapLayerImageUrl = async (
  context: CanvasRenderingContext2D,
  layer: BitmapLayer,
  sourceUrl: string,
  width: number,
  height: number
): Promise<void> => {
  const image = await loadImageUrl(sourceUrl);
  context.save();
  try {
    context.globalAlpha = layer.opacity;
    context.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    context.drawImage(image, 0, 0, width, height);
  } finally {
    context.restore();
  }
};
