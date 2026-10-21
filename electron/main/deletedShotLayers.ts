import { rm } from "node:fs/promises";
import path from "node:path";

type PendingDeletedShotLike = {
  id: string;
  imagePath: string;
};

type CleanupDeletedShotLayerDirectoriesOptions = {
  folderPath: string;
  previousPendingDeletedShots: PendingDeletedShotLike[];
  nextPendingDeletedShots: PendingDeletedShotLike[];
  remove?: typeof rm;
  onCleaned?: (shotId: string) => void;
};

const deletedShotKey = (shot: PendingDeletedShotLike): string => `${shot.id}\n${shot.imagePath}`;

const layerDirectoryForShot = (folderPath: string, shotId: string): string | undefined => {
  const layersRoot = path.join(folderPath, ".storyboard-workbench", "layers");
  const directoryPath = path.join(layersRoot, shotId);
  const relativePath = path.relative(layersRoot, directoryPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }

  return directoryPath;
};

export const cleanupDeletedShotLayerDirectories = async ({
  folderPath,
  previousPendingDeletedShots,
  nextPendingDeletedShots,
  remove = rm,
  onCleaned
}: CleanupDeletedShotLayerDirectoriesOptions): Promise<void> => {
  const remainingKeys = new Set(nextPendingDeletedShots.map(deletedShotKey));

  for (const shot of previousPendingDeletedShots) {
    if (remainingKeys.has(deletedShotKey(shot))) {
      continue;
    }

    const directoryPath = layerDirectoryForShot(folderPath, shot.id);
    if (!directoryPath) {
      continue;
    }

    await remove(directoryPath, { recursive: true, force: true }).then(() => { onCleaned?.(shot.id); }).catch(() => undefined);
  }
};
