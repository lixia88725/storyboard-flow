import path from "node:path";

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
    await rollbackAppliedRenames(applied, ops);
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
    await rollbackAppliedMoves(applied, ops);
    throw error;
  }

  return {
    rollback: () => rollbackAppliedMoves(applied, ops)
  };
};

const rollbackAppliedMoves = async (
  applied: FileMoveItem[],
  ops: FileMoveOps
): Promise<void> => {
  for (const item of [...applied].reverse()) {
    await ops.rename(item.toPath, item.fromPath).catch(() => undefined);
  }
};

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
    await rollbackAppliedReplacements(applied, ops);
    throw error;
  }

  return {
    rollback: () => rollbackAppliedReplacements(applied, ops)
  };
};

const rollbackAppliedReplacements = async (
  applied: AppliedReplacement[],
  ops: Required<TempReplaceOps>
): Promise<void> => {
  for (const entry of [...applied].reverse()) {
    if (entry.stage === "target") {
      await ops.unlink(entry.item.targetPath).catch(() => undefined);
    }

    await ops.rename(entry.item.backupPath, entry.item.targetPath).catch(() => undefined);
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

const rollbackAppliedRenames = async (
  applied: AppliedRename[],
  ops: FileMoveOps
): Promise<void> => {
  for (const entry of [...applied].reverse()) {
    const currentPath = entry.stage === "final" ? entry.item.finalPath : entry.item.temporaryPath;
    await ops.rename(currentPath, entry.item.fromPath).catch(() => undefined);
  }
};
