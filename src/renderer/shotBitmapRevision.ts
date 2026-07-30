import { bitmapLayersForShot } from "../shared/projectOps";
import type { Project } from "../shared/types";

export type ShotBitmapRevisions = Readonly<Record<string, number>>;

export const changedShotIdsForBitmapRevision = (
  previousProject: Project,
  nextProject: Project
): string[] => {
  const previousById = new Map(previousProject.shots.map((shot) => [shot.id, shot]));
  return nextProject.shots
    .filter((shot) => {
      const previousShot = previousById.get(shot.id);
      return (
        !previousShot ||
        previousShot.layers !== shot.layers ||
        previousShot.imageLayerEdits !== shot.imageLayerEdits
      );
    })
    .map((shot) => shot.id);
};

export const bumpShotBitmapRevisions = (
  current: ShotBitmapRevisions,
  shotIds: readonly string[]
): ShotBitmapRevisions => {
  if (shotIds.length === 0) {
    return current;
  }

  const next = { ...current };
  for (const shotId of new Set(shotIds)) {
    next[shotId] = (next[shotId] ?? 0) + 1;
  }
  return next;
};

export const bumpWorkspaceShotBitmapRevisions = (
  current: ShotBitmapRevisions,
  project: Project
): ShotBitmapRevisions =>
  bumpShotBitmapRevisions(
    current,
    project.shots.map((shot) => shot.id)
  );

export const shotIdsForBitmapPaths = (
  project: Project,
  bitmapPaths: readonly string[]
): string[] => {
  const targetPaths = new Set(bitmapPaths);
  if (targetPaths.size === 0) {
    return [];
  }

  return project.shots
    .filter((shot) =>
      bitmapLayersForShot(shot).some((layer) => targetPaths.has(layer.bitmapPath))
    )
    .map((shot) => shot.id);
};
