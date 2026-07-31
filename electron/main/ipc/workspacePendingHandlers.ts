import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type WorkspacePendingIpcHandlers = {
  moveShotsToPending: (payload: unknown, shotIds: string[]) => unknown;
  restoreShotsFromPending: (payload: unknown, shotIds: string[]) => unknown;
};

export const registerWorkspacePendingIpcHandlers = (
  ipcMain: IpcMainLike,
  handlers: WorkspacePendingIpcHandlers
): void => {
  ipcMain.handle(
    "workspace:moveShotsToPending",
    async (_event, payload: unknown, shotIds: string[]) =>
      handlers.moveShotsToPending(payload, shotIds)
  );
  ipcMain.handle(
    "workspace:restoreShotsFromPending",
    async (_event, payload: unknown, shotIds: string[]) =>
      handlers.restoreShotsFromPending(payload, shotIds)
  );
};
