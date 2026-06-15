import type { IpcMain, IpcMainInvokeEvent } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type AppIpcHandlers = {
  selectFolder: (event: IpcMainInvokeEvent) => unknown;
  finishSaveAndClose: (payload: { requestId: string; saved: boolean }) => unknown;
  updateCloseGuard: (event: IpcMainInvokeEvent, payload: { hasUnsavedChanges: boolean }) => unknown;
  getInfo: () => unknown;
  openExternal: (url: string) => unknown;
};

export const registerAppIpcHandlers = (ipcMain: IpcMainLike, handlers: AppIpcHandlers): void => {
  ipcMain.handle("dialog:selectFolder", async (event) => handlers.selectFolder(event));
  ipcMain.handle("app:finishSaveAndClose", (_event, payload: { requestId: string; saved: boolean }) =>
    handlers.finishSaveAndClose(payload)
  );
  ipcMain.handle("app:updateCloseGuard", (event, payload: { hasUnsavedChanges: boolean }) =>
    handlers.updateCloseGuard(event, payload)
  );
  ipcMain.handle("app:getInfo", () => handlers.getInfo());
  ipcMain.handle("app:openExternal", async (_event, url: string) => handlers.openExternal(url));
};
