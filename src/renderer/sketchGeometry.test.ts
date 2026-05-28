import { describe, expect, it } from "vitest";
import { sketchPointFromClientPoint } from "./sketchGeometry";

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
});
