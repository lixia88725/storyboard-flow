import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  copyShotAssets,
  type CopyShotAssetsServiceOptions
} from "./copyShotAssetsService.js";

const createOptions = (
  overrides: Partial<CopyShotAssetsServiceOptions> = {}
): CopyShotAssetsServiceOptions => ({
  assertPathInsideFolder: vi.fn(),
  copyBitmapLayerFile: vi.fn(async () => undefined),
  copyFile: vi.fn(async () => undefined),
  createId: () => "copy-id",
  createPreview: vi.fn(async () => "/project/.storyboard-workbench/previews/copy.png"),
  previewRootForFolder: vi.fn(() => "/project/.storyboard-workbench/previews"),
  rename: vi.fn(async () => undefined),
  resolveLayerAssetPath: (_folderPath, bitmapPath) => path.join("/project", bitmapPath),
  unlink: vi.fn(async () => undefined),
  uniquePath: vi
    .fn()
    .mockResolvedValueOnce("/project/copy-shot.tiff")
    .mockResolvedValueOnce("/project/.storyboard-copy-copy-id.tiff"),
  workspaceCopyTemporaryFileName: (fileName, id) => `.storyboard-copy-${id}${path.extname(fileName)}`,
  ...overrides
});

describe("copyShotAssets", () => {
  it("copies the root image and layer assets through a temporary image path", async () => {
    const options = createOptions();

    await expect(
      copyShotAssets(
        {
          folderPath: "/project",
          sourceImagePath: "/project/source.tiff",
          fileName: "shot.tiff",
          layerCopies: [
            {
              sourceBitmapPath: ".storyboard-workbench/layers/shot-a/source.png",
              targetBitmapPath: ".storyboard-workbench/layers/shot-b/target.png"
            }
          ]
        },
        options
      )
    ).resolves.toEqual({
      folderPath: "/project",
      sourceImagePath: "/project/source.tiff",
      fileName: "copy-shot.tiff",
      layerCopies: [
        {
          sourceBitmapPath: ".storyboard-workbench/layers/shot-a/source.png",
          targetBitmapPath: ".storyboard-workbench/layers/shot-b/target.png"
        }
      ],
      imagePath: "/project/copy-shot.tiff",
      previewPath: "/project/.storyboard-workbench/previews/copy.png"
    });

    expect(options.copyFile).toHaveBeenCalledWith(
      "/project/source.tiff",
      "/project/.storyboard-copy-copy-id.tiff"
    );
    expect(options.copyBitmapLayerFile).toHaveBeenCalledWith(
      "/project/.storyboard-workbench/layers/shot-a/source.png",
      "/project/.storyboard-workbench/layers/shot-b/target.png"
    );
    expect(options.rename).toHaveBeenCalledWith(
      "/project/.storyboard-copy-copy-id.tiff",
      "/project/copy-shot.tiff"
    );
    expect(options.createPreview).toHaveBeenCalledWith(
      "/project/copy-shot.tiff",
      "/project/.storyboard-workbench/previews"
    );
  });

  it("removes copied assets and temporary image paths when a copy fails", async () => {
    const copyError = new Error("copy failed");
    const options = createOptions({
      copyBitmapLayerFile: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(copyError)
    });

    await expect(
      copyShotAssets(
        {
          folderPath: "/project",
          sourceImagePath: "/project/source.tiff",
          fileName: "shot.tiff",
          layerCopies: [
            {
              sourceBitmapPath: ".storyboard-workbench/layers/shot-a/source.png",
              targetBitmapPath: ".storyboard-workbench/layers/shot-b/target-a.png"
            },
            {
              sourceBitmapPath: ".storyboard-workbench/layers/shot-a/source.png",
              targetBitmapPath: ".storyboard-workbench/layers/shot-b/target-b.png"
            }
          ]
        },
        options
      )
    ).rejects.toThrow(copyError);

    expect(options.unlink).toHaveBeenCalledWith("/project/copy-shot.tiff");
    expect(options.unlink).toHaveBeenCalledWith("/project/.storyboard-copy-copy-id.tiff");
    expect(options.unlink).toHaveBeenCalledWith(
      "/project/.storyboard-workbench/layers/shot-b/target-a.png"
    );
  });
});
