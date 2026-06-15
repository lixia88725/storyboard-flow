import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isWorkspaceTemporaryImagePath } from "./workspaceTemporaryPaths.js";

const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff"]);

export const collectImagePaths = async (filePaths: string[]): Promise<string[]> => {
  const collected = await Promise.all(
    filePaths.map(async (filePath) => {
      const fileStat = await stat(filePath);

      if (fileStat.isDirectory()) {
        const entries = await readdir(filePath);
        return entries
          .map((entry) => path.join(filePath, entry))
          .filter((entryPath) => supportedExtensions.has(path.extname(entryPath).toLowerCase()))
          .filter((entryPath) => !isWorkspaceTemporaryImagePath(entryPath));
      }

      return supportedExtensions.has(path.extname(filePath).toLowerCase()) &&
        !isWorkspaceTemporaryImagePath(filePath)
        ? [filePath]
        : [];
    })
  );

  return [...new Set(collected.flat())].sort((a, b) => a.localeCompare(b));
};

export const metadataPathForFolder = (folderPath: string): string =>
  path.join(folderPath, ".storyboard-workbench", "storyboard.project.json");
