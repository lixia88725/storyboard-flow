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
});
