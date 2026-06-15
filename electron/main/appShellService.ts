import type { IpcMainInvokeEvent } from "electron";

type DestroyableWindow = {
  destroy: () => void;
};

export const finishSaveAndClose = (
  requests: Map<string, DestroyableWindow>,
  payload: { requestId: string; saved: boolean }
): void => {
  const windowToClose = requests.get(payload.requestId);
  requests.delete(payload.requestId);
  if (payload.saved) {
    windowToClose?.destroy();
  }
};

export const updateCloseGuard = (
  webContentsIds: Set<number>,
  event: Pick<IpcMainInvokeEvent, "sender">,
  payload: { hasUnsavedChanges: boolean }
): void => {
  if (payload.hasUnsavedChanges) {
    webContentsIds.add(event.sender.id);
    return;
  }

  webContentsIds.delete(event.sender.id);
};

export const getAppInfoForRenderer = ({
  version,
  platform,
  arch,
  updateManifestUrl
}: {
  version: string;
  platform: string;
  arch: string;
  updateManifestUrl: string;
}) => ({
  version,
  platform,
  arch,
  updateManifestUrl
});

export const openExternalUrl = async (
  url: string,
  openExternal: (url: string) => Promise<void>
): Promise<void> => {
  if (!/^https:\/\//iu.test(url)) {
    throw new Error("Only HTTPS URLs can be opened externally.");
  }
  await openExternal(url);
};
