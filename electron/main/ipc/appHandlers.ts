import type { IpcMain, IpcMainInvokeEvent } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type AppIpcHandlers = {
  selectFolder: (event: IpcMainInvokeEvent) => unknown;
  finishSaveAndClose: (payload: { requestId: string; saved: boolean }) => unknown;
  updateCloseGuard: (event: IpcMainInvokeEvent, payload: { hasUnsavedChanges: boolean }) => unknown;
  updateBitmapQueueGuard: (event: Pick<IpcMainInvokeEvent, "sender">, payload: { busy: boolean; hasUnsavedChanges: boolean }) => void;
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

// In-memory only; do not await renderer work in this synchronous barrier.
export const registerAppCloseGuardBarriers = (ipcMain: Pick<IpcMain, "on">, handlers: AppIpcHandlers): void => {
  ipcMain.on("app:updateCloseGuardSync", (event, payload: { hasUnsavedChanges: boolean }) => {
    handlers.updateCloseGuard(event as unknown as IpcMainInvokeEvent, payload);
    event.returnValue = true;
  });
  ipcMain.on("app:updateBitmapQueueGuard", (event, payload: { busy: boolean; hasUnsavedChanges: boolean }) => {
    handlers.updateBitmapQueueGuard(event, payload);
    event.returnValue = true;
  });
};
