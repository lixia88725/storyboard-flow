import {
  scanWorkspaceFolder,
  type FolderScanResult,
  type FolderScanServiceOptions
} from "./folderScanService.js";
import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";

export type WorkspaceFolderScanner<Project, ImportedImage> = (
  folderPath: string,
  onProgress?: WorkspaceTaskProgressReporter
) => Promise<FolderScanResult<Project, ImportedImage>>;

export const scanFolderForApp = <Project, ImportedImage>(
  folderPath: string,
  onProgress: WorkspaceTaskProgressReporter | undefined,
  options: FolderScanServiceOptions<Project, ImportedImage>
): Promise<FolderScanResult<Project, ImportedImage>> =>
  scanWorkspaceFolder<Project, ImportedImage>(folderPath, onProgress, options);

export const createWorkspaceFolderScanner =
  <Project, ImportedImage>(
    options: FolderScanServiceOptions<Project, ImportedImage>
  ): WorkspaceFolderScanner<Project, ImportedImage> =>
  (folderPath, onProgress) =>
    scanFolderForApp(folderPath, onProgress, options);
