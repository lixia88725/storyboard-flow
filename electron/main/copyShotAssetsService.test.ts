import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  copyShotAssets,
  type CopyShotAssetsServiceOptions
} from "./copyShotAssetsService.js";
import { ProtectedLayerWriteError } from "./protectedLayerFileWriter.js";

// These adapters verify orchestration only. Physical ownership/refusal and
// partial writes are covered by workspaceCopySafety/ownedFileCreation.
const receipt = (filePath: string) => ({ filePath, identity: { dev: "1", ino: "1" } });

const createOptions = (
  overrides: Partial<CopyShotAssetsServiceOptions> = {}
): CopyShotAssetsServiceOptions => ({
  assertPathInsideFolder: vi.fn(),
  copyBitmapLayerFile: vi.fn(async (_source, target, onCreated) => { onCreated(receipt(target)); }),
  copyFile: vi.fn(async (_source, target, onCreated) => { onCreated(receipt(target)); }),
  createId: () => "copy-id",
  createPreview: vi.fn(async (_image, _root, _readOnly, onReceipt) => {
    const previewPath = "/project/.storyboard-workbench/previews/copy.png";
    onReceipt({ previewPath, effect: "reused", retainedPaths: [], rollback: async () => {}, commit: async () => {} });
    return previewPath;
  }),
  previewRootForFolder: vi.fn(() => "/project/.storyboard-workbench/previews"),
  pathEntryExists: vi.fn(async () => false),
  publishImage: vi.fn(async (_source, target, onPublished) => { const value = receipt(target); onPublished(value); return value; }),
  removeOwnedFile: vi.fn(async () => undefined),
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
      "/project/.storyboard-copy-copy-id.tiff", expect.any(Function)
    );
    expect(options.copyBitmapLayerFile).toHaveBeenCalledWith(
      "/project/.storyboard-workbench/layers/shot-a/source.png",
      "/project/.storyboard-workbench/layers/shot-b/target.png", expect.any(Function)
    );
    expect(options.publishImage).toHaveBeenCalledWith(
      receipt("/project/.storyboard-copy-copy-id.tiff"),
      "/project/copy-shot.tiff", expect.any(Function)
    );
    expect(options.createPreview).toHaveBeenCalledWith(
      "/project/copy-shot.tiff",
      "/project/.storyboard-workbench/previews", false, expect.any(Function)
    );
  });

  it("removes copied assets and temporary image paths when a copy fails", async () => {
    const copyError = new ProtectedLayerWriteError("refused", "/project/.storyboard-workbench/layers/shot-b/target-b.png", "copy failed", null);
    const options = createOptions({
      copyBitmapLayerFile: vi
        .fn()
        .mockImplementationOnce(async (_source, target, onCreated) => { onCreated(receipt(target)); })
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

    // The root target was never published, so deleting it is not authorized.
    expect(options.removeOwnedFile).not.toHaveBeenCalledWith(expect.objectContaining(receipt("/project/copy-shot.tiff")));
    expect(options.removeOwnedFile).toHaveBeenCalledWith(expect.objectContaining(receipt("/project/.storyboard-copy-copy-id.tiff")));
    expect(options.removeOwnedFile).toHaveBeenCalledWith(expect.objectContaining(receipt("/project/.storyboard-workbench/layers/shot-b/target-a.png")));
  });
});
