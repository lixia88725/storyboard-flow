import type { BitmapLayer, Shot, SketchBlendMode, SketchStroke } from "../shared/types";
import { sketchCanvasSize, type CanvasSize } from "./sketchGeometry";

export const canvasBlendMode = (blendMode: SketchBlendMode | undefined) => {
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
  context.beginPath();

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

export const drawImageUrl = (
  context: CanvasRenderingContext2D,
  sourceUrl: string,
  width: number,
  height: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve();
    };
    image.onerror = () => reject(new Error("Could not load layer bitmap"));
    image.src = sourceUrl;
  });
