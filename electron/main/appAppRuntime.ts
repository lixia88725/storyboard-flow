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

type DestroyableWindow = {
  destroy: () => void;
};

const defaultUpdateManifestUrl =
  "https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json";

export type AppAppRuntimeOptions<Sender, Owner> = {
  arch: string;
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
  closeGuardWebContentsIds,
  getVersion,
  openExternal,
  ownerFromSender,
  platform,
  saveAndCloseRequests,
  showOpenDialog,
  updateManifestUrl = defaultUpdateManifestUrl
}: AppAppRuntimeOptions<Sender, Owner>): AppIpcHandlers => ({
  selectFolder: (event) =>
    selectFolderPathForEvent({
      event: event as unknown as FolderSelectionEvent<Sender>,
      ownerFromSender,
      showOpenDialog
    }),
  finishSaveAndClose: (payload) => finishSaveAndClose(saveAndCloseRequests, payload),
  updateCloseGuard: (event, payload) => updateCloseGuard(closeGuardWebContentsIds, event, payload),
  getInfo: () =>
    getAppInfoForRenderer({
      arch,
      platform,
      updateManifestUrl,
      version: getVersion()
    }),
  openExternal: (url) => openExternalUrl(url, openExternal)
});
