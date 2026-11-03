import type { MutableRefObject } from "react";

type DirtyShotProject = {
  shots: Array<{ id: string }>;
};

export const createDirtyShotTracker = <Project extends DirtyShotProject>({
  dirtyShotIdsRef,
  projectRef
}: {
  dirtyShotIdsRef: MutableRefObject<Set<string>>;
  projectRef: MutableRefObject<Project>;
}) => {
  const dirtyShotIds = (): string[] => [...dirtyShotIdsRef.current];

  const markShotsDirty = (shotIds: string[]) => {
    for (const shotId of shotIds) {
      dirtyShotIdsRef.current.add(shotId);
    }
  };

  const markAllShotsDirty = () => {
    markShotsDirty(projectRef.current.shots.map((shot) => shot.id));
  };

  const clearShotsDirty = (shotIds: string[]) => {
    for (const shotId of shotIds) {
      dirtyShotIdsRef.current.delete(shotId);
    }
  };

  const resetDirtyShots = () => {
    dirtyShotIdsRef.current = new Set();
  };

  return {
    clearShotsDirty,
    dirtyShotIds,
    markAllShotsDirty,
    markShotsDirty,
    resetDirtyShots
  };
};
