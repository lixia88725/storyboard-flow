export const normalizeRecentFolders = (folders: string[], maxRecentFolders: number): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const folder of folders) {
    const trimmedFolder = folder.trim();
    if (!trimmedFolder || seen.has(trimmedFolder)) {
      continue;
    }

    seen.add(trimmedFolder);
    normalized.push(trimmedFolder);

    if (normalized.length === maxRecentFolders) {
      break;
    }
  }

  return normalized;
};

export const addRecentFolderPath = (
  folders: string[],
  folderPath: string,
  maxRecentFolders: number
): string[] => {
  return normalizeRecentFolders([folderPath, ...folders], maxRecentFolders);
};

export const removeRecentFolderPath = (folders: string[], folderPath: string): string[] => {
  return folders.filter((folder) => folder !== folderPath);
};

export type RecentFoldersMenuItem = {
  label?: string;
  role?:
    | "appMenu"
    | "editMenu"
    | "viewMenu"
    | "windowMenu"
    | "reload"
    | "forceReload"
    | "toggleDevTools"
    | "togglefullscreen";
  enabled?: boolean;
  submenu?: RecentFoldersMenuItem[];
  click?: () => void;
};

export const buildRecentFoldersMenuTemplate = (
  recentFolders: string[],
  options: {
    isDarwin: boolean;
    onOpenFolder: (folderPath: string) => void;
  }
): RecentFoldersMenuItem[] => {
  const submenu = [
    {
      label: "Open Recent",
      submenu:
        recentFolders.length > 0
          ? recentFolders.map((folderPath) => ({
              label: folderPath,
              click: () => options.onOpenFolder(folderPath)
            }))
          : [{ label: "No Recent Folders", enabled: false }]
    }
  ];

  return [
    ...(options.isDarwin ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" }
  ];
};

export type RecentFoldersChangedSender = {
  send: (channel: "recent:foldersChanged", folders: string[], reason?: string) => void;
};

export const createRecentFoldersChangeNotifier = (
  getSender: () => RecentFoldersChangedSender | undefined
) => {
  let pending: { folders: string[]; reason: string } | undefined;

  const notify = (folders: string[], reason?: string): void => {
    const sender = getSender();
    if (!sender) {
      if (reason) {
        pending = { folders, reason };
      }
      return;
    }
    sender.send("recent:foldersChanged", folders, reason);
  };

  const flush = (): void => {
    const sender = getSender();
    if (!sender || !pending) {
      return;
    }
    const nextPending = pending;
    pending = undefined;
    sender.send("recent:foldersChanged", nextPending.folders, nextPending.reason);
  };

  return { notify, flush };
};

export type RecentFoldersControllerOptions = {
  maxRecentFolders: number;
  userDataPath: () => string;
  readWithRecovery: (
    userDataPath: string,
    maxRecentFolders: number
  ) => Promise<{ folders: string[]; recoveredFromCorruptFile: boolean }>;
  writeFolders: (userDataPath: string, folders: string[], maxRecentFolders: number) => Promise<string[]>;
  updateMenu: () => Promise<void>;
  notifyChanged: (folders: string[], reason?: string) => void;
  corruptReason: string;
};

export const createRecentFoldersController = (options: RecentFoldersControllerOptions) => {
  const read = async (): Promise<string[]> => {
    const result = await options.readWithRecovery(options.userDataPath(), options.maxRecentFolders);
    if (result.recoveredFromCorruptFile) {
      await options.updateMenu();
      options.notifyChanged(result.folders, options.corruptReason);
    }
    return result.folders;
  };

  const write = async (folders: string[]): Promise<void> => {
    const nextFolders = await options.writeFolders(options.userDataPath(), folders, options.maxRecentFolders);
    await options.updateMenu();
    options.notifyChanged(nextFolders);
  };

  const add = async (folderPath: string): Promise<void> => {
    const existing = await read();
    const next = addRecentFolderPath(existing, folderPath, options.maxRecentFolders);
    await write(next);
  };

  const remove = async (folderPath: string): Promise<void> => {
    const existing = await read();
    const next = removeRecentFolderPath(existing, folderPath);
    if (next.length !== existing.length) {
      await write(next);
    }
  };

  return { add, read, remove, write };
};
