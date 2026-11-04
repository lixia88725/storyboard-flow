/**
 * Dab-based stroke rendering.
 *
 * A stroke is a polyline stamped with a tip at a fixed spacing. This replaces the
 * old "one round path with shadowBlur" renderer, which could not express grain or
 * a per-point width.
 *
 * Opacity rule (agreed with design): the dabs of one stroke accumulate inside a
 * private buffer, and that buffer is composited onto the layer exactly once at the
 * stroke's opacity. One stroke can therefore never exceed its own opacity, no matter
 * how often the path crosses itself; a second stroke can. This is Photoshop's
 * Opacity-versus-Flow split with Flow fixed at "full coverage".
 *
 * The buffer also keeps preview and commit identical: both call this function with
 * the same stroke, and neither uses randomness outside the seeded hash.
 */
import type { StrokeBrush } from "../contracts/types";
import { brushHash, renderTipMask, unitFromHash } from "./brushTips";

export type { StrokeBrush } from "../contracts/types";

export type BrushableStroke = {
  tool: "brush" | "eraser";
  color: string;
  size: number;
  opacity: number;
  points: readonly number[];
  pressures?: readonly number[];
  brush: StrokeBrush;
};

export type Dab = {
  x: number;
  y: number;
  size: number;
  /** Multiplies the tip mask before the buffer accumulates it. */
  coverage: number;
  variant: number;
  angle: number;
};

export type StrokeBounds = { x: number; y: number; width: number; height: number };

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const pressureAt = (stroke: BrushableStroke, index: number): number => {
  const value = stroke.pressures?.[index];
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : 1;
};

/** Tip variants per stroke: enough that neighbouring dabs do not repeat a grain pattern. */
export const TIP_VARIANTS = 6;

/**
 * Layout of the dabs for one stroke. Pure and deterministic so it can be tested and
 * so preview/commit agree without sharing mutable state.
 */
export const dabsForStroke = (stroke: BrushableStroke): Dab[] => {
  const points = stroke.points;
  if (points.length < 2) return [];

  const baseSize = Math.max(0.5, stroke.size);
  const step = Math.max(0.35, baseSize * clamp(stroke.brush.spacing, 0.01, 1));
  const dabs: Dab[] = [];
  const push = (x: number, y: number, pressure: number, index: number) => {
    const hash = brushHash(stroke.brush.seed, index, 11);
    const sizeJitter = 1 + (unitFromHash(brushHash(stroke.brush.seed, index, 23)) - 0.5) * 0.06;
    dabs.push({
      x,
      y,
      size: Math.max(0.5, baseSize * (1 - stroke.brush.pressureSize * (1 - pressure)) * sizeJitter),
      coverage: 1 - stroke.brush.pressureOpacity * (1 - pressure),
      variant: hash % TIP_VARIANTS,
      angle: unitFromHash(brushHash(stroke.brush.seed, index, 37)) * Math.PI * 2,
    });
  };

  let travelled = 0;
  let dabIndex = 0;
  push(points[0], points[1], pressureAt(stroke, 0), dabIndex++);

  for (let index = 2; index < points.length; index += 2) {
    const fromX = points[index - 2], fromY = points[index - 1];
    const toX = points[index], toY = points[index + 1];
    const segment = Math.hypot(toX - fromX, toY - fromY);
    const fromPressure = pressureAt(stroke, (index - 2) / 2);
    const toPressure = pressureAt(stroke, index / 2);
    if (segment <= 0) continue;

    // Interpolating along the segment is what keeps fast strokes continuous; it is
    // not smoothing — the path itself is never altered.
    let distance = step - travelled;
    while (distance <= segment) {
      const t = distance / segment;
      push(
        fromX + (toX - fromX) * t,
        fromY + (toY - fromY) * t,
        fromPressure + (toPressure - fromPressure) * t,
        dabIndex++
      );
      distance += step;
    }
    travelled = segment - (distance - step);
  }

  return dabs;
};

