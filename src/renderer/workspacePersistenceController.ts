import type { Project } from "../shared/types";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";

export const projectChangedDuringLoad = (before: Project, after: Project): boolean => {
  if (before.shots.length !== after.shots.length) {
    return true;
  }

  const beforeShotsById = new Map(before.shots.map((shot) => [shot.id, shot]));
  return after.shots.some((afterShot) => {
    const beforeShot = beforeShotsById.get(afterShot.id);
    return (
      !beforeShot ||
      beforeShot.previewPath !== afterShot.previewPath ||
      beforeShot.fileName !== afterShot.fileName ||
      beforeShot.activeLayerId !== afterShot.activeLayerId ||
      JSON.stringify(beforeShot.layers ?? []) !== JSON.stringify(afterShot.layers ?? []) ||
      JSON.stringify(beforeShot.sketchLayers ?? []) !== JSON.stringify(afterShot.sketchLayers ?? [])
    );
  });
};

export const shouldRunAutosave = (
  autosaveRevision: number,
  folderPath: string | undefined,
  metadataPath: string | undefined,
  hasStoryboardApi: boolean
): boolean => autosaveRevision !== 0 && Boolean(folderPath) && Boolean(metadataPath) && hasStoryboardApi;

export const hasUnsavedWorkspaceChanges = (
  dirtyShotCount: number,
  workspaceSaveState: WorkspaceSaveState,
  fileNameSyncState: FileNameSyncState
): boolean =>
  dirtyShotCount > 0 || workspaceSaveState !== "saved" || fileNameSyncState !== "synced";

export const shouldPersistLoadedProject = (
  preserveProjectWithoutImageMerge: boolean | undefined,
  loadedProjectChanged: boolean,
  dirty: boolean,
  acceptedExternalEdits: boolean,
  scriptImportNeeded: boolean
): boolean =>
  Boolean(preserveProjectWithoutImageMerge) &&
  loadedProjectChanged &&
  !dirty &&
  !acceptedExternalEdits &&
  !scriptImportNeeded;

export const shouldAutosaveAfterLoad = (
  dirty: boolean,
  acceptedExternalEdits: boolean,
  loadedProjectChanged: boolean,
  scriptImportNeeded: boolean
): boolean =>
  (dirty || acceptedExternalEdits || loadedProjectChanged) && !scriptImportNeeded;

export const hasOnlyCompatibleExternalEdits = (project: Project): boolean => {
  let hasCompatibleEdit = false;
  for (const shot of [...project.shots, ...(project.parkedShots ?? [])]) {
    if (shot.swb?.status === "compatible-external-edit") {
      hasCompatibleEdit = true;
      continue;
    }

    if (shot.swb?.status === "non-swb" || shot.swb?.status === "incompatible-external-edit") {
      return false;
    }
  }

  return hasCompatibleEdit;
};
