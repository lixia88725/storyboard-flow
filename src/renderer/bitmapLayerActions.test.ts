import { describe, expect, it } from "vitest";
import type { BitmapLayer } from "../shared/types";
import { visibleLayerBelow } from "./bitmapLayerActions";

const layer = (id: string, visible = true): BitmapLayer => ({
  id,
  name: id,
  kind: "paint",
  bitmapPath: `.storyboard-workbench/layers/${id}.png`,
  visible,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  width: 100,
  height: 100
});

describe("bitmapLayerActions", () => {
  it("finds the nearest visible layer below the source layer", () => {
    expect(visibleLayerBelow([layer("bottom"), layer("hidden", false), layer("top")], "top")?.id)
      .toBe("bottom");
  });

  it("returns undefined when there is no visible layer below", () => {
    expect(visibleLayerBelow([layer("bottom", false), layer("top")], "top")).toBeUndefined();
    expect(visibleLayerBelow([layer("top")], "top")).toBeUndefined();
  });
});
