import { describe, expect, it, vi } from "vitest";
import { createWorkspaceAssetAppHandlers } from "./workspaceAssetAppRuntime.js";
import type { CopyShotAssetsPayload } from "./copyShotAssetsService.js";

describe("createWorkspaceAssetAppHandlers", () => {
  it("copies shot assets through the app runtime dependencies", async () => {
    const copyShotAssets = vi.fn(async (payload: CopyShotAssetsPayload, options: unknown) => ({
      ...payload,
      fileName: "copy-shot.tiff",
      imagePath: "/scene/copy-shot.tiff",
      options,
      previewPath: "/scene/.storyboard-workbench/previews/copy-shot.png"
    }));
    const uniquePath = vi.fn(async (_directory: string, fileName: string) => `/scene/${fileName}`);

    const handlers = createWorkspaceAssetAppHandlers({
      copyShotAssets,
      createId: () => "copy-id",
      uniquePath
    });
    const payload = {
      folderPath: "/scene",
      sourceImagePath: "/scene/source.tiff",
      fileName: "shot.tiff",
      layerCopies: []
    };

    await expect(handlers.copyShotAssets(payload)).resolves.toMatchObject({
      fileName: "copy-shot.tiff",
      imagePath: "/scene/copy-shot.tiff",
      previewPath: "/scene/.storyboard-workbench/previews/copy-shot.png"
    });

    expect(copyShotAssets).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        createId: expect.any(Function),
        uniquePath
      })
    );
  });
});
