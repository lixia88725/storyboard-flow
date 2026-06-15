import { useEffect } from "react";
import type { RefObject } from "react";
import { hasUnsavedWorkspaceChanges } from "./workspacePersistenceController";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";

export type WorkspaceCloseGuardApi = {
  updateCloseGuard: (payload: { hasUnsavedChanges: boolean }) => Promise<void>;
};

export type WorkspaceCloseGuardInput = {
  dirtyShotCount: number;
  workspaceSaveState: WorkspaceSaveState;
  fileNameSyncState: FileNameSyncState;
};

export const workspaceCloseGuardPayload = ({
  dirtyShotCount,
  workspaceSaveState,
  fileNameSyncState
}: WorkspaceCloseGuardInput): { hasUnsavedChanges: boolean } => ({
  hasUnsavedChanges: hasUnsavedWorkspaceChanges(
    dirtyShotCount,
    workspaceSaveState,
    fileNameSyncState
  )
});

export const updateWorkspaceCloseGuard = (
  api: WorkspaceCloseGuardApi,
  input: WorkspaceCloseGuardInput
): Promise<void> => api.updateCloseGuard(workspaceCloseGuardPayload(input));

export const useWorkspaceCloseGuardController = ({
  dirtyShotIdsRef,
  fileNameSyncState,
  refreshKey,
  workspaceSaveState
}: {
  dirtyShotIdsRef: RefObject<Set<string>>;
  fileNameSyncState: FileNameSyncState;
  refreshKey: unknown;
  workspaceSaveState: WorkspaceSaveState;
}): void => {
  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    void updateWorkspaceCloseGuard(window.storyboard, {
      dirtyShotCount: dirtyShotIdsRef.current?.size ?? 0,
      workspaceSaveState,
      fileNameSyncState
    });
  }, [dirtyShotIdsRef, fileNameSyncState, refreshKey, workspaceSaveState]);
};
