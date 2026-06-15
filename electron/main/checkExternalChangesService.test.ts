import { describe, expect, it, vi } from "vitest";
import {
  checkExternalChanges,
  type CheckExternalChangesProject
} from "./checkExternalChangesService.js";

const project: CheckExternalChangesProject = {
  shots: [
    {
      imagePath: "/project/known.tiff"
    }
  ],
  parkedShots: [
    {
      imagePath: "/project/parked.tiff"
    }
  ],
  pendingDeletedShots: [
    {
      imagePath: "/project/deleted.tiff"
    }
  ]
};

describe("checkExternalChanges", () => {
  it("prepares previews only for new images and known changed images", async () => {
    const reportProgress = vi.fn();
    const collectImagePaths = vi.fn(async () => [
      "/project/known.tiff",
      "/project/parked.tiff",
      "/project/deleted.tiff",
      "/project/new.tiff"
    ]);
    const changedKnownImagePaths = vi.fn(async () => ["/project/known.tiff"]);
    const createImageRecords = vi.fn(async (imagePaths: string[]) =>
      imagePaths.map((imagePath) => ({
        imagePath,
        fileName: imagePath.split("/").at(-1) ?? imagePath
      }))
    );
    const ensureStoryboardScriptMarkdown = vi.fn(async () => true);

    const result = await checkExternalChanges(
      {
        folderPath: "/project",
        metadataPath: "/project/.storyboard-workbench/project.json",
        project
      },
      {
        changedKnownImagePaths,
        collectImagePaths,
        createImageRecords,
        ensureStoryboardScriptMarkdown,
        previewRootForFolder: () => "/project/.storyboard-workbench/previews",
        reportProgress
      }
    );

    expect(reportProgress).toHaveBeenNthCalledWith(1, {
      kind: "open",
      label: "Scanning folder...",
      current: 0,
      total: 0
    });
    expect(reportProgress).toHaveBeenNthCalledWith(2, {
      kind: "open",
      label: "Checking external changes...",
      current: 0,
      total: 4
    });
    expect(changedKnownImagePaths).toHaveBeenCalledWith(
      project,
      [
        "/project/known.tiff",
        "/project/parked.tiff",
        "/project/deleted.tiff",
        "/project/new.tiff"
      ],
      new Set(["/project/deleted.tiff"]),
      reportProgress
    );
    expect(createImageRecords).toHaveBeenCalledWith(
      ["/project/new.tiff", "/project/known.tiff"],
      "/project/.storyboard-workbench/previews",
      {
        onProgress: reportProgress,
        label: "Preparing previews..."
      }
    );
    expect(result).toEqual({
      images: [
        { imagePath: "/project/new.tiff", fileName: "new.tiff" },
        { imagePath: "/project/known.tiff", fileName: "known.tiff" }
      ],
      scriptImportNeeded: true
    });
  });
});
