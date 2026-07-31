import path from "node:path";

export const visiblePendingFolderName = "Pending";

export type PendingShotFile = {
  shotId: string;
  imagePath: string;
  fileName: string;
  baseFingerprint?: string;
};

type PendingShot = {
  id: string;
  imagePath: string;
  fileName: string;
  swb?: { baseFingerprint?: string };
};

export type PendingProject = {
  shots: PendingShot[];
  parkedShots?: PendingShot[];
};

type ReversibleFileOperation = {
  commit?: () => Promise<void>;
  rollback: () => Promise<void>;
};

type PendingFileMove = { fromPath: string; toPath: string };

type PendingShotFilesOptions<Project extends PendingProject> = {
  fingerprint: (filePath: string) => Promise<string>;
  materializeShots: (
    project: Project,
    shotIds: Set<string>
  ) => Promise<ReversibleFileOperation | undefined>;
  moveFiles: (
    moves: PendingFileMove[]
  ) => Promise<ReversibleFileOperation>;
  beginTransaction?: (moves: PendingFileMove[]) => Promise<ReversibleFileOperation>;
  finalize?: (files: PendingShotFile[]) => Promise<void>;
  uniquePath: (directory: string, fileName: string) => Promise<string>;
};

export const visiblePendingFolderPath = (folderPath: string): string =>
  path.join(folderPath, visiblePendingFolderName);

export const isVisiblePendingPath = (folderPath: string, filePath: string): boolean => {
  const relativePath = path.relative(visiblePendingFolderPath(folderPath), filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
};

const shotsById = <Project extends PendingProject>(project: Project): Map<string, PendingShot> =>
  new Map(
    [...project.shots, ...(project.parkedShots ?? [])].map((shot) => [shot.id, shot])
  );

export const moveShotsToVisiblePending = async <Project extends PendingProject>(
  folderPath: string,
  project: Project,
  shotIds: string[],
  options: PendingShotFilesOptions<Project>
): Promise<PendingShotFile[]> => {
  const shotById = shotsById(project);
  const movingShots = shotIds
    .map((shotId) => shotById.get(shotId))
    .filter((shot): shot is PendingShot => Boolean(shot))
    .filter((shot) => !isVisiblePendingPath(folderPath, shot.imagePath));
  if (movingShots.length === 0) {
    return [];
  }

  const pendingFolderPath = visiblePendingFolderPath(folderPath);
  const targets: PendingShotFile[] = [];
  for (const shot of movingShots) {
    const imagePath = await options.uniquePath(pendingFolderPath, path.basename(shot.imagePath));
    targets.push({ shotId: shot.id, imagePath, fileName: path.basename(imagePath) });
  }

  let materialized: ReversibleFileOperation | undefined;
  let moved: ReversibleFileOperation | undefined;
  let transaction: ReversibleFileOperation | undefined;
  try {
    const moves = movingShots.map((shot, index) => ({
      fromPath: shot.imagePath,
      toPath: targets[index].imagePath
    }));
    transaction = await options.beginTransaction?.(moves);
    materialized = await options.materializeShots(
      project,
      new Set(movingShots.map((shot) => shot.id))
    );
    moved = await options.moveFiles(moves);
    const completed = await Promise.all(
      targets.map(async (target) => ({
        ...target,
        baseFingerprint: await options.fingerprint(target.imagePath)
      }))
    );
    await options.finalize?.(completed);
    await materialized?.commit?.();
    await transaction?.commit?.();
    return completed;
  } catch (error) {
    await moved?.rollback();
    await materialized?.rollback();
    await transaction?.rollback();
    throw error;
  }
};

export const restoreShotsFromVisiblePending = async <Project extends PendingProject>(
  folderPath: string,
  project: Project,
  shotIds: string[],
  options: Pick<
    PendingShotFilesOptions<Project>,
    "beginTransaction" | "finalize" | "fingerprint" | "moveFiles" | "uniquePath"
  >
): Promise<PendingShotFile[]> => {
  const shotById = shotsById(project);
  const restoringShots = shotIds
    .map((shotId) => shotById.get(shotId))
    .filter((shot): shot is PendingShot => Boolean(shot))
    .filter((shot) => isVisiblePendingPath(folderPath, shot.imagePath));
  if (restoringShots.length === 0) {
    return [];
  }

  const targets: PendingShotFile[] = [];
  for (const shot of restoringShots) {
    const imagePath = await options.uniquePath(folderPath, path.basename(shot.imagePath));
    targets.push({ shotId: shot.id, imagePath, fileName: path.basename(imagePath) });
  }

  let moved: ReversibleFileOperation | undefined;
  let transaction: ReversibleFileOperation | undefined;
  try {
    const moves = restoringShots.map((shot, index) => ({
      fromPath: shot.imagePath,
      toPath: targets[index].imagePath
    }));
    transaction = await options.beginTransaction?.(moves);
    moved = await options.moveFiles(moves);
    const completed = await Promise.all(
      targets.map(async (target) => ({
        ...target,
        baseFingerprint: await options.fingerprint(target.imagePath)
      }))
    );
    await options.finalize?.(completed);
    await transaction?.commit?.();
    return completed;
  } catch (error) {
    await moved?.rollback();
    await transaction?.rollback();
    throw error;
  }
};
