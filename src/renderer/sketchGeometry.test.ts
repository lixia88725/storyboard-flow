import { describe, expect, it } from "vitest";
import {
  bitmapSelectionBounds,
  bitmapSelectionHitTarget,
  blendMenuDirectionFromRects,
  layerOpacityFromClientX,
  layerRowDragIntentFromDelta,
  scaleBitmapSelectionBounds,
  layerDropPlacementFromClientY,
  latestStrokeSegment,
  shouldRenderLiveStroke,
  shouldAppendStrokePoint,
  sketchPointFromClientPoint
} from "./sketchGeometry";

describe("sketch geometry", () => {
  it("maps scaled canvas pointer coordinates back to sketch coordinates", () => {
    const rect = {
      left: 100,
      top: 50,
      width: 840,
      height: 530
    };

    expect(sketchPointFromClientPoint(520, 315, rect)).toEqual({ x: 210, y: 132.5 });
  });

  it("maps 16:9 pointer coordinates to image canvas coordinates", () => {
    const rect = {
      left: 0,
      top: 0,
      width: 960,
      height: 540
    };

    expect(sketchPointFromClientPoint(480, 270, rect, { width: 1920, height: 1080 })).toEqual({
      x: 960,
      y: 540
    });
  });

  it("maps 2.39:1 pointer coordinates to image canvas coordinates", () => {
    const rect = {
      left: 0,
      top: 0,
      width: 516.2,
      height: 216
    };

    expect(sketchPointFromClientPoint(258.1, 108, rect, { width: 2581, height: 1080 })).toEqual({
      x: 1290.5,
      y: 540
    });
  });

  it("maps 1.43:1 pointer coordinates to image canvas coordinates", () => {
    const rect = {
      left: 0,
      top: 0,
      width: 308.8,
      height: 216
    };

    expect(sketchPointFromClientPoint(154.4, 108, rect, { width: 1544, height: 1080 })).toEqual({
      x: 772,
      y: 540
    });
  });

  it("skips dense stroke points until the pointer moves far enough", () => {
    const stroke = {
      id: "stroke-1",
      tool: "eraser" as const,
      color: "#ffffff",
      opacity: 1,
      size: 30,
      points: [10, 10, 12, 11]
    };

    expect(shouldAppendStrokePoint(stroke, { x: 13, y: 12 }, 4)).toBe(false);
    expect(shouldAppendStrokePoint(stroke, { x: 20, y: 12 }, 4)).toBe(true);
  });

  it("maps layer row drops to internal bottom-to-top placement", () => {
    expect(layerDropPlacementFromClientY(110, 100, 40)).toBe("after");
    expect(layerDropPlacementFromClientY(130, 100, 40)).toBe("before");
  });

  it("locks layer row drags to opacity or reorder after threshold", () => {
    expect(layerRowDragIntentFromDelta(4, 5)).toBeUndefined();
    expect(layerRowDragIntentFromDelta(10, 4)).toBe("opacity");
    expect(layerRowDragIntentFromDelta(-10, 4)).toBe("opacity");
    expect(layerRowDragIntentFromDelta(6, 12)).toBe("reorder");
    expect(layerRowDragIntentFromDelta(8, 8)).toBe("reorder");
  });

  it("maps horizontal layer row pointer position to clamped opacity", () => {
    expect(layerOpacityFromClientX(100, 100, 200)).toBe(0);
    expect(layerOpacityFromClientX(170, 100, 200)).toBe(0.35);
    expect(layerOpacityFromClientX(300, 100, 200)).toBe(1);
    expect(layerOpacityFromClientX(80, 100, 200)).toBe(0);
    expect(layerOpacityFromClientX(340, 100, 200)).toBe(1);
  });

  it("opens lower layer blend menus upward when there is not enough room below", () => {
    expect(blendMenuDirectionFromRects(40, 90, 20, 360)).toBe("down");
    expect(blendMenuDirectionFromRects(280, 330, 20, 360)).toBe("up");
    expect(blendMenuDirectionFromRects(260, 310, 250, 360)).toBe("down");
  });

  it("returns only the latest stroke segment for incremental bitmap preview", () => {
    expect(latestStrokeSegment({ points: [10, 10, 15, 12, 20, 16] })).toEqual([
      15, 12, 20, 16
    ]);
    expect(latestStrokeSegment({ points: [10, 10] })).toBeUndefined();
  });

  it("does not render live eraser strokes", () => {
    expect(shouldRenderLiveStroke({ tool: "brush" })).toBe(true);
    expect(shouldRenderLiveStroke({ tool: "eraser" })).toBe(false);
  });

  it("builds bitmap selection bounds from rectangle and lasso points", () => {
    expect(
      bitmapSelectionBounds([
        { x: 40, y: 25 },
        { x: 10, y: 70 }
      ])
    ).toEqual({ x: 10, y: 25, width: 30, height: 45 });

    expect(
      bitmapSelectionBounds([
        { x: 20, y: 10 },
        { x: 80, y: 30 },
        { x: 50, y: 90 }
      ])
    ).toEqual({ x: 20, y: 10, width: 60, height: 80 });
  });

  it("detects bitmap selection handles, inside, and outside hits", () => {
    const bounds = { x: 20, y: 30, width: 100, height: 80 };

    expect(bitmapSelectionHitTarget({ x: 20, y: 30 }, bounds, 8)).toEqual({
      type: "scale",
      corner: "nw"
    });
    expect(bitmapSelectionHitTarget({ x: 120, y: 110 }, bounds, 8)).toEqual({
      type: "scale",
      corner: "se"
    });
    expect(bitmapSelectionHitTarget({ x: 60, y: 60 }, bounds, 8)).toEqual({ type: "move" });
    expect(bitmapSelectionHitTarget({ x: 10, y: 60 }, bounds, 8)).toEqual({ type: "none" });
  });

  it("scales bitmap selection bounds from a corner while preserving the opposite corner", () => {
    const bounds = { x: 20, y: 30, width: 100, height: 80 };

    expect(scaleBitmapSelectionBounds(bounds, "se", { x: 150, y: 140 })).toEqual({
      x: 20,
      y: 30,
      width: 130,
      height: 110
    });
    expect(scaleBitmapSelectionBounds(bounds, "nw", { x: 50, y: 60 })).toEqual({
      x: 50,
      y: 60,
      width: 70,
      height: 50
    });
  });
});
