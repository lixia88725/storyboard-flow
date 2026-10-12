import type { AppIpcHandlers } from "./ipc/appHandlers.js";
import {
  finishSaveAndClose,
  getAppInfoForRenderer,
  openExternalUrl,
  selectFolderPathForEvent,
  updateCloseGuard,
  type FolderSelectionEvent,
  type ShowOpenFolderDialog
} from "./appShellService.js";

import type { RecoveryCloseBarrier } from "./recoveryCloseBarrier.js";

type DestroyableWindow = {
  destroy: () => void;
};

const defaultUpdateManifestUrl =
  "https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json";

export type AppAppRuntimeOptions<Sender, Owner> = {
  arch: string;
  recoveryCloseBarrier?: RecoveryCloseBarrier;
  closeGuardWebContentsIds: Set<number>;
  getVersion: () => string;
  openExternal: (url: string) => Promise<void>;
  ownerFromSender: (sender: Sender) => Owner | undefined;
  platform: string;
  saveAndCloseRequests: Map<string, DestroyableWindow>;
  showOpenDialog: ShowOpenFolderDialog<Owner>;
  updateManifestUrl?: string;
};

export const createAppAppHandlers = <Sender, Owner>({
  arch,
  recoveryCloseBarrier,
  closeGuardWebContentsIds,
  getVersion,
  openExternal,
  ownerFromSender,
  platform,
  saveAndCloseRequests,
  showOpenDialog,
  updateManifestUrl = defaultUpdateManifestUrl
}: AppAppRuntimeOptions<Sender, Owner>): AppIpcHandlers => {
  const busySenders = new Set<number>();
  return {
  selectFolder: (event) =>
    selectFolderPathForEvent({
      event: event as unknown as FolderSelectionEvent<Sender>,
      ownerFromSender,
      showOpenDialog
    }),
  finishCloseCapture: (event, payload) => {
    if (!recoveryCloseBarrier) throw new Error("Close capture authority unavailable");
    return recoveryCloseBarrier.finishCapture(event, payload);
  },
  finishSaveAndClose: (payload, event) => {
    if (recoveryCloseBarrier) {
      if (!event) throw new Error("Close caller unavailable");
      return recoveryCloseBarrier.finishSave(event, payload);
    }
    return finishSaveAndClose(saveAndCloseRequests, payload);
  },
  updateCloseGuard: (event, payload) => {
    recoveryCloseBarrier?.observe(event, payload.recoveryRequired === true);
    updateCloseGuard(closeGuardWebContentsIds, event, {
      hasUnsavedChanges: busySenders.has(event.sender.id) || payload.hasUnsavedChanges
    });
  },
  updateBitmapQueueGuard: (event, payload) => {
    recoveryCloseBarrier?.observe(event, false, payload.busy);
    if (payload.busy) busySenders.add(event.sender.id);
    else busySenders.delete(event.sender.id);
    updateCloseGuard(closeGuardWebContentsIds, event, {
      hasUnsavedChanges: payload.busy || payload.hasUnsavedChanges
    });
  },
  getInfo: () =>
    getAppInfoForRenderer({
      arch,
      platform,
      updateManifestUrl,
      version: getVersion()
    }),
  openExternal: (url) => openExternalUrl(url, openExternal)
  };
};
