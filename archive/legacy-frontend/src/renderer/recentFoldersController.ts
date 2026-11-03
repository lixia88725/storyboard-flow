import { useEffect, useRef } from "react";

export type RecentFoldersApi = {
  getRecentFolders: () => Promise<string[]>;
  onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
  onRecentFoldersChanged: (
    callback: (folders: string[], reason?: string) => void
  ) => () => void;
};

export type RecentFoldersControllerCallbacks = {
  openFolder: (folderPath: string) => void | Promise<void>;
  setFolderInputValue: (folderPath: string) => void;
  setRecentFolders: (folders: string[]) => void;
  setStatus: (status: string) => void;
};

export const recentFoldersStatusForChange = (reason?: string): string | undefined =>
  reason === "recent-folders-corrupt"
    ? "Recent folders were reset because recent-folders.json was corrupted"
    : undefined;

export const registerRecentFoldersListeners = (
  api: RecentFoldersApi,
  callbacks: RecentFoldersControllerCallbacks
): (() => void) => {
  const removeOpenListener = api.onOpenRecentFolder((nextFolderPath) => {
    callbacks.setFolderInputValue(nextFolderPath);
    void callbacks.openFolder(nextFolderPath);
  });
  const removeChangedListener = api.onRecentFoldersChanged((folders, reason) => {
    callbacks.setRecentFolders(folders);
    const status = recentFoldersStatusForChange(reason);
    if (status) {
      callbacks.setStatus(status);
    }
  });

  void api.getRecentFolders().then(callbacks.setRecentFolders).catch(() => undefined);

  return () => {
    removeOpenListener();
    removeChangedListener();
  };
};

export const useRecentFoldersController = (
  callbacks: RecentFoldersControllerCallbacks
): void => {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    return registerRecentFoldersListeners(window.storyboard, {
      openFolder: (folderPath) => callbacksRef.current.openFolder(folderPath),
      setFolderInputValue: (folderPath) => callbacksRef.current.setFolderInputValue(folderPath),
      setRecentFolders: (folders) => callbacksRef.current.setRecentFolders(folders),
      setStatus: (status) => callbacksRef.current.setStatus(status)
    });
  }, []);
};
