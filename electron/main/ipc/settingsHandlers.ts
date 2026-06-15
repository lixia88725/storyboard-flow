import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type SettingsIpcHandlers = {
  getToolRadialMenu: () => unknown;
  setToolRadialMenu: (config: unknown) => unknown;
};

export const registerSettingsIpcHandlers = (
  ipcMain: IpcMainLike,
  handlers: SettingsIpcHandlers
): void => {
  ipcMain.handle("settings:getToolRadialMenu", async () => handlers.getToolRadialMenu());
  ipcMain.handle("settings:setToolRadialMenu", async (_event, config: unknown) =>
    handlers.setToolRadialMenu(config)
  );
};
