import { describe, expect, it, vi } from "vitest";
import { createImageAppHandlers } from "./imageAppRuntime.js";

describe("createImageAppHandlers", () => {
  it("creates a blank shot and returns its imported image record", async () => {
    const createBlankShot = vi.fn(async () => "/project/new_shot.tiff");
    const createImageRecords = vi.fn(async () => [
      {
        imagePath: "/project/new_shot.tiff",
        fileName: "new_shot.tiff",
        previewPath: "/project/.storyboard-workbench/previews/new_shot.png"
      }
    ]);
    const previewRootForFolder = vi.fn(() => "/project/.storyboard-workbench/previews");

    const handlers = createImageAppHandlers({
      createBlankShot,
      createImageRecords,
      previewRootForFolder
    });

    await expect(
      handlers.createBlankShot("/project", { preset: "2.39:1" })
    ).resolves.toEqual({
      imagePath: "/project/new_shot.tiff",
      fileName: "new_shot.tiff",
      previewPath: "/project/.storyboard-workbench/previews/new_shot.png"
    });
    expect(createBlankShot).toHaveBeenCalledWith("/project", "2.39:1");
    expect(previewRootForFolder).toHaveBeenCalledWith("/project");
    expect(createImageRecords).toHaveBeenCalledWith(
      ["/project/new_shot.tiff"],
      "/project/.storyboard-workbench/previews"
    );
  });

  it("defaults to the 16:9 blank shot preset", async () => {
    const createBlankShot = vi.fn(async () => "/project/new_shot.tiff");
    const createImageRecords = vi.fn(async () => [
      {
        imagePath: "/project/new_shot.tiff",
        fileName: "new_shot.tiff"
      }
    ]);

    const handlers = createImageAppHandlers({
      createBlankShot,
      createImageRecords,
      previewRootForFolder: () => "/project/previews"
    });

    await handlers.createBlankShot("/project");

    expect(createBlankShot).toHaveBeenCalledWith("/project", "16:9");
  });
});
