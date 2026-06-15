import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scanWorkspaceFolder } from "./folderScanService.js";

describe("folderScanService", () => {
  it("loads an existing project without scanning image records", async () => {
    const project = { id: "project-1" };
    const progress = vi.fn();
    const readProject = vi.fn(async () => project);
    const collectImagePaths = vi.fn();
    const createImageRecords = vi.fn();
    const ensureStoryboardScriptMarkdown = vi.fn(async () => true);

    await expect(
      scanWorkspaceFolder("/storyboards/scene-a", progress, {
        collectImagePaths,
        createImageRecords,
        ensureStoryboardScriptMarkdown,
        metadataPathForFolder: (folderPath) => path.join(folderPath, "project.json"),
        previewRootForFolder: (folderPath) => path.join(folderPath, ".previews"),
        readProject
      })
    ).resolves.toEqual({
      folderPath: "/storyboards/scene-a",
      folderName: "scene-a",
      metadataPath: "/storyboards/scene-a/project.json",
      project,
      images: [],
      scriptImportNeeded: true,
      preserveProjectWithoutImageMerge: true
    });

    expect(progress).toHaveBeenCalledWith({
      kind: "open",
      label: "Loading storyboard...",
      current: 0,
      total: 0
    });
    expect(collectImagePaths).not.toHaveBeenCalled();
    expect(createImageRecords).not.toHaveBeenCalled();
    expect(ensureStoryboardScriptMarkdown).toHaveBeenCalledWith("/storyboards/scene-a", project);
    expect(readProject).toHaveBeenCalledWith("/storyboards/scene-a/project.json");
  });

  it("scans image records when no project metadata exists", async () => {
    const progress = vi.fn();
    const readProject = vi.fn(async () => undefined);
    const collectImagePaths = vi.fn(async () => ["/storyboards/scene-a/a.png", "/storyboards/scene-a/b.tiff"]);
    const images = [{ imagePath: "/storyboards/scene-a/a.png" }];
    const createImageRecords = vi.fn(async () => images);
    const ensureStoryboardScriptMarkdown = vi.fn(async () => false);

    await expect(
      scanWorkspaceFolder("/storyboards/scene-a", progress, {
        collectImagePaths,
        createImageRecords,
        ensureStoryboardScriptMarkdown,
        metadataPathForFolder: (folderPath) => path.join(folderPath, "project.json"),
        previewRootForFolder: (folderPath) => path.join(folderPath, ".previews"),
        readProject
      })
    ).resolves.toEqual({
      folderPath: "/storyboards/scene-a",
      folderName: "scene-a",
      metadataPath: "/storyboards/scene-a/project.json",
      project: undefined,
      images,
      scriptImportNeeded: false
    });

    expect(progress).toHaveBeenCalledWith({
      kind: "open",
      label: "Scanning folder...",
      current: 0,
      total: 0
    });
    expect(progress).toHaveBeenCalledWith({
      kind: "open",
      label: "Preparing previews...",
      current: 0,
      total: 2
    });
    expect(createImageRecords).toHaveBeenCalledWith(
      ["/storyboards/scene-a/a.png", "/storyboards/scene-a/b.tiff"],
      "/storyboards/scene-a/.previews",
      {
        onProgress: progress,
        label: "Preparing previews..."
      }
    );
    expect(ensureStoryboardScriptMarkdown).toHaveBeenCalledWith("/storyboards/scene-a", undefined);
  });
});
