import type { rm } from "node:fs/promises";
import type { AppliedFileReplacements } from "./fileRenames.js";

type Remove = typeof rm;

export const withSuccessfulSaveArtifactCleanup = (
  applied: AppliedFileReplacements,
  options: {
    tempFolderPath: string;
    backupFolderPath: string;
    remove: Remove;
  }
): AppliedFileReplacements => ({
  commit: async () => {
    await applied.commit();
    // Backups may already be gone: cleanup failures must not trigger Save rollback.
    for (const folderPath of [options.tempFolderPath, options.backupFolderPath]) {
      try {
        await options.remove(folderPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Save committed; could not clean up artifact folder: ${folderPath}`, error);
      }
    }
  },
  rollback: () => applied.rollback()
});
