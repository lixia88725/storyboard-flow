import path from "node:path";
import { randomUUID } from "node:crypto";

export type RenamePlanItem = {
  shotId: string;
  fromPath: string;
  temporaryPath: string;
  finalPath: string;
  finalFileName: string;
};

export type FileMoveOps = {
  mkdir: (directoryPath: string) => Promise<void>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
};

export type TempReplaceOps = {
  mkdir?: (directoryPath: string) => Promise<void>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
};

export type AtomicTextWriteOps = {
  mkdir: (directoryPath: string) => Promise<void>;
  writeFile: (filePath: string, content: string, encoding: "utf8") => Promise<void>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
  tempPath?: string;
};

export type FileMoveItem = {
  fromPath: string;
  toPath: string;
};

type AppliedRename = {
  item: RenamePlanItem;
  stage: "temporary" | "final";
};

export type AppliedFileRenamePlan = {
  rollback: () => Promise<void>;
};

// A failed apply returns no rollback handle; callers still need to know that
// paths remain occupied and dependent file restores must not run.
export class FileRenameRecoveryIncompleteError extends AggregateError {
  readonly recoveryIncomplete = true;

  constructor(error: unknown, rollbackError: unknown) {
    super(
      [error, rollbackError],
      `File rename failed: ${error instanceof Error ? error.message : String(error)}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}; recovery incomplete. Files remain at temporary or final paths.`
    );
    this.name = "FileRenameRecoveryIncompleteError";
  }
}

export const applyFileRenamePlan = async (
  renamePlan: RenamePlanItem[],
  ops: FileMoveOps
): Promise<AppliedFileRenamePlan> => {
  const renames = renamePlan.filter((item) => item.fromPath !== item.finalPath);
  const applied: AppliedRename[] = [];

  try {
    for (const item of renames) {
      await ops.mkdir(path.dirname(item.temporaryPath));
      await ops.rename(item.fromPath, item.temporaryPath);
      applied.push({ item, stage: "temporary" });
    }

    for (const item of renames) {
      await ops.mkdir(path.dirname(item.finalPath));
      await ops.rename(item.temporaryPath, item.finalPath);
      const appliedItem = applied.find((entry) => entry.item === item);
      if (appliedItem) {
        appliedItem.stage = "final";
      }
    }
  } catch (error) {
    try {
      await rollbackAppliedRenames(applied, ops);
    } catch (rollbackError) {
      throw new FileRenameRecoveryIncompleteError(error, rollbackError);
    }
    throw error;
  }

  return {
    rollback: () => rollbackAppliedRenames(applied, ops)
  };
};

export type AppliedFileMoves = {
  rollback: () => Promise<void>;
};

export type FileReplacementItem = {
  tempPath: string;
  targetPath: string;
  backupPath: string;
};

type AppliedReplacement = {
  item: FileReplacementItem;
  stage: "backup" | "target";
};

