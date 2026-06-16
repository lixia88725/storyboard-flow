import type { WorkspaceOpenIpcHandlers } from "./ipc/workspaceOpenHandlers.js";

type FolderScanLike = {
  folderPath: string;
};

export type WorkspaceOpenAppRuntimeOptions<Sender, Progress, FolderScan extends FolderScanLike> = {
  addRecentFolder: (folderPath: string) => unknown;
  createProgressReporter: (sender: Sender, mode: "open") => Progress;
  pathExists: (folderPath: string) => Promise<boolean>;
  removeRecentFolder: (folderPath: string) => unknown;
  scanFolder: (folderPath: string, progress: Progress) => Promise<FolderScan>;
};

export const createWorkspaceOpenAppHandlers = <
  Sender,
  Progress,
  FolderScan extends FolderScanLike
>({
  addRecentFolder,
  createProgressReporter,
  pathExists,
  removeRecentFolder,
  scanFolder
}: WorkspaceOpenAppRuntimeOptions<Sender, Progress, FolderScan>): WorkspaceOpenIpcHandlers<
  Sender,
  Progress,
  FolderScan
> => ({
  addRecentFolder,
  createProgressReporter,
  pathExists,
  removeRecentFolder,
  scanFolder
});
