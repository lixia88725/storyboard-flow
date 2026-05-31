import { describe, expect, it, vi } from "vitest";
import { cleanupDeletedShotLayerDirectories } from "./deletedShotLayers.js";

describe("cleanupDeletedShotLayerDirectories", () => {
  it("removes only layer directories for deleted shots that cleared pending state", async () => {
    const remove = vi.fn(async () => undefined);

    await cleanupDeletedShotLayerDirectories({
      folderPath: "/scene",
      previousPendingDeletedShots: [
        { id: "deleted-a", imagePath: "/scene/a.tiff", fileName: "a.tiff" },
        { id: "kept-b", imagePath: "/scene/b.tiff", fileName: "b.tiff" }
      ],
      nextPendingDeletedShots: [
        { id: "kept-b", imagePath: "/scene/b.tiff", fileName: "b.tiff" }
      ],
      remove
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("/scene/.storyboard-workbench/layers/deleted-a", {
      recursive: true,
      force: true
    });
  });

  it("does not fail Save when cache cleanup fails", async () => {
    const remove = vi.fn(async () => {
      throw new Error("permission denied");
    });

    await expect(
      cleanupDeletedShotLayerDirectories({
        folderPath: "/scene",
        previousPendingDeletedShots: [
          { id: "deleted-a", imagePath: "/scene/a.tiff", fileName: "a.tiff" }
        ],
        nextPendingDeletedShots: [],
        remove
      })
    ).resolves.toBeUndefined();
  });
});