const tipCache = new Map<string, HTMLCanvasElement>();
const TIP_CACHE_LIMIT = 48;

const tipCanvas = (kind: StrokeBrush["tip"], diameter: number, hardness: number, grain: number, variant: number, color: string): HTMLCanvasElement => {
  const bucket = Math.max(2, Math.round(diameter));
  const key = `${kind}|${bucket}|${hardness.toFixed(2)}|${grain.toFixed(2)}|${variant}|${color}`;
  const cached = tipCache.get(key);
  if (cached) return cached;

  const mask = renderTipMask({ tip: kind, diameter: bucket, hardness, grain, variant });
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const context = canvas.getContext("2d");
  if (context) {
    // Paint the colour first and keep the mask as alpha, so stamping is a plain drawImage.
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = context.createImageData(mask.width, mask.height);
    for (let pixel = 0; pixel < mask.alpha.length; pixel++) {
      image.data[pixel * 4 + 3] = mask.alpha[pixel];
    }
    context.putImageData(image, 0, 0);
  }

  if (tipCache.size >= TIP_CACHE_LIMIT) tipCache.clear();
  tipCache.set(key, canvas);
  return canvas;
};

/** Bounds of everything the dabs can touch, clamped to the destination canvas. */
export const dabBounds = (dabs: readonly Dab[], width: number, height: number): StrokeBounds | undefined => {
  if (dabs.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const dab of dabs) {
    const half = dab.size / 2 + 1;
    if (dab.x - half < minX) minX = dab.x - half;
    if (dab.y - half < minY) minY = dab.y - half;
    if (dab.x + half > maxX) maxX = dab.x + half;
    if (dab.y + half > maxY) maxY = dab.y + half;
  }
  const x0 = clamp(Math.floor(minX), 0, width);
  const y0 = clamp(Math.floor(minY), 0, height);
  const x1 = clamp(Math.ceil(maxX), 0, width);
  const y1 = clamp(Math.ceil(maxY), 0, height);
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

/**
 * Renders the stroke into a private buffer and composites it once.
 * Returns the touched rectangle so callers can restore just that area if needed.
 */
export const paintBrushStroke = (
  context: CanvasRenderingContext2D,
  stroke: BrushableStroke,
  options: { restore?: () => void } = {}
): StrokeBounds | undefined => {
  const dabs = dabsForStroke(stroke);
  if (dabs.length === 0) return undefined;
  const width = context.canvas.width, height = context.canvas.height;
  const bounds = dabBounds(dabs, width, height);
  if (!bounds) return undefined;

  const buffer = document.createElement("canvas");
  buffer.width = bounds.width;
  buffer.height = bounds.height;
  const bufferContext = buffer.getContext("2d");
  if (!bufferContext) return undefined;

  for (const dab of dabs) {
    const tip = tipCanvas(stroke.brush.tip, dab.size, stroke.brush.hardness, stroke.brush.grain, dab.variant, stroke.color);
    bufferContext.save();
    bufferContext.globalAlpha = clamp(dab.coverage, 0, 1);
    bufferContext.translate(dab.x - bounds.x, dab.y - bounds.y);
    // Grain tips rotate so repeated dabs do not line up into a visible grid.
    if (stroke.brush.tip === "pencil" || stroke.brush.tip === "charcoal") bufferContext.rotate(dab.angle);
    bufferContext.drawImage(tip, -dab.size / 2, -dab.size / 2, dab.size, dab.size);
    bufferContext.restore();
  }

  if (options.restore) options.restore();
  context.save();
  context.globalAlpha = clamp(stroke.opacity, 0, 1);
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.drawImage(buffer, bounds.x, bounds.y);
  context.restore();
  return bounds;
};

/** True when the stroke carries enough information to render with tips. */
export const hasBrushStroke = (stroke: object): boolean =>
  Object.hasOwn(stroke, "brush") && (stroke as { brush?: unknown }).brush !== undefined;
