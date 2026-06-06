import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { storyboardScriptFileName } from "./storyboardScript.js";
import { createProjectFromStoryboardScriptMarkdown } from "./storyboardScriptProject.js";

describe("createProjectFromStoryboardScriptMarkdown", () => {
  it("creates a new project from numbered markdown entries in an empty folder", async () => {
    const sourcePath = path.join(await mkdtemp(path.join(os.tmpdir(), "swb-md-source-")), "script.md");
    const targetFolder = await mkdtemp(path.join(os.tmpdir(), "swb-md-project-"));
    await writeFile(sourcePath, "1. Opening shot\n   Camera pushes in\n2. Close up\n3. \n", "utf8");

    const scan = await createProjectFromStoryboardScriptMarkdown({
      sourceMarkdownPath: sourcePath,
      targetFolderPath: targetFolder,
      blankShotPreset: "16:9"
    });

    expect(scan.folderPath).toBe(targetFolder);
    expect(scan.project?.shots.map((shot) => shot.scriptText ?? "")).toEqual([
      "Opening shot\nCamera pushes in",
      "Close up",
      ""
    ]);
    expect(scan.project?.shots).toHaveLength(3);
    expect(scan.project?.shots.every((shot) => shot.swb?.status === "owned")).toBe(true);
    expect(scan.images).toHaveLength(3);
    await expect(readFile(path.join(targetFolder, storyboardScriptFileName), "utf8")).resolves.toBe(
      "1. Opening shot\n   Camera pushes in\n2. Close up\n3. \n"
    );
    await expect(
      readFile(path.join(targetFolder, ".storyboard-workbench", "storyboard.project.json"), "utf8")
    ).resolves.toContain("Opening shot");
  });

  it("rejects target folders that already contain files", async () => {
    const sourcePath = path.join(await mkdtemp(path.join(os.tmpdir(), "swb-md-source-")), "script.md");
    const targetFolder = await mkdtemp(path.join(os.tmpdir(), "swb-md-project-non-empty-"));
    await writeFile(sourcePath, "1. Shot\n", "utf8");
    await writeFile(path.join(targetFolder, "existing.txt"), "existing", "utf8");

    await expect(
      createProjectFromStoryboardScriptMarkdown({
        sourceMarkdownPath: sourcePath,
        targetFolderPath: targetFolder,
        blankShotPreset: "16:9"
      })
    ).rejects.toThrow("Choose an empty folder");
  });

  it("rejects target folders that already contain Storyboard Flow metadata", async () => {
    const sourcePath = path.join(await mkdtemp(path.join(os.tmpdir(), "swb-md-source-")), "script.md");
    const targetFolder = await mkdtemp(path.join(os.tmpdir(), "swb-md-project-swb-"));
    await writeFile(sourcePath, "1. Shot\n", "utf8");
    await mkdir(path.join(targetFolder, ".storyboard-workbench"), { recursive: true });

    await expect(
      createProjectFromStoryboardScriptMarkdown({
        sourceMarkdownPath: sourcePath,
        targetFolderPath: targetFolder,
        blankShotPreset: "16:9"
      })
    ).rejects.toThrow("Choose an empty folder");
  });
});
