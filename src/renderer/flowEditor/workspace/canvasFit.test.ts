import { describe, expect, it } from "vitest";
import { contentBoxOf, fitCanvasBox } from "./canvasFit";

const box = (containerWidth: number, containerHeight: number, aspectRatio: number) =>
  fitCanvasBox({ containerWidth, containerHeight, aspectRatio });

describe("fitCanvasBox", () => {
  it("uses the full width when width is the binding dimension", () => {
    expect(box(800, 600, 16 / 9)).toEqual({ width: 800, height: 450 });
  });

  it("uses the full height when the area is wide and short", () => {
    expect(box(1600, 300, 16 / 9)).toEqual({ width: 533, height: 300 });
  });

  it("keeps the whole canvas inside a narrow, tall panel", () => {
    expect(box(400, 600, 16 / 9)).toEqual({ width: 400, height: 225 });
  });

  it("fits both dimensions for a square canvas", () => {
    expect(box(500, 500, 1)).toEqual({ width: 500, height: 500 });
    expect(box(900, 420, 1)).toEqual({ width: 420, height: 420 });
  });

  it("never exceeds the area and never inverts the aspect ratio", () => {
    for (const [w, h, ratio] of [[2048, 1152, 2048 / 1152], [640, 360, 640 / 360], [333, 777, 3 / 4]] as const) {
      const result = box(w, h, ratio);
      expect(result).toBeDefined();
      expect(result!.width).toBeLessThanOrEqual(w);
      expect(result!.height).toBeLessThanOrEqual(h);
      expect(Math.abs(result!.width / result!.height - ratio)).toBeLessThan(0.01);
    }
  });

  it("stays usable in a tiny panel instead of collapsing", () => {
    expect(box(10, 10, 2)).toEqual({ width: 10, height: 5 });
  });

  it("refuses unusable measurements", () => {
    expect(box(0, 600, 16 / 9)).toBeUndefined();
    expect(box(800, 0, 16 / 9)).toBeUndefined();
    expect(box(800, 600, 0)).toBeUndefined();
    expect(box(Number.NaN, 600, 16 / 9)).toBeUndefined();
    expect(box(800, 600, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("contentBoxOf", () => {
  const padding = { left: 20, top: 20, right: 20, bottom: 20 };

  it("subtracts padding from the client box", () => {
    expect(contentBoxOf({ clientWidth: 840, clientHeight: 640 }, padding)).toEqual({
      width: 800,
      height: 600
    });
  });

  it("reports nothing to fit when padding leaves no room", () => {
    expect(contentBoxOf({ clientWidth: 30, clientHeight: 640 }, padding)).toBeUndefined();
    expect(contentBoxOf(null, padding)).toBeUndefined();
  });
});
