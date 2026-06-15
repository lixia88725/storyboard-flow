import type { Dispatch, SetStateAction } from "react";
import { autosaveErrorReducer, type AutosaveErrorNotice } from "./autosaveError";
import { statusPanelToggleClassName, swbStatusLabel, updateCheckButtonLabel } from "./statusPanelController";
import type { UpdateNoticeState } from "./updateNoticeController";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";

export type StatusPopoverProps = {
  autosaveError: AutosaveErrorNotice | undefined;
  checkForUpdates: (notifyWhenCurrent?: boolean) => void | Promise<void>;
  fileNameSyncState: FileNameSyncState;
  hasSwbWarning: boolean;
  isStatusPanelOpen: boolean;
  needsSwbImport: boolean;
  openUpdateDownload: (update: Extract<UpdateNoticeState, { status: "available" }>["update"]) => void;
  parkedShotCount: number;
  setAutosaveError: Dispatch<SetStateAction<AutosaveErrorNotice | undefined>>;
  setIsStatusPanelOpen: Dispatch<SetStateAction<boolean>>;
  setUpdateNotice: Dispatch<SetStateAction<UpdateNoticeState>>;
  shotCount: number;
  status: string;
  updateNotice: UpdateNoticeState;
  workspaceSaveState: WorkspaceSaveState;
};

export const StatusPopover = ({
  autosaveError,
  checkForUpdates,
  fileNameSyncState,
  hasSwbWarning,
  isStatusPanelOpen,
  needsSwbImport,
  openUpdateDownload,
  parkedShotCount,
  setAutosaveError,
  setIsStatusPanelOpen,
  setUpdateNotice,
  shotCount,
  status,
  updateNotice,
  workspaceSaveState
}: StatusPopoverProps) => (
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
        <span>{status}</span>
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
        <span>Workspace {workspaceSaveState}</span>
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
        workspaceSaveState,
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
