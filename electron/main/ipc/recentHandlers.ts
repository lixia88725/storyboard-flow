import type { IpcMain } from "electron";
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

type IpcMainLike = Pick<IpcMain, "handle">;

export type RecentIpcHandlers = {
  getFolders: () => unknown;
  rememberFolder?: (folderPath: string) => Promise<void>;
};

export const registerRecentIpcHandlers = (ipcMain: IpcMainLike, handlers: RecentIpcHandlers): void => {
  ipcMain.handle("recent:getFolders", async () => handlers.getFolders());
  if (handlers.rememberFolder) ipcMain.handle('recent:rememberOpenedFolder', async (event, requested: string) => {
    if (!event.sender || event.senderFrame !== event.sender.mainFrame) throw Error('Recent folder requires the current window');
    if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw Error('Invalid folder path');
    const physical = await realpath(requested);
    if (!(await stat(physical)).isDirectory()) throw Error('Recent folder must be a directory');
    await handlers.rememberFolder!(physical);
  });
};
