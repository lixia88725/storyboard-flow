import type { BitmapLayer, SketchStroke } from "../shared/types";
import {
  drawImageUrl,
  drawStrokePathOnCanvas,
  fillImageDataAtPoint,
  hexToRgba,
  shouldDrawStrokeToBitmapLayer
} from "./sketchRendering";

export const createTransparentLayerDataUrl = async (
  width: number,
  height: number
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas.toDataURL("image/png");
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
