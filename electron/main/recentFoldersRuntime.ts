import {
  buildRecentFoldersMenuTemplate,
  createRecentFoldersChangeNotifier,
  createRecentFoldersController,
  type RecentFoldersChangedSender,
  type RecentFoldersMenuItem
} from "./recentFolders.js";

export type RecentFoldersRuntimeOptions<ApplicationMenu> = {
  buildApplicationMenu: (template: RecentFoldersMenuItem[]) => ApplicationMenu;
  corruptReason: string;
  getSender: () => RecentFoldersChangedSender | undefined;
  isDarwin: boolean;
  maxRecentFolders: number;
  onOpenFolder: (folderPath: string) => void;
  readWithRecovery: (
    userDataPath: string,
    maxRecentFolders: number
  ) => Promise<{ folders: string[]; recoveredFromCorruptFile: boolean }>;
  setApplicationMenu: (menu: ApplicationMenu) => void;
  userDataPath: () => string;
  writeFolders: (userDataPath: string, folders: string[], maxRecentFolders: number) => Promise<string[]>;
};

export const createRecentFoldersRuntime = <ApplicationMenu>(
  options: RecentFoldersRuntimeOptions<ApplicationMenu>
) => {
  const changeNotifier = createRecentFoldersChangeNotifier(options.getSender);
  const updateMenu = async (): Promise<void> => {
    const { folders: recentFolders } = await options.readWithRecovery(
      options.userDataPath(),
      options.maxRecentFolders
    );
    const template = buildRecentFoldersMenuTemplate(recentFolders, {
      isDarwin: options.isDarwin,
      onOpenFolder: options.onOpenFolder
    });

    options.setApplicationMenu(options.buildApplicationMenu(template));
  };
  const controller = createRecentFoldersController({
    maxRecentFolders: options.maxRecentFolders,
    userDataPath: options.userDataPath,
    readWithRecovery: options.readWithRecovery,
    writeFolders: options.writeFolders,
    updateMenu,
    notifyChanged: (folders, reason) => changeNotifier.notify(folders, reason),
    corruptReason: options.corruptReason
  });

  return {
    add: controller.add,
    flushChangedFolders: changeNotifier.flush,
    read: controller.read,
    remove: controller.remove,
    updateMenu,
    write: controller.write
  };
};
