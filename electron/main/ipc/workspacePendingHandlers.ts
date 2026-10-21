import type { IpcMain } from "electron";
import { workspaceEffectFailure } from "../workspaceEffectFailure.js";

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
    async (_event, payload: unknown, shotIds: string[]) => {
      try { return await handlers.moveShotsToPending(payload, shotIds); }
      catch (error) { return workspaceEffectFailure(error, "pending"); }
    }
  );
  ipcMain.handle(
    "workspace:restoreShotsFromPending",
    async (_event, payload: unknown, shotIds: string[]) => {
      try { return await handlers.restoreShotsFromPending(payload, shotIds); }
      catch (error) { return workspaceEffectFailure(error, "pending"); }
    }
  );
};
