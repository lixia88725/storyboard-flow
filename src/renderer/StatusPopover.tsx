import { useState, type Dispatch, type SetStateAction } from "react";
import { autosaveErrorReducer, type AutosaveErrorNotice } from "./autosaveError";
import { statusPanelToggleClassName, swbStatusLabel, updateCheckButtonLabel } from "./statusPanelController";
import type { UpdateNoticeState } from "./updateNoticeController";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";
import type { WorkspaceStatusPresentation } from "./workspaceStatusPresentation";

export type StatusPopoverProps = {
  autosaveError: AutosaveErrorNotice | undefined;
  checkForUpdates: (notifyWhenCurrent?: boolean) => void | Promise<void>;
  fileNameSyncState: FileNameSyncState;
  hasSwbWarning: boolean;
  needsSwbImport: boolean;
  openUpdateDownload: (update: Extract<UpdateNoticeState, { status: "available" }>["update"]) => void;
  parkedShotCount: number;
  setAutosaveError: Dispatch<SetStateAction<AutosaveErrorNotice | undefined>>;
  setUpdateNotice: Dispatch<SetStateAction<UpdateNoticeState>>;
  shotCount: number;
  status: string;
  updateNotice: UpdateNoticeState;
  workspaceSaveState: WorkspaceSaveState;
  readWorkspaceStatus?: () => WorkspaceStatusPresentation;
};

export const StatusPopover = ({
  autosaveError,
  checkForUpdates,
  fileNameSyncState,
  hasSwbWarning,
  needsSwbImport,
  openUpdateDownload,
  parkedShotCount,
  setAutosaveError,
  setUpdateNotice,
  shotCount,
  status,
  updateNotice,
  workspaceSaveState,
  readWorkspaceStatus
}: StatusPopoverProps) => {
  const [isStatusPanelOpen, setIsStatusPanelOpen] = useState(false);
  const presentation = readWorkspaceStatus?.() ?? { state: workspaceSaveState, message: status, metadataState: workspaceSaveState };

  return (
    <div className="status-popover">
      {autosaveError ? (
        <div className="autosave-error-notice" role="alert">
          <span>{autosaveError.message}</span>
          <button
            type="button"
            aria-label="Dismiss autosave error"
            onClick={() =>
              setAutosaveError((current) => autosaveErrorReducer(current, { type: "dismissed" }))
            }
          >
            x
          </button>
        </div>
      ) : null}
      {isStatusPanelOpen ? (
        <div className="status-panel" aria-label="Workspace status">
          <span>{presentation.message}</span>
          {updateNotice.status === "available" ? (
            <div className="update-notice" role="status">
              <span>Storyboard Flow {updateNotice.update.version} is available.</span>
              {updateNotice.update.notes ? <small>{updateNotice.update.notes}</small> : null}
              <button type="button" onClick={() => openUpdateDownload(updateNotice.update)}>
                Download
              </button>
              <button type="button" onClick={() => setUpdateNotice({ status: "dismissed" })}>
                Later
              </button>
            </div>
          ) : null}
          <span>{shotCount} shots</span>
          <span>{parkedShotCount} pending</span>
          <span>Workspace {presentation.state}</span>
          {presentation.state === "pending" ? <span>Internal metadata {presentation.metadataState}; working TIFF output pending Save</span> : null}
          <span>File names {fileNameSyncState}</span>
          <span>{swbStatusLabel({ needsSwbImport, hasSwbWarning })}</span>
          <button type="button" className="status-panel-action" onClick={() => void checkForUpdates(true)}>
            {updateCheckButtonLabel(updateNotice.status)}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={statusPanelToggleClassName({
          workspaceSaveState: presentation.state === "pending" ? "saving" : presentation.state,
          fileNameSyncState,
          hasSwbWarning,
          updateNoticeStatus: updateNotice.status
        })}
        aria-label="Workspace status"
        aria-expanded={isStatusPanelOpen}
        onClick={() => setIsStatusPanelOpen((isOpen) => !isOpen)}
        title="Workspace status"
      >
        i
      </button>
    </div>
  );
};
