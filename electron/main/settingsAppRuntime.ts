import type { SettingsIpcHandlers } from "./ipc/settingsHandlers.js";

export type SettingsAppRuntimeOptions = {
  readToolRadialMenu: () => unknown;
  writeToolRadialMenu: (config: unknown) => unknown;
};

export const createSettingsAppHandlers = ({
  readToolRadialMenu,
  writeToolRadialMenu
}: SettingsAppRuntimeOptions): SettingsIpcHandlers => ({
  getToolRadialMenu: readToolRadialMenu,
  setToolRadialMenu: writeToolRadialMenu
});
