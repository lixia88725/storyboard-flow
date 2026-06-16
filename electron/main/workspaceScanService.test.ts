import { describe, expect, it, vi } from "vitest";
import { createProject } from "../../src/shared/projectOps.js";
import { scanFolderForApp } from "./workspaceScanService.js";

describe("scanFolderForApp", () => {
  it("scans a workspace folder through injected app dependencies", async () => {
    const project = createProject("Loaded Storyboard");
    const onProgress = vi.fn();
    const collectImagePaths = vi.fn(async () => ["/project/shot_a.tiff"]);
    const createImageRecords = vi.fn(async () => [
      {
        imagePath: "/project/shot_a.tiff",
        fileName: "shot_a.tiff",
        previewPath: "/project/.preview/shot_a.png"
      }
    ]);
    const ensureStoryboardScriptMarkdown = vi.fn(async () => false);
    const metadataPathForFolder = vi.fn(() => "/project/metadata.json");
    const previewRootForFolder = vi.fn(() => "/project/previews");
    const readProject = vi.fn(async () => undefined);

    const result = await scanFolderForApp("/project", onProgress, {
      collectImagePaths,
      createImageRecords,
      ensureStoryboardScriptMarkdown,
      metadataPathForFolder,
      previewRootForFolder,
      readProject
    });

    expect(result).toEqual({
      folderPath: "/project",
      folderName: "project",
      metadataPath: "/project/metadata.json",
      project: undefined,
      images: [
        {
          imagePath: "/project/shot_a.tiff",
          fileName: "shot_a.tiff",
          previewPath: "/project/.preview/shot_a.png"
        }
      ],
      scriptImportNeeded: false
    });
    expect(collectImagePaths).toHaveBeenCalledWith(["/project"]);
    expect(createImageRecords).toHaveBeenCalledWith(
      ["/project/shot_a.tiff"],
      "/project/previews",
      {
        onProgress,
        label: "Preparing previews..."
      }
    );
    expect(ensureStoryboardScriptMarkdown).toHaveBeenCalledWith("/project", undefined);
    expect(readProject).toHaveBeenCalledWith("/project/metadata.json");

    readProject.mockResolvedValueOnce(project);
    await expect(
      scanFolderForApp("/project", onProgress, {
        collectImagePaths,
        createImageRecords,
        ensureStoryboardScriptMarkdown,
        metadataPathForFolder,
        previewRootForFolder,
        readProject
      })
    ).resolves.toMatchObject({
      project,
      images: [],
      preserveProjectWithoutImageMerge: true
    });
  });
});
