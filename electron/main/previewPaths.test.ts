import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewPathForImage, previewRootForFolder } from "./previewPaths.js";

describe("previewPathForImage", () => {
  it("keeps preview file names short for deeply nested image paths", () => {
    const previewRoot = "/scene/.storyboard-workbench/previews";
    const longImagePath = path.join(
      "/Users/example/Documents/Codex",
      "2026-05-30",
      "storyboard-workbench-synthetic-deeply-nested-path-3",
      "work",
      "swb-dogfood-normal-folder",
      "project",
      "03-cutaway.tiff"
    );

    const previewPath = previewPathForImage(longImagePath, previewRoot);
    const previewName = path.basename(previewPath);

    expect(previewName).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(previewName.length).toBeLessThan(100);
  });

  it("uses different preview file names for different image paths", () => {
    const previewRoot = "/scene/.storyboard-workbench/previews";

    expect(previewPathForImage("/scene/a.tiff", previewRoot)).not.toBe(
      previewPathForImage("/scene/b.tiff", previewRoot)
    );
  });

  it("resolves the preview cache root inside the SWB workspace folder", () => {
    expect(previewRootForFolder("/scene")).toBe("/scene/.storyboard-workbench/previews");
  });
});
