import type { IpcMain, IpcMainInvokeEvent } from "electron";

import type { NormalSaveOpenOptions } from "../../normalSaveTransport.js";

type IpcMainLike = Pick<IpcMain, "handle">;

type FolderScanLike = {
  folderPath: string;
};

export type WorkspaceOpenIpcHandlers<Sender, Progress, FolderScan extends FolderScanLike> = {
  pathExists: (folderPath: string) => Promise<boolean>;
  removeRecentFolder: (folderPath: string) => unknown;
  createProgressReporter: (sender: Sender, mode: "open") => Progress;
  scanFolder: (folderPath: string, progress: Progress, options?: NormalSaveOpenOptions) => Promise<FolderScan>;
  addRecentFolder: (folderPath: string) => unknown;
};

export const registerWorkspaceOpenIpcHandlers = <
  Sender,
  Progress,
  FolderScan extends FolderScanLike
>(
  ipcMain: IpcMainLike,
  handlers: WorkspaceOpenIpcHandlers<Sender, Progress, FolderScan>
): void => {
  ipcMain.handle("workspace:openFolderByPath", async (event: IpcMainInvokeEvent, folderPath: string, options?: NormalSaveOpenOptions) => {
    if (!(await handlers.pathExists(folderPath))) {
      await handlers.removeRecentFolder(folderPath);
      throw new Error(`Folder does not exist: ${folderPath}`);
    }

    const progress = handlers.createProgressReporter(event.sender as Sender, "open");
    const scan = options?.normalSave === true
      ? await handlers.scanFolder(folderPath, progress, { normalSave: true, recoverPending: options.recoverPending === true, ...(options.initializePreviews === true ? { initializePreviews: true } : {}) })
      : await handlers.scanFolder(folderPath, progress);
    await handlers.addRecentFolder(scan.folderPath);
    return scan;
  });
};
