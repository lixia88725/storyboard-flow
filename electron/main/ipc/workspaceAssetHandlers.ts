import type { IpcMain } from "electron";
import { CopyCleanupIncompleteError } from "../copyShotAssetsService.js";
import type { CopyShotAssetsFailure } from "../../shared/copyShotAssetsIpc.js";

type IpcMainLike = Pick<IpcMain, "handle">;

export type WorkspaceAssetIpcHandlers = {
  copyShotAssets: (payload: unknown) => unknown;
};

export const registerWorkspaceAssetIpcHandlers = (
  ipcMain: IpcMainLike,
  handlers: WorkspaceAssetIpcHandlers
): void => {
  ipcMain.handle("workspace:copyShotAssets", async (_event, payload: unknown) => {
    try { return await handlers.copyShotAssets(payload); }
    catch (error) {
      if (!(error instanceof CopyCleanupIncompleteError)) throw error;
      const failure: CopyShotAssetsFailure = { ok: false, error: {
        code: "COPY_RECOVERY_INCOMPLETE", message: error.message,
        retainedEffects: error.retainedEffects.map(item => ({ ...item }))
      } };
      return failure;
    }
  });
};
