import type { IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";

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

export const respondToStoryboardImageRequest = async (
  requestUrl: string,
  fetchFileUrl: (url: string) => Promise<Response>
): Promise<Response> => {
  const parsedUrl = new URL(requestUrl);
  const filePath = parsedUrl.searchParams.get("path");

  if (!filePath) {
    return new Response("Missing path", { status: 400 });
  }

  return fetchFileUrl(pathToFileURL(filePath).toString());
};

export type FolderDialogOptions = {
  properties: Array<"openDirectory" | "createDirectory">;
};

export type FolderDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

export type ShowOpenFolderDialog<Owner = unknown> = {
  (options: FolderDialogOptions): Promise<FolderDialogResult>;
  (owner: Owner, options: FolderDialogOptions): Promise<FolderDialogResult>;
};

export const selectFolderPath = async <Owner = unknown>({
  owner,
  showOpenDialog
}: {
  owner?: Owner;
  showOpenDialog: ShowOpenFolderDialog<Owner>;
}): Promise<string | undefined> => {
  const options: FolderDialogOptions = {
    properties: ["openDirectory", "createDirectory"]
  };
  const result =
    owner === undefined
      ? await showOpenDialog(options)
      : await showOpenDialog(owner, options);
  return result.canceled ? undefined : result.filePaths[0];
};
