import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type LayerIpcHandlers = {
  cleanupMergeSources: (payload: unknown) => unknown;
  createPng: (payload: unknown) => unknown;
  writePng: (payload: unknown) => unknown;
  readPng: (payload: unknown) => unknown;
  deletePng: (payload: unknown) => unknown;
  copyPng: (payload: unknown) => unknown;
  mergeDown: (payload: unknown) => unknown;
  mergeVisible: (payload: unknown) => unknown;
};

export const registerLayerIpcHandlers = (ipcMain: IpcMainLike, handlers: LayerIpcHandlers): void => {
  ipcMain.handle("layers:cleanupMergeSources", async (_event, payload: unknown) => handlers.cleanupMergeSources(payload));
  ipcMain.handle("layers:createPng", async (_event, payload: unknown) => handlers.createPng(payload));
  ipcMain.handle("layers:writePng", async (_event, payload: unknown) => handlers.writePng(payload));
  ipcMain.handle("layers:readPng", async (_event, payload: unknown) => handlers.readPng(payload));
  ipcMain.handle("layers:deletePng", async (_event, payload: unknown) => handlers.deletePng(payload));
  ipcMain.handle("layers:copyPng", async (_event, payload: unknown) => handlers.copyPng(payload));
  ipcMain.handle("layers:mergeDown", async (_event, payload: unknown) => handlers.mergeDown(payload));
  ipcMain.handle("layers:mergeVisible", async (_event, payload: unknown) =>
    handlers.mergeVisible(payload)
  );
};
