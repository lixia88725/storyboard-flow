type SaveProgressProject = {
  shots: Array<{ id: string }>;
};

export const saveProgressShotIds = (
  dirtyShotIds: string[] | undefined,
  importedShotIds: string[]
): Set<string> | undefined => {
  if (!dirtyShotIds) {
    return undefined;
  }

  return new Set([...dirtyShotIds, ...importedShotIds]);
};

export const countSaveProgressShots = (
  project: SaveProgressProject,
  shotIds: Set<string> | undefined
): number => {
  if (!shotIds) {
    return project.shots.length;
  }

  return project.shots.filter((shot) => shotIds.has(shot.id)).length;
};
