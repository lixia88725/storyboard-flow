import type { rm } from "node:fs/promises";
import type { AppliedFileReplacements } from "./fileRenames.js";
import { FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import path from "node:path";
import { assertSavePreparationDirectoryIdentity, removeSavePreparationDirectory,
  type SavePreparationDirectoryReceipt } from "./tiffPreparation.js";

export class SaveArtifactCleanupIncompleteError extends FileReplacementRecoveryIncompleteError {
  constructor(errors: unknown[], readonly retainedPaths: string[]) {
    super(errors);
    this.name = "SaveArtifactCleanupIncompleteError";
    this.message += ` Committed Save artifacts require recovery; remaining or uncertain paths: ${retainedPaths.join(", ")}`;
  }
}

type Remove = typeof rm;

export const withSuccessfulSaveArtifactCleanup = (
  applied: AppliedFileReplacements,
  options: {
    tempFolderPath: string;
    backupFolderPath: string;
    preparationDirectory: SavePreparationDirectoryReceipt;
    backupDirectory?: SavePreparationDirectoryReceipt;
    remove: Remove;
  }
): AppliedFileReplacements => ({
  commit: async () => {
    const directories = [options.preparationDirectory, ...(options.backupDirectory ? [options.backupDirectory] : [])];
    try {
      const backupRelative = path.relative(options.tempFolderPath, options.backupFolderPath);
      if (options.preparationDirectory.directoryPath !== options.tempFolderPath ||
          (options.backupDirectory ? options.backupDirectory.directoryPath !== options.backupFolderPath :
            path.isAbsolute(backupRelative) || backupRelative === ".." || backupRelative.startsWith(`..${path.sep}`))) {
        throw new Error("Save cleanup paths have no matching creation receipt");
      }
      // Authenticate before applied.commit can delete any backup file as well.
      for (const directory of directories) await assertSavePreparationDirectoryIdentity(directory);
    } catch (error) {
      throw new SaveArtifactCleanupIncompleteError([error], [options.tempFolderPath, ...(options.backupDirectory ? [options.backupFolderPath] : [])]);
    }
    await applied.commit();
    const errors: unknown[] = [], retainedPaths: string[] = [];
    // Backups may already be gone: cleanup failures must not trigger Save rollback.
    for (const directory of directories) {
      try {
        await removeSavePreparationDirectory(directory, options.remove);
      } catch (error) {
        errors.push(error); retainedPaths.push(directory.directoryPath);
      }
    }
    if (errors.length) throw new SaveArtifactCleanupIncompleteError(errors, retainedPaths);
  },
  rollback: () => applied.rollback()
});
