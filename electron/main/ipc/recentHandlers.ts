import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type RecentIpcHandlers = {
  getFolders: () => unknown;
};

export const registerRecentIpcHandlers = (ipcMain: IpcMainLike, handlers: RecentIpcHandlers): void => {
  ipcMain.handle("recent:getFolders", async () => handlers.getFolders());
};
