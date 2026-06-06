import { describe, expect, it } from "vitest";
import { addGeneratedShot, createProject } from "./projectOps";
import { generatedShotTransparentLayerAssets } from "./generatedShotAssets";

describe("generated shot assets", () => {
  it("returns the transparent paint layer assets that must exist after Add Shot", () => {
    const project = addGeneratedShot(createProject(), {
      imagePath: "/tmp/new_shot.tiff",
      fileName: "new_shot.tiff",
      width: 1920,
      height: 1080
    });
    const shot = project.shots[0];

    expect(generatedShotTransparentLayerAssets(shot)).toEqual([
      {
        bitmapPath: `.storyboard-workbench/layers/${shot.id}/layer-drawing.png`,
        width: 1920,
        height: 1080
      }
    ]);
  });
});
