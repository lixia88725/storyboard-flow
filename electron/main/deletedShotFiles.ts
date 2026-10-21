import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import { applyFileMoves, type AppliedFileMoves } from "./fileRenames.js";

export type PendingDeletedShotLike = {
  id: string;
  imagePath: string;
  fileName: string;
};

export type ProjectWithPendingDeletedShots = {
  pendingDeletedShots?: PendingDeletedShotLike[];
  updatedAt: string;
};

type StageDeletedShotFilesOptions = {
  pathExists?: (filePath: string) => Promise<boolean>;
  uniquePath?: (directory: string, fileName: string) => Promise<string>;
  moveFiles?: typeof applyFileMoves;
  mkdir?: (directoryPath: string) => Promise<void>;
  rename?: (fromPath: string, toPath: string) => Promise<void>;
  now?: () => Date;
};

type TrashDeletedShotFilesOptions = {
  pathExists?: (filePath: string) => Promise<boolean>;
  trashItem?: (filePath: string) => Promise<void>;
  now?: () => Date;
};

export const stagePendingDeletedShotFiles = async <ProjectT extends ProjectWithPendingDeletedShots>(
  project: ProjectT,
  folderPath: string,
  options: StageDeletedShotFilesOptions = {}
): Promise<{ project: ProjectT; appliedMoves?: AppliedFileMoves }> => {
  const pending = project.pendingDeletedShots ?? [];

  if (pending.length === 0) {
    return { project };
  }

  const pathExists = options.pathExists ?? defaultPathExists;
  const uniquePath = options.uniquePath ?? defaultUniquePath(pathExists);
  const moveFiles = options.moveFiles ?? applyFileMoves;
  const tempRoot = path.join(folderPath, ".storyboard-workbench", "delete-tmp", archiveStamp(options.now));
  const stagedShots: PendingDeletedShotLike[] = [];
  const moves = [];

  for (const shot of pending) {
    if (!(await pathExists(shot.imagePath))) {
      stagedShots.push(shot);
      continue;
    }

    const extension = path.extname(shot.imagePath);
    const tempPath = await uniquePath(tempRoot, `${shot.id}${extension || ".tiff"}`);
    moves.push({ fromPath: shot.imagePath, toPath: tempPath });
    stagedShots.push({ ...shot, imagePath: tempPath });
  }

  if (moves.length === 0) {
    return { project };
  }

  const appliedMoves = await moveFiles(moves, {
    mkdir: options.mkdir ?? ensureDirectory,
    rename: options.rename ?? rename
  });

  return {
    project: {
      ...project,
      pendingDeletedShots: stagedShots
    },
    appliedMoves
  };
};

export const trashPendingDeletedShotFiles = async <ProjectT extends ProjectWithPendingDeletedShots>(
  project: ProjectT,
  options: TrashDeletedShotFilesOptions = {}
): Promise<{ project: ProjectT; error?: Error; trashed?: PendingDeletedShotLike[] }> => {
  const pending = project.pendingDeletedShots ?? [];

  if (pending.length === 0) {
    return { project };
  }

  const pathExists = options.pathExists ?? defaultPathExists;
  const trashItem = options.trashItem ?? shell.trashItem;
  const remaining: PendingDeletedShotLike[] = [];
  const failed: PendingDeletedShotLike[] = [];
  const trashed: PendingDeletedShotLike[] = [];

  for (const shot of pending) {
    if (!(await pathExists(shot.imagePath))) {
      continue;
    }

    try {
      await trashItem(shot.imagePath);
      trashed.push(shot);
    } catch {
      remaining.push(shot);
      failed.push(shot);
    }
  }

  const nextProject: ProjectT = {
    ...project,
    pendingDeletedShots: remaining.length > 0 ? remaining : undefined,
    updatedAt: (options.now?.() ?? new Date()).toISOString()
  };

  if (failed.length === 0) {
    return { project: nextProject, trashed };
  }

  const fileList = failed.map((shot) => shot.fileName).join(", ");
  return {
    project: nextProject,
    error: new Error(`Could not move deleted storyboard files to Trash: ${fileList}`)
  };
};

const defaultPathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

const archiveStamp = (now: (() => Date) | undefined): string => {
  return (now?.() ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
};

const defaultUniquePath =
  (pathExists: (filePath: string) => Promise<boolean>) =>
  async (directory: string, fileName: string): Promise<string> => {
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidateName = attempt === 0 ? fileName : `${baseName}_${attempt}${extension}`;
      const candidate = path.join(directory, candidateName);
      if (!(await pathExists(candidate))) {
        return candidate;
      }
    }

    throw new Error(`Could not create a unique path for ${fileName}`);
  };
