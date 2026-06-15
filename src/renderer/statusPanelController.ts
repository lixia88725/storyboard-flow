import type { UpdateNoticeState } from "./updateNoticeController";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";

export const swbStatusLabel = ({
  needsSwbImport,
  hasSwbWarning
}: {
  needsSwbImport: boolean;
  hasSwbWarning: boolean;
}): string => {
  if (needsSwbImport) {
    return "SWB import needed";
  }

  return hasSwbWarning ? "SWB warning" : "SWB ready";
};

export const updateCheckButtonLabel = (status: UpdateNoticeState["status"]): string =>
  status === "checking" ? "Checking..." : "Check for updates";

export const statusPanelNeedsAttention = ({
  workspaceSaveState,
  fileNameSyncState,
  hasSwbWarning,
  updateNoticeStatus
}: {
  workspaceSaveState: WorkspaceSaveState;
  fileNameSyncState: FileNameSyncState;
  hasSwbWarning: boolean;
  updateNoticeStatus: UpdateNoticeState["status"];
}): boolean =>
  workspaceSaveState === "error" ||
  fileNameSyncState === "unsynced" ||
  hasSwbWarning ||
  updateNoticeStatus === "available";

export const statusPanelToggleClassName = (state: {
  workspaceSaveState: WorkspaceSaveState;
  fileNameSyncState: FileNameSyncState;
  hasSwbWarning: boolean;
  updateNoticeStatus: UpdateNoticeState["status"];
}): string => `status-toggle ${statusPanelNeedsAttention(state) ? "needs-attention" : ""}`;
