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
  normalHasUnsavedWork?: boolean;
};

export const workspaceCloseGuardPayload = ({
  dirtyShotCount,
  workspaceSaveState,
  fileNameSyncState,
  normalHasUnsavedWork
}: WorkspaceCloseGuardInput): { hasUnsavedChanges: boolean } => ({
  hasUnsavedChanges: hasUnsavedWorkspaceChanges(
    normalHasUnsavedWork === undefined ? dirtyShotCount : Number(normalHasUnsavedWork),
    workspaceSaveState,
    fileNameSyncState
  )
});

export const updateWorkspaceCloseGuard = (
  api: WorkspaceCloseGuardApi,
  input: WorkspaceCloseGuardInput
): Promise<void> => api.updateCloseGuard(workspaceCloseGuardPayload(input));

export const useWorkspaceCloseGuardController = ({
  bitmapQueueGuardInputRef,
  normalSaveGuard,
  settleNormalSave,
  dirtyShotIdsRef,
  fileNameSyncState,
  refreshKey,
  workspaceSaveState
}: {
  bitmapQueueGuardInputRef: { current: () => { hasUnsavedChanges: boolean } };
  dirtyShotIdsRef: RefObject<Set<string>>;
  normalSaveGuard: () => boolean;
  settleNormalSave: () => Promise<void>;
  fileNameSyncState: FileNameSyncState;
  refreshKey: unknown;
  workspaceSaveState: WorkspaceSaveState;
}): void => {
  // The queue reads this synchronously at completion, even without a render.
  // No subscribe/unsubscribe gap during StrictMode effect replay/unmount.
  bitmapQueueGuardInputRef.current = () => workspaceCloseGuardPayload({
    normalHasUnsavedWork: normalSaveGuard(),
    dirtyShotCount: dirtyShotIdsRef.current?.size ?? 0,
    workspaceSaveState,
    fileNameSyncState
  });
  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    let cancelled = false;
    const update = () => updateWorkspaceCloseGuard(window.storyboard, {
      normalHasUnsavedWork: normalSaveGuard(),
      dirtyShotCount: dirtyShotIdsRef.current?.size ?? 0,
      workspaceSaveState,
      fileNameSyncState
    });
    void update();
    // A completed queue effect need not cause a render. Recheck its settled
    // truth, but never publish an old render's gate after P3/workspace changes.
    void settleNormalSave().then(() => { if (!cancelled) void update(); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [dirtyShotIdsRef, fileNameSyncState, refreshKey, workspaceSaveState, normalSaveGuard, settleNormalSave]);
};
