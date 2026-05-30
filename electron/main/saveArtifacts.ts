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
    await options.remove(options.tempFolderPath, { recursive: true, force: true });
    await options.remove(options.backupFolderPath, { recursive: true, force: true });
  },
  rollback: () => applied.rollback()
});
