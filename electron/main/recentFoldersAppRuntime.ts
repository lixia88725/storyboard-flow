import { Menu, type MenuItemConstructorOptions } from "electron";
import {
  createRecentFoldersRuntime,
  type RecentFoldersRuntimeOptions
} from "./recentFoldersRuntime.js";
import type { RecentFoldersChangedSender, RecentFoldersMenuItem } from "./recentFolders.js";
import type { RecentIpcHandlers } from "./ipc/recentHandlers.js";

export type RecentFoldersAppRuntimeOptions<ApplicationMenu> = {
  buildApplicationMenu?: (template: RecentFoldersMenuItem[]) => ApplicationMenu;
  getSender: () => RecentFoldersChangedSender | undefined;
  isDarwin?: boolean;
  onOpenFolder: (folderPath: string) => void;
  readWithRecovery: RecentFoldersRuntimeOptions<ApplicationMenu>["readWithRecovery"];
  setApplicationMenu?: (menu: ApplicationMenu) => void;
  userDataPath: () => string;
  writeFolders: RecentFoldersRuntimeOptions<ApplicationMenu>["writeFolders"];
};

export const createRecentFoldersAppRuntime = <ApplicationMenu = Electron.Menu>({
  buildApplicationMenu = (template) =>
    Menu.buildFromTemplate(template as MenuItemConstructorOptions[]) as ApplicationMenu,
  getSender,
  isDarwin = process.platform === "darwin",
  onOpenFolder,
  readWithRecovery,
  setApplicationMenu = (menu) => Menu.setApplicationMenu(menu as Electron.Menu),
  userDataPath,
  writeFolders
}: RecentFoldersAppRuntimeOptions<ApplicationMenu>) =>
  createRecentFoldersRuntime({
    buildApplicationMenu,
    corruptReason: "recent-folders-corrupt",
    getSender,
    isDarwin,
    maxRecentFolders: 10,
    onOpenFolder,
    readWithRecovery,
    setApplicationMenu,
    userDataPath,
    writeFolders
  });

export type RecentFoldersAppHandlersOptions = {
  read: () => Promise<string[]>;
  flushChangedFolders: () => void;
};

export const createRecentFoldersAppHandlers = ({
  read,
  flushChangedFolders
}: RecentFoldersAppHandlersOptions): RecentIpcHandlers => ({
  getFolders: async () => {
    const folders = await read();
    flushChangedFolders();
    return folders;
  }
});
