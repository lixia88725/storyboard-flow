import { describe, expect, it } from "vitest";
import { buildLayerAssetUrl } from "./layerAssetUrl";

describe("buildLayerAssetUrl", () => {
  it("encodes project and bitmap paths and appends a revision cache key", () => {
    const url = new URL(
      buildLayerAssetUrl({
        folderPath: "/tmp/Storyboard Flow",
        bitmapPath: ".storyboard-workbench/layers/shot 1/layer-image.png",
        revision: 9
      })
    );

    expect(url.hostname).toBe("layer");
    expect(url.searchParams.get("folderPath")).toBe("/tmp/Storyboard Flow");
    expect(url.searchParams.get("bitmapPath")).toBe(
      ".storyboard-workbench/layers/shot 1/layer-image.png"
    );
    expect(url.searchParams.get("revision")).toBe("9");
  });

  it("omits the cache key when no revision is supplied", () => {
    expect(
      new URL(
        buildLayerAssetUrl({
          folderPath: "/tmp/scene",
          bitmapPath: ".storyboard-workbench/layers/shot/layer.png"
        })
      ).searchParams.has("revision")
    ).toBe(false);
  });
});
