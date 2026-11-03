import { describe, expect, it } from "vitest";
import { measureStoryboardGridColumnsFromTops } from "./storyboardGridMeasurement";

describe("storyboardGridMeasurement", () => {
  it("uses one column when no shot positions are available", () => {
    expect(measureStoryboardGridColumnsFromTops([])).toBe(1);
  });

  it("counts only shots on the first visual row with a small top tolerance", () => {
    expect(measureStoryboardGridColumnsFromTops([100.2, 102.6, 104.1, 164.8, 166.1])).toBe(3);
  });

  it("handles unsorted shot top positions", () => {
    expect(measureStoryboardGridColumnsFromTops([220, 101, 103, 221, 100])).toBe(3);
  });
});
