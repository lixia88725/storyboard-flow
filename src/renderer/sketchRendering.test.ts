import { describe, expect, it, vi } from "vitest";
import {
  aspectRatioForShot,
  drawStrokePathOnCanvas,
  fillImageDataAtPoint,
  hexToRgba,
  sampleImageDataColorAtPoint,
  shouldDrawStrokeToBitmapLayer
} from "./sketchRendering";
import type { Shot, SketchStroke } from "../shared/types";

const testImageData = (width: number, height: number, values?: number[]): ImageData =>
  ({
    width,
    height,
    data: values ? new Uint8ClampedArray(values) : new Uint8ClampedArray(width * height * 4)
  }) as ImageData;

describe("sketch rendering", () => {
  it("calculates the shot aspect ratio from SWB canvas metadata", () => {
    const shot = {
      swb: {
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    } as Shot;

    expect(aspectRatioForShot(shot)).toBeCloseTo(16 / 9);
  });

  it("falls back to the default sketch canvas aspect ratio", () => {
    expect(aspectRatioForShot({} as Shot)).toBeCloseTo(420 / 265);
  });

  it("draws a single-point stroke as a round dab", () => {
    const calls: string[] = [];
    const context = {
      save: vi.fn(() => calls.push("save")),
      restore: vi.fn(() => calls.push("restore")),
      beginPath: vi.fn(() => calls.push("beginPath")),
      arc: vi.fn(() => calls.push("arc")),
      fill: vi.fn(() => calls.push("fill")),
      moveTo: vi.fn(() => calls.push("moveTo")),
      lineTo: vi.fn(() => calls.push("lineTo")),
      stroke: vi.fn(() => calls.push("stroke")),
      set globalAlpha(_value: number) {},
      set globalCompositeOperation(_value: string) {},
      set fillStyle(_value: string) {},
      set strokeStyle(_value: string) {},
      set lineWidth(_value: number) {},
      set lineCap(_value: string) {},
      set lineJoin(_value: string) {}
    } as unknown as CanvasRenderingContext2D;
    const stroke: SketchStroke = {
      id: "dot",
      tool: "brush",
      color: "#111111",
      opacity: 1,
      size: 10,
      points: [12, 16]
    };

    drawStrokePathOnCanvas(context, stroke);

    expect(calls).toEqual(["save", "beginPath", "arc", "fill", "restore"]);
  });

  it("treats strokes without softness as hard-edge strokes", () => {
    const shadowBlurValues: number[] = [];
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      set globalAlpha(_value: number) {},
      set globalCompositeOperation(_value: string) {},
      set fillStyle(_value: string) {},
      set strokeStyle(_value: string) {},
      set lineWidth(_value: number) {},
      set lineCap(_value: string) {},
      set lineJoin(_value: string) {},
      set shadowBlur(value: number) {
        shadowBlurValues.push(value);
      },
      set shadowColor(_value: string) {}
    } as unknown as CanvasRenderingContext2D;

    drawStrokePathOnCanvas(context, {
      id: "hard",
      tool: "brush",
      color: "#111111",
      opacity: 1,
      size: 10,
      points: [0, 0, 10, 10]
    });

    expect(shadowBlurValues).toEqual([0]);
  });

  it("uses stroke softness to draw a soft brush edge", () => {
    const shadowBlurValues: number[] = [];
    const shadowColorValues: string[] = [];
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      set globalAlpha(_value: number) {},
      set globalCompositeOperation(_value: string) {},
      set fillStyle(_value: string) {},
      set strokeStyle(_value: string) {},
      set lineWidth(_value: number) {},
      set lineCap(_value: string) {},
      set lineJoin(_value: string) {},
      set shadowBlur(value: number) {
        shadowBlurValues.push(value);
      },
      set shadowColor(value: string) {
        shadowColorValues.push(value);
      }
    } as unknown as CanvasRenderingContext2D;

    drawStrokePathOnCanvas(context, {
      id: "soft",
      tool: "brush",
      color: "#ff5a2a",
      opacity: 1,
      size: 20,
      softness: 0.5,
      points: [0, 0, 10, 10]
    });

    expect(shadowBlurValues).toEqual([10]);
    expect(shadowColorValues).toEqual(["#ff5a2a"]);
  });

  it("allows committed single-point strokes to be written to bitmap layers", () => {
    expect(shouldDrawStrokeToBitmapLayer({ points: [12, 16] })).toBe(true);
    expect(shouldDrawStrokeToBitmapLayer({ points: [] })).toBe(false);
  });

  it("samples an opaque image-data pixel as a brush hex color", () => {
    const imageData = testImageData(2, 1, [
      240, 90, 40, 255,
      12, 34, 56, 255
    ]);

    expect(sampleImageDataColorAtPoint(imageData, { x: 1.2, y: 0.8 })).toBe("#0c2238");
  });

  it("does not sample transparent image-data pixels", () => {
    const imageData = testImageData(1, 1, [
      240, 90, 40, 0
    ]);

    expect(sampleImageDataColorAtPoint(imageData, { x: 0, y: 0 })).toBeUndefined();
  });

  it("fills a transparent image when the target layer is empty", () => {
    const imageData = testImageData(2, 2);

    fillImageDataAtPoint(imageData, { x: 0, y: 0 }, hexToRgba("#f05a28"));

    expect([...imageData.data]).toEqual([
      240, 90, 40, 255,
      240, 90, 40, 255,
      240, 90, 40, 255,
      240, 90, 40, 255
    ]);
  });

  it("flood-fills only the contiguous region around the drop point", () => {
    const imageData = testImageData(3, 1, [
      0, 0, 0, 0,
      0, 0, 0, 255,
      0, 0, 0, 0
    ]);

    fillImageDataAtPoint(imageData, { x: 0, y: 0 }, hexToRgba("#f05a28"));

    expect([...imageData.data]).toEqual([
      240, 90, 40, 255,
      0, 0, 0, 255,
      0, 0, 0, 0
    ]);
  });
});
