import type { MutableRefObject } from "react";
import type { Project } from "../../shared/types";

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export const changedAiLayerShotIds = (
  currentProject: Project,
  nextProject: Project
): string[] =>
  nextProject.shots
    .filter((nextShot) => {
      const currentShot = currentProject.shots.find((shot) => shot.id === nextShot.id);
      return (
        currentShot?.activeLayerId !== nextShot.activeLayerId ||
        JSON.stringify(currentShot?.layers ?? []) !== JSON.stringify(nextShot.layers ?? [])
      );
    })
    .map((shot) => shot.id);

export type ApplyAiProjectChangeOptions = {
  markShotsDirty: (shotIds: string[]) => void;
  nextProject: Project;
  nextStatus: string;
  projectRef: MutableRefObject<Project>;
  setAutosaveRevision: StateSetter<number>;
  setProject: (project: Project) => void;
  setStatus: (status: string) => void;
  setWorkspaceSaveState: (state: "saving") => void;
};

export const applyAiProjectChange = ({
  markShotsDirty,
  nextProject,
  nextStatus,
  projectRef,
  setAutosaveRevision,
  setProject,
  setStatus,
  setWorkspaceSaveState
}: ApplyAiProjectChangeOptions): void => {
  markShotsDirty(changedAiLayerShotIds(projectRef.current, nextProject));
  setProject(nextProject);
  projectRef.current = nextProject;
  setWorkspaceSaveState("saving");
  setAutosaveRevision((revision) => revision + 1);
  setStatus(nextStatus);
};
