import type { BitmapLayer, SketchStroke } from "../shared/types";
import {
  drawImageUrl,
  drawStrokePathOnCanvas,
  fillImageDataAtPoint,
  hexToRgba,
  shouldDrawStrokeToBitmapLayer
} from "./sketchRendering";

export type BitmapBlurPoint = {
  x: number;
  y: number;
};

export const normalizeGaussianBlurRadius = (radius: number): number =>
  Number.isFinite(radius) ? Math.min(50, Math.max(0, Math.round(radius))) : 0;

export const hasBitmapBlurSelection = (
  selectionPoints: readonly BitmapBlurPoint[] | undefined
): selectionPoints is readonly BitmapBlurPoint[] =>
  Boolean(selectionPoints && selectionPoints.length >= 3);

export const createTransparentLayerDataUrl = async (
  width: number,
  height: number
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas.toDataURL("image/png");
};

export const expandBitmapLayerForMatte = async (
  sourceUrl: string,
  layer: BitmapLayer,
  top: number,
  bottom: number
): Promise<string> => {
  const normalizedTop = Math.max(0, Math.round(top));
  const normalizedBottom = Math.max(0, Math.round(bottom));
  const sourceWidth = Math.max(1, Math.round(layer.width));
  const sourceHeight = Math.max(1, Math.round(layer.height));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight + normalizedTop + normalizedBottom;
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  await drawImageUrl(context, sourceUrl, sourceWidth, sourceHeight, 0, normalizedTop);
  return canvas.toDataURL("image/png");
};

export const collapseBitmapLayerFromMatte = async (
  sourceUrl: string,
  layer: BitmapLayer,
  top: number,
  bottom: number,
  targetHeight?: number
): Promise<string> => {
  const normalizedTop = Math.max(0, Math.round(top));
  const normalizedBottom = Math.max(0, Math.round(bottom));
  const sourceWidth = Math.max(1, Math.round(layer.width));
  const sourceHeight = Math.max(1, Math.round(layer.height));
  const collapsedHeight = Math.max(
    1,
    Math.round(targetHeight ?? sourceHeight - normalizedTop - normalizedBottom)
  );
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = collapsedHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load bitmap layer"));
    image.src = sourceUrl;
  });
  context.drawImage(
    image,
    0,
    normalizedTop,
    sourceWidth,
    collapsedHeight,
    0,
    0,
    sourceWidth,
    collapsedHeight
  );
  return canvas.toDataURL("image/png");
};

export const createMatteOverlayDataUrl = (
  width: number,
  height: number,
  topMatteHeight: number,
  bottomMatteHeight: number
): string => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  const top = Math.max(0, Math.min(canvas.height, Math.round(topMatteHeight)));
  const bottom = Math.max(0, Math.min(canvas.height - top, Math.round(bottomMatteHeight)));
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, top);
  context.fillRect(0, canvas.height - bottom, canvas.width, bottom);
  return canvas.toDataURL("image/png");
};

export const dialogueOverlayText = (
  context: { measureText: (text: string) => { width: number } },
  text: string,
  maxWidth: number
): string => {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized || context.measureText(normalized).width <= maxWidth) {
    return normalized;
  }

  const ellipsis = "…";
  let lower = 0;
  let upper = normalized.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = `${normalized.slice(0, middle).trimEnd()}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }

  return `${normalized.slice(0, lower).trimEnd()}${ellipsis}`;
};

export const createDialogueOverlayDataUrl = (
  width: number,
  height: number,
  bottomMatteHeight: number,
  text: string
): string => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  const bottom = Math.max(1, Math.round(bottomMatteHeight));
  const horizontalInset = Math.max(18, Math.round(canvas.width * 0.02));
  const fontSize = Math.max(18, Math.min(36, Math.floor(bottom * 0.48)));
  context.font = `600 ${fontSize}px sans-serif`;
  context.fillStyle = "#ffffff";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0, 0, 0, 0.75)";
  context.shadowBlur = 3;
  context.fillText(
    dialogueOverlayText(context, text, canvas.width - horizontalInset * 2),
    horizontalInset,
    canvas.height - bottom / 2,
    canvas.width - horizontalInset * 2
  );
  return canvas.toDataURL("image/png");
};

export const gaussianBlurBitmapLayer = async (
  sourceUrl: string,
  layer: BitmapLayer,
  radius: number,
  selectionPoints?: readonly BitmapBlurPoint[]
): Promise<string> => {
  const normalizedRadius = normalizeGaussianBlurRadius(radius);
  if (normalizedRadius === 0) {
    return sourceUrl;
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = Math.max(1, Math.round(layer.width));
  sourceCanvas.height = Math.max(1, Math.round(layer.height));
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return sourceUrl;
  }

  await drawImageUrl(
    sourceContext,
    sourceUrl,
    sourceCanvas.width,
    sourceCanvas.height
  );

  const blurredCanvas = document.createElement("canvas");
  blurredCanvas.width = sourceCanvas.width;
  blurredCanvas.height = sourceCanvas.height;
  const blurredContext = blurredCanvas.getContext("2d");
  if (!blurredContext) {
    return sourceUrl;
  }

  blurredContext.filter = `blur(${normalizedRadius}px)`;
  blurredContext.drawImage(sourceCanvas, 0, 0);

  if (!hasBitmapBlurSelection(selectionPoints)) {
    return blurredCanvas.toDataURL("image/png");
  }

  sourceContext.save();
  try {
    sourceContext.beginPath();
    selectionPoints.forEach((point, index) => {
      if (index === 0) {
        sourceContext.moveTo(point.x, point.y);
      } else {
        sourceContext.lineTo(point.x, point.y);
      }
    });
    sourceContext.closePath();
    sourceContext.clip();
    sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceContext.drawImage(blurredCanvas, 0, 0);
  } finally {
    sourceContext.restore();
  }
  return sourceCanvas.toDataURL("image/png");
};

export const drawStrokeOnBitmapLayer = async (
  sourceUrl: string,
  layer: BitmapLayer,
  stroke: SketchStroke,
  pendingStrokes: SketchStroke[] = []
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  await drawImageUrl(context, sourceUrl, canvas.width, canvas.height);

  for (const pendingStroke of [...pendingStrokes, stroke]) {
    if (shouldDrawStrokeToBitmapLayer(pendingStroke)) {
      drawStrokePathOnCanvas(context, pendingStroke);
    }
  }

  return canvas.toDataURL("image/png");
};

export const fillBitmapLayerAtPoint = async (
  sourceUrl: string,
  layer: BitmapLayer,
  point: { x: number; y: number },
  color: string
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  await drawImageUrl(context, sourceUrl, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  fillImageDataAtPoint(imageData, point, hexToRgba(color));
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};
