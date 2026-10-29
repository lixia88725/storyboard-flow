import type { UpdateNoticeState } from "./updateNoticeController";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";

export const flowStatusLabel = ({
  needsFlowImport,
  hasFlowWarning
}: {
  needsFlowImport: boolean;
  hasFlowWarning: boolean;
}): string => {
  if (needsFlowImport) {
    return "FLOW import needed";
  }

  return hasFlowWarning ? "FLOW warning" : "FLOW ready";
};

export const updateCheckButtonLabel = (status: UpdateNoticeState["status"]): string =>
  status === "checking" ? "Checking..." : "Check for updates";

export const statusPanelNeedsAttention = ({
  workspaceSaveState,
  fileNameSyncState,
  hasFlowWarning,
  updateNoticeStatus
}: {
  workspaceSaveState: WorkspaceSaveState;
  fileNameSyncState: FileNameSyncState;
  hasFlowWarning: boolean;
  updateNoticeStatus: UpdateNoticeState["status"];
}): boolean =>
  workspaceSaveState === "error" ||
  fileNameSyncState === "unsynced" ||
  hasFlowWarning ||
  updateNoticeStatus === "available";

export const statusPanelToggleClassName = (state: {
  workspaceSaveState: WorkspaceSaveState;
  fileNameSyncState: FileNameSyncState;
  hasFlowWarning: boolean;
  updateNoticeStatus: UpdateNoticeState["status"];
}): string => `status-toggle ${statusPanelNeedsAttention(state) ? "needs-attention" : ""}`;
