import { describe, expect, it, vi } from "vitest";
import { createWorkspaceExternalChangesAppHandlers } from "./workspaceExternalChangesAppRuntime.js";
import type { CheckExternalChangesProject } from "./checkExternalChangesService.js";

const project: CheckExternalChangesProject = {
  shots: [{ imagePath: "/project/known.tiff" }]
};

describe("createWorkspaceExternalChangesAppHandlers", () => {
  it("normal Save automatic scan never ensures missing Markdown", async () => {
    const ensure = vi.fn(async () => false), read = vi.fn(async () => true);
    const handlers = createWorkspaceExternalChangesAppHandlers({ changedKnownImagePaths: async () => [], collectImagePaths: async () => [], createImageRecords: async () => [], ensureStoryboardScriptMarkdown: ensure, readStoryboardScriptImportState: read });
    const result = await handlers.checkExternalChanges({ project, folderPath: "/project", metadataPath: "/project/p.json", normalSave: true }, { reportProgress: () => {} });
    expect(ensure).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledWith("/project", project); expect(result.scriptImportNeeded).toBe(true);
  });
  it("wires external change checks through app runtime dependencies", async () => {
    const reportProgress = vi.fn();
    const changedKnownImagePaths = vi.fn(async () => ["/project/known.tiff"]);
    const collectImagePaths = vi.fn(async () => ["/project/known.tiff", "/project/new.tiff"]);
    const createImageRecords = vi.fn(async (imagePaths: string[]) =>
      imagePaths.map((imagePath) => ({
        imagePath,
        fileName: imagePath.split("/").at(-1) ?? imagePath
      }))
    );
    const ensureStoryboardScriptMarkdown = vi.fn(async () => true);
    const previewRootForFolder = vi.fn(() => "/project/.storyboard-workbench/previews");

    const handlers = createWorkspaceExternalChangesAppHandlers({
      changedKnownImagePaths,
      collectImagePaths,
      createImageRecords,
      ensureStoryboardScriptMarkdown,
      previewRootForFolder
    });

    const result = await handlers.checkExternalChanges(
      {
        folderPath: "/project",
        metadataPath: "/project/.storyboard-workbench/project.json",
        project
      },
      { reportProgress }
    );

    expect(collectImagePaths).toHaveBeenCalledWith(["/project"]);
    expect(previewRootForFolder).toHaveBeenCalledWith("/project");
    expect(createImageRecords).toHaveBeenCalledWith(
      ["/project/new.tiff", "/project/known.tiff"],
      "/project/.storyboard-workbench/previews",
      {
        onProgress: reportProgress,
        label: "Preparing previews..."
      }
    );
    expect(ensureStoryboardScriptMarkdown).toHaveBeenCalledWith("/project", project);
    expect(result).toEqual({
      images: [
        { imagePath: "/project/new.tiff", fileName: "new.tiff" },
        { imagePath: "/project/known.tiff", fileName: "known.tiff" }
      ],
      scriptImportNeeded: true
    });
  });

  it("creates open progress reporters for the workspace task channel", () => {
    const sender = { send: vi.fn() };
    const handlers = createWorkspaceExternalChangesAppHandlers({
      changedKnownImagePaths: vi.fn(),
      createImageRecords: vi.fn(),
      ensureStoryboardScriptMarkdown: vi.fn()
    });

    handlers.createProgressReporter(sender, "open")({ current: 1, total: 2 });

    expect(sender.send).toHaveBeenCalledWith("workspace:taskProgress", {
      kind: "open",
      current: 1,
      total: 2
    });
  });
});
