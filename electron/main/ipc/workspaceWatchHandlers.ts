import type { IpcMain, IpcMainInvokeEvent } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type WorkspaceWatchIpcHandlers = {
  startFolderWatch: (event: IpcMainInvokeEvent, folderPath: string) => unknown;
  stopFolderWatch: (watcherId: number) => unknown;
};

export const registerWorkspaceWatchIpcHandlers = (
  ipcMain: IpcMainLike,
  handlers: WorkspaceWatchIpcHandlers
): void => {
  ipcMain.handle("workspace:startFolderWatch", (event, folderPath: string) =>
    handlers.startFolderWatch(event, folderPath)
  );
  ipcMain.handle("workspace:stopFolderWatch", (_event, watcherId: number) => {
    handlers.stopFolderWatch(watcherId);
  });
};
