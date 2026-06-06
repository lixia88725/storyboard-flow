import { describe, expect, it } from "vitest";
import { shotPreviewAssetPath } from "./DragPreviews";

describe("shot drag preview asset", () => {
  it("uses the existing lightweight preview before the source image", () => {
    expect(
      shotPreviewAssetPath({
        previewPath: "previews/shot-001.jpg",
        imagePath: "shots/shot-001.tif"
      })
    ).toBe("previews/shot-001.jpg");
  });

  it("falls back to the source image when no preview exists", () => {
    expect(
      shotPreviewAssetPath({
        imagePath: "shots/shot-001.tif"
      })
    ).toBe("shots/shot-001.tif");
  });
});