export type AppliedFileReplacements = {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

export const applyFileMoves = async (
  moves: FileMoveItem[],
  ops: FileMoveOps
): Promise<AppliedFileMoves> => {
  const applied: FileMoveItem[] = [];

  try {
    for (const item of moves.filter((move) => move.fromPath !== move.toPath)) {
      await ops.mkdir(path.dirname(item.toPath));
      await ops.rename(item.fromPath, item.toPath);
      applied.push(item);
    }
  } catch (error) {
    try {
      await rollbackAppliedMoves(applied, ops);
    } catch (rollbackError) {
      // No handle is returned on a failed apply. Existing Import/Save/Pending
      // gates must nevertheless know not to restore dependent occupied paths.
      throw new FileReplacementRecoveryIncompleteError([error, rollbackError]);
    }
    throw error;
  }

  return {
    rollback: async () => {
      try {
        await rollbackAppliedMoves(applied, ops);
      } catch (error) {
        throw new FileReplacementRecoveryIncompleteError([error]);
      }
    }
  };
};

const rollbackAppliedMoves = async (
  applied: FileMoveItem[],
  ops: FileMoveOps
): Promise<void> => {
  for (let index = applied.length - 1; index >= 0; index -= 1) {
    const item = applied[index];
    // These moves may share paths. A failed prerequisite must stop dependent
    // recovery, not be swallowed or allow the next rename to overwrite it.
    await ops.rename(item.toPath, item.fromPath);
    applied.splice(index, 1);
  }
};

export type CreateOnlyMoveOps = {
  mkdir: (directoryPath: string) => Promise<void>;
  link: (fromPath: string, toPath: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
};

/** Publish new files by hard link, so an entry that appeared after the
 * availability check is never replaced — unlike rename, which clobbers it.
 * The source name is then removed: leaving both names on one inode would let a
 * later write through the staging path silently mutate the published asset.
 * Rollback restores the source name and removes only this call's target. */
export const applyFileCreateOnlyMoves = async (
  moves: FileMoveItem[],
  ops: CreateOnlyMoveOps
): Promise<AppliedFileMoves> => {
  const published: FileMoveItem[] = [];

  try {
    for (const item of moves.filter((move) => move.fromPath !== move.toPath)) {
      await ops.mkdir(path.dirname(item.toPath));
      await ops.link(item.fromPath, item.toPath);
      try {
        await ops.unlink(item.fromPath);
      } catch (error) {
        // Keep the ledger consistent: the target exists even though the source
        // could not be released.
        published.push(item);
        throw error;
      }
      published.push(item);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const item of [...published].reverse()) {
      try {
        await ops.link(item.toPath, item.fromPath);
        await ops.unlink(item.toPath);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length > 0) throw new FileReplacementRecoveryIncompleteError([error, ...failures]);
    throw error;
  }

  return {
    rollback: async () => {
      const failures: unknown[] = [];
      for (const item of [...published].reverse()) {
        try {
          await ops.link(item.toPath, item.fromPath);
          await ops.unlink(item.toPath);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new FileReplacementRecoveryIncompleteError(failures);
    }
  };
};

export class FileReplacementRecoveryIncompleteError extends AggregateError {
  readonly recoveryIncomplete = true;

  constructor(errors: unknown[]) {
    const details = errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ");
    super(errors, `${details}; File replacement recovery incomplete. Retained files must be recovered before dependent restoration.`);
    this.name = "FileReplacementRecoveryIncompleteError";
  }
}

export const applyFileReplacements = async (
  replacements: FileReplacementItem[],
  ops: Required<TempReplaceOps>
): Promise<AppliedFileReplacements> => {
  const applied: AppliedReplacement[] = [];

  try {
    for (const item of replacements) {
      await ops.mkdir(path.dirname(item.backupPath));
      await ops.rename(item.targetPath, item.backupPath);
      applied.push({ item, stage: "backup" });
      await ops.rename(item.tempPath, item.targetPath);
      applied[applied.length - 1].stage = "target";
    }
  } catch (error) {
    try {
      await rollbackAppliedReplacements(applied, ops);
    } catch (rollbackError) {
      throw new FileReplacementRecoveryIncompleteError([error, rollbackError]);
    }
    throw error;
  }

  let state: "rollbackable" | "restoring" | "restored" | "committed" = "rollbackable";
  return {
    commit: async () => {
      if (state === "restoring" || state === "restored") {
        throw new Error("Cannot commit file replacements after rollback has begun");
      }
      // Even a partially completed cleanup is irreversible. The Save caller
      // catches cleanup errors, so rollback must reject before it can restore
      // dependent rename/import paths beneath already committed TIFF bytes.
      state = "committed";
      await cleanupAppliedReplacementBackups(applied, ops);
    },
    rollback: async () => {
      if (state === "committed") {
        throw new FileReplacementRecoveryIncompleteError([
          new Error("File replacements have entered commit; rollback is no longer safe")
        ]);
      }
      if (state === "restored") return;
      state = "restoring";
      await rollbackAppliedReplacements(applied, ops);
      state = "restored";
    }
  };
};

const cleanupAppliedReplacementBackups = async (
  applied: AppliedReplacement[],
  ops: Required<TempReplaceOps>
): Promise<void> => {
  while (applied.length) {
    await ops.unlink(applied[0].item.backupPath);
    applied.shift();
  }
};

const rollbackAppliedReplacements = async (
  applied: AppliedReplacement[],
  ops: Required<TempReplaceOps>
): Promise<void> => {
  for (const entry of [...applied].reverse()) {
    if (entry.stage === "target") {
      // The installed temp path is vacant. Preserve the new bytes there before
      // restoring the backup, so a failed restore never destroys either version.
      await ops.rename(entry.item.targetPath, entry.item.tempPath);
      entry.stage = "backup";
    }

    await ops.rename(entry.item.backupPath, entry.item.targetPath);
    applied.pop();
  }
};

export const replaceFileWithTemp = async (
  tempPath: string,
  targetPath: string,
  ops: TempReplaceOps
): Promise<void> => {
  try {
    await ops.rename(tempPath, targetPath);
  } catch (error) {
    await ops.unlink(tempPath).catch(() => undefined);
    throw error;
  }
};

export const atomicWriteTextFile = async (
  targetPath: string,
  content: string,
  ops: AtomicTextWriteOps
): Promise<void> => {
  await ops.mkdir(path.dirname(targetPath));
  const tempPath =
    ops.tempPath ?? path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`);

  try {
    await ops.writeFile(tempPath, content, "utf8");
    await ops.rename(tempPath, targetPath);
  } catch (error) {
    await ops.unlink(tempPath).catch(() => undefined);
    throw error;
  }
};

const rollbackAppliedRenames = async (
  applied: AppliedRename[],
  ops: FileMoveOps
): Promise<void> => {
  // Evacuate every final path before restoring any source: cycles share these paths.
  // On failure, stop without restoring over a final path that is still occupied.
  for (const entry of [...applied].reverse()) {
    if (entry.stage === "final") {
      await ops.rename(entry.item.finalPath, entry.item.temporaryPath);
      entry.stage = "temporary";
    }
  }

  for (const entry of [...applied].reverse()) {
    await ops.rename(entry.item.temporaryPath, entry.item.fromPath);
    applied.pop();
  }
};
