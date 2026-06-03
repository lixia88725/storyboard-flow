import { describe, expect, it, vi } from "vitest";
import { drawStrokePathOnCanvas, shouldDrawStrokeToBitmapLayer } from "./sketchRendering";
import type { SketchStroke } from "../shared/types";

describe("sketch rendering", () => {
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

  it("allows committed single-point strokes to be written to bitmap layers", () => {
    expect(shouldDrawStrokeToBitmapLayer({ points: [12, 16] })).toBe(true);
    expect(shouldDrawStrokeToBitmapLayer({ points: [] })).toBe(false);
  });
});
