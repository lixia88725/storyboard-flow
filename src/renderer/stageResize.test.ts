import { describe, expect, it } from "vitest";
import { nextStageResizeDecision } from "./stageResize";

describe("stage resize", () => {
  it("ignores unchanged and zero-sized measurements", () => {
    expect(
      nextStageResizeDecision({
        currentSize: { width: 430, height: 271 },
        measuredSize: { width: 430.2, height: 270.8 },
        shouldDefer: false
      })
    ).toEqual({ type: "ignore" });
    expect(
      nextStageResizeDecision({
        currentSize: { width: 430, height: 271 },
        measuredSize: { width: 0, height: 271 },
        shouldDefer: false
      })
    ).toEqual({ type: "ignore" });
  });

  it("applies changed measurements when zoom is not scrubbing", () => {
    expect(
      nextStageResizeDecision({
        currentSize: { width: 430, height: 271 },
        measuredSize: { width: 645, height: 406 },
        shouldDefer: false
      })
    ).toEqual({ type: "apply", size: { width: 645, height: 406 } });
  });

  it("defers changed measurements while zoom is scrubbing", () => {
    expect(
      nextStageResizeDecision({
        currentSize: { width: 430, height: 271 },
        measuredSize: { width: 645, height: 406 },
        shouldDefer: true
      })
    ).toEqual({ type: "defer", size: { width: 645, height: 406 } });
  });
});
