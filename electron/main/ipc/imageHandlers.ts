import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type ImageCreateBlankShotOptions = {
  preset?: "16:9" | "1.85:1" | "9:16" | "2.39:1" | "1.43:1";
};

export type ImageIpcHandlers = {
  createBlankShot: (folderPath: string, options?: ImageCreateBlankShotOptions) => unknown;
};

export const registerImageIpcHandlers = (
  ipcMain: IpcMainLike,
  handlers: ImageIpcHandlers
): void => {
  ipcMain.handle(
    "images:createBlankShot",
    async (_event, folderPath: string, options?: ImageCreateBlankShotOptions) =>
      handlers.createBlankShot(folderPath, options)
  );
};
