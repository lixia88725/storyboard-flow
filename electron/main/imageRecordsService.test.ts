import { describe, expect, it, vi } from "vitest";
import { createImageRecords } from "./imageRecordsService.js";

describe("imageRecordsService", () => {
  it("creates imported image records while only TIFF files get previews and SWB metadata", async () => {
    const createPreview = vi.fn(async (imagePath: string, previewRoot: string) =>
      `${previewRoot}/${imagePath.split("/").at(-1)}.png`
    );
    const readImageMetadata = vi.fn(async (imagePath: string) => ({
      width: imagePath.endsWith(".png") ? 640 : 1920,
      height: imagePath.endsWith(".png") ? 480 : 1080
    }));
    const pixelFingerprint = vi.fn(async (imagePath: string) => `hash:${imagePath}`);
    const readSwbMetadata = vi.fn(async (imagePath: string) => ({
      shotId: imagePath.endsWith(".tiff") ? "shot-tiff" : "shot-tif"
    }));
    const onProgress = vi.fn();

    await expect(
      createImageRecords(
        ["/project/flat.png", "/project/owned.tiff", "/project/legacy.tif"],
        "/project/.storyboard-workbench/previews",
        {
          createPreview,
          onProgress,
          pixelFingerprint,
          readImageMetadata,
          readSwbMetadata,
          label: "Preparing previews...",
          concurrency: 1
        }
      )
    ).resolves.toEqual([
      {
        imagePath: "/project/flat.png",
        previewPath: undefined,
        fileName: "flat.png",
        width: 640,
        height: 480,
        fingerprint: "hash:/project/flat.png",
        swbMetadata: undefined
      },
      {
        imagePath: "/project/owned.tiff",
        previewPath: "/project/.storyboard-workbench/previews/owned.tiff.png",
        fileName: "owned.tiff",
        width: 1920,
        height: 1080,
        fingerprint: "hash:/project/owned.tiff",
        swbMetadata: {
          shotId: "shot-tiff"
        }
      },
      {
        imagePath: "/project/legacy.tif",
        previewPath: "/project/.storyboard-workbench/previews/legacy.tif.png",
        fileName: "legacy.tif",
        width: 1920,
        height: 1080,
        fingerprint: "hash:/project/legacy.tif",
        swbMetadata: {
          shotId: "shot-tif"
        }
      }
    ]);

    expect(createPreview).toHaveBeenCalledTimes(2);
    expect(readSwbMetadata).toHaveBeenCalledTimes(2);
    expect(readImageMetadata).toHaveBeenCalledTimes(3);
    expect(pixelFingerprint).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({
      kind: "open",
      label: "Preparing previews...",
      current: 3,
      total: 3
    });
  });
});
