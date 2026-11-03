import { describe, expect, it } from "vitest";
import {
  bitmapSelectionBounds,
  bitmapSelectionCenter,
  bitmapSelectionHandleRadiusForStage,
  bitmapSelectionHitTarget,
  bitmapSelectionRotationHandlePoint,
  blendMenuDirectionFromRects,
  layerOpacityFromClientX,
  layerRowDragIntentFromDelta,
  scaleBitmapSelectionBounds,
  rotatePointAroundCenter,
  rotatedBitmapSelectionBounds,
  rotationRadiansBetweenPoints,
  layerDropPlacementFromClientY,
  liveStrokePreviewOpacity,
  latestStrokeSegment,
  strokeSegmentsFromPointOffset,
  shouldCommitStroke,
  shouldKeepCommittedStrokePreview,
  shouldUseRenderedEraserDataUrl,
  shouldRenderLiveStroke,
  shouldRestartStrokeForToolChange,
  shouldAppendStrokePoint,
  shouldHandleSketchPointer,
  shouldCloseRadialMenuForSketchPointer,
  shouldClearBitmapSelectionForTool,
  shouldStartSketchPointer,
  sketchPointsFromClientPoints,
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

  it("maps coalesced pointer coordinates to image canvas coordinates", () => {
    const rect = {
      left: 10,
      top: 20,
      width: 100,
      height: 50
    };

    expect(
      sketchPointsFromClientPoints(
        [
          { clientX: 10, clientY: 20 },
          { clientX: 60, clientY: 45 },
          { clientX: 110, clientY: 70 }
        ],
        rect,
        { width: 200, height: 100 }
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 100 }
    ]);
  });

  it("starts strokes from primary pointer input when the button is left or omitted", () => {
    expect(shouldStartSketchPointer({ button: 0, isPrimary: true })).toBe(true);
    expect(shouldStartSketchPointer({ isPrimary: true })).toBe(true);
    expect(shouldStartSketchPointer({})).toBe(true);
    expect(shouldStartSketchPointer({ button: 1, isPrimary: true })).toBe(false);
    expect(shouldStartSketchPointer({ button: 0, isPrimary: false })).toBe(false);
  });

  it("closes radial menu only for pointer input that starts a sketch interaction", () => {
    expect(shouldCloseRadialMenuForSketchPointer({ button: 0, isPrimary: true })).toBe(true);
    expect(shouldCloseRadialMenuForSketchPointer({ button: 2, isPrimary: true })).toBe(false);
    expect(shouldCloseRadialMenuForSketchPointer({ button: 0, isPrimary: false })).toBe(false);
  });

  it("continues and finishes only the active sketch pointer", () => {
    expect(shouldHandleSketchPointer({ pointerId: 7 }, 7)).toBe(true);
    expect(shouldHandleSketchPointer({ pointerId: 8 }, 7)).toBe(false);
    expect(shouldHandleSketchPointer({ pointerId: 8 }, undefined)).toBe(true);
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

  it("returns every new stroke segment after a prior point offset", () => {
    expect(strokeSegmentsFromPointOffset({ points: [10, 10, 15, 12, 20, 16, 28, 22] }, 1)).toEqual([
      [10, 10, 15, 12],
      [15, 12, 20, 16],
      [20, 16, 28, 22]
    ]);
  });

  it("commits both single-point dabs and moved strokes", () => {
    expect(shouldCommitStroke({ points: [10, 10] })).toBe(true);
    expect(shouldCommitStroke({ points: [10, 10, 20, 20] })).toBe(true);
    expect(shouldCommitStroke({ points: [] })).toBe(false);
  });

  it("does not render live eraser strokes", () => {
    expect(shouldRenderLiveStroke({ tool: "brush" })).toBe(true);
    expect(shouldRenderLiveStroke({ tool: "eraser" })).toBe(false);
  });

  it("keeps brush strokes visible while their bitmap write is pending", () => {
    expect(shouldKeepCommittedStrokePreview({ tool: "brush" })).toBe(true);
    expect(shouldKeepCommittedStrokePreview({ tool: "eraser" })).toBe(false);
  });

  it("does not use rendered eraser data while same-layer brush writes are pending", () => {
    expect(
      shouldUseRenderedEraserDataUrl({
        layerId: "layer-1",
        pendingCommittedStrokes: [{ layerId: "layer-1", stroke: { tool: "brush" } }]
      })
    ).toBe(false);
    expect(
      shouldUseRenderedEraserDataUrl({
        layerId: "layer-1",
        pendingCommittedStrokes: [{ layerId: "layer-2", stroke: { tool: "brush" } }]
      })
    ).toBe(true);
    expect(
      shouldUseRenderedEraserDataUrl({
        layerId: "layer-1",
        pendingCommittedStrokes: [{ layerId: "layer-1", stroke: { tool: "eraser" } }]
      })
    ).toBe(true);
  });

  it("matches live brush preview opacity to the active bitmap layer opacity", () => {
    expect(liveStrokePreviewOpacity({ tool: "brush", opacity: 1 }, 0.35)).toBe(0.35);
    expect(liveStrokePreviewOpacity({ tool: "brush", opacity: 0.5 }, 0.5)).toBe(0.25);
    expect(liveStrokePreviewOpacity({ tool: "brush", opacity: 1 }, undefined)).toBe(1);
    expect(liveStrokePreviewOpacity({ tool: "eraser", opacity: 0.5 }, 0.35)).toBe(0.5);
  });

  it("restarts an active stroke when the stroke tool changes mid-draw", () => {
    expect(shouldRestartStrokeForToolChange({ tool: "brush" }, "eraser")).toBe(true);
    expect(shouldRestartStrokeForToolChange({ tool: "eraser" }, "brush")).toBe(true);
    expect(shouldRestartStrokeForToolChange({ tool: "brush" }, "brush")).toBe(false);
    expect(shouldRestartStrokeForToolChange({ tool: "eraser" }, "select")).toBe(false);
    expect(shouldRestartStrokeForToolChange({ tool: "brush" }, "blur")).toBe(false);
  });

  it("keeps bitmap selections while switching from Select to Blur", () => {
    expect(shouldClearBitmapSelectionForTool("select")).toBe(false);
    expect(shouldClearBitmapSelectionForTool("blur")).toBe(false);
    expect(shouldClearBitmapSelectionForTool("brush")).toBe(true);
    expect(shouldClearBitmapSelectionForTool("eraser")).toBe(true);
    expect(shouldClearBitmapSelectionForTool("eyedropper")).toBe(true);
  });

  it("builds bitmap selection bounds from lasso points", () => {
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

  it("places and detects the selection rotation handle outside the transform box", () => {
    const bounds = { x: 20, y: 30, width: 100, height: 80 };

    expect(bitmapSelectionRotationHandlePoint(bounds, 20)).toEqual({ x: 70, y: 10 });
    expect(bitmapSelectionHitTarget({ x: 70, y: 10 }, bounds, 8, 20)).toEqual({
      type: "rotate"
    });
    expect(
      bitmapSelectionRotationHandlePoint({ x: 20, y: 5, width: 100, height: 80 }, 20)
    ).toEqual({ x: 70, y: 105 });
    expect(bitmapSelectionRotationHandlePoint({ x: 0, y: 0, width: 100, height: 100 }, 20, 100))
      .toEqual({ x: 50, y: 20 });
    expect(
      bitmapSelectionHitTarget(
        { x: 50, y: 20 },
        { x: 0, y: 0, width: 100, height: 100 },
        8,
        20,
        100
      )
    ).toEqual({ type: "rotate" });
  });

  it("rotates selection points and returns their axis-aligned committed bounds", () => {
    const bounds = { x: 20, y: 30, width: 100, height: 80 };
    const center = bitmapSelectionCenter(bounds);
    const radians = rotationRadiansBetweenPoints(
      center,
      { x: center.x + 20, y: center.y },
      { x: center.x, y: center.y + 20 }
    );

    expect(radians).toBeCloseTo(Math.PI / 2);
    expect(rotatePointAroundCenter({ x: center.x + 20, y: center.y }, center, radians)).toEqual({
      x: center.x,
      y: center.y + 20
    });
    const rotatedBounds = rotatedBitmapSelectionBounds(bounds, radians).bounds;
    expect(rotatedBounds.x).toBeCloseTo(30);
    expect(rotatedBounds.y).toBeCloseTo(20);
    expect(rotatedBounds.width).toBeCloseTo(80);
    expect(rotatedBounds.height).toBeCloseTo(100);
  });

  it("keeps bitmap selection handles easy to hit when large canvases are displayed smaller", () => {
    expect(
      bitmapSelectionHandleRadiusForStage(
        { width: 2581, height: 1080 },
        { width: 430, height: 180 },
        12
      )
    ).toBeCloseTo(72.03, 2);
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
