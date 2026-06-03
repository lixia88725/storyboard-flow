import { describe, expect, it } from "vitest";
import { copyLayerTargetShotIdFromCandidates } from "./LayerPanel";

describe("LayerPanel copy target hit testing", () => {
  it("skips the source shot when the layer drawer is above the drop target", () => {
    expect(
      copyLayerTargetShotIdFromCandidates(
        ["source-shot", "source-shot", undefined, "target-shot"],
        "source-shot"
      )
    ).toBe("target-shot");
  });

  it("does not target the source shot when no other shot is hit", () => {
    expect(copyLayerTargetShotIdFromCandidates(["source-shot"], "source-shot")).toBeUndefined();
  });
});
