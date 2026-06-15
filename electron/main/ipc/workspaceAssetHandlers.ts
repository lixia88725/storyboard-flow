import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type WorkspaceAssetIpcHandlers = {
  copyShotAssets: (payload: unknown) => unknown;
};

export const registerWorkspaceAssetIpcHandlers = (
  ipcMain: IpcMainLike,
  handlers: WorkspaceAssetIpcHandlers
): void => {
  ipcMain.handle("workspace:copyShotAssets", async (_event, payload: unknown) =>
    handlers.copyShotAssets(payload)
  );
};
