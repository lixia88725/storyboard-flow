import type {
  BlankShotOptions,
  FolderScanPayload,
  ImportSwbFormatPayload,
  ImportedImage,
  Project,
  RenamePlanItem,
  WorkspacePayload
} from "../shared/types";

declare global {
  interface Window {
    storyboard: {
      openFolderByPath: (folderPath: string) => Promise<FolderScanPayload>;
      autosaveWorkspace: (payload: WorkspacePayload) => Promise<WorkspacePayload>;
      saveWorkspace: (
        payload: WorkspacePayload & { renamePlan?: RenamePlanItem[] }
      ) => Promise<WorkspacePayload>;
      importSwbFormat: (payload: ImportSwbFormatPayload) => Promise<FolderScanPayload>;
      writeLayerPng: (payload: {
        folderPath: string;
        bitmapPath: string;
        dataUrl: string;
      }) => Promise<{ folderPath: string; bitmapPath: string; dataUrl: string; filePath: string }>;
      readLayerPng: (payload: { folderPath: string; bitmapPath: string }) => Promise<string | undefined>;
      deleteLayerPng: (payload: {
        folderPath: string;
        bitmapPath: string;
      }) => Promise<{ folderPath: string; bitmapPath: string }>;
      createBlankShot: (folderPath: string, options: BlankShotOptions) => Promise<ImportedImage>;
      getRecentFolders: () => Promise<string[]>;
      onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
      onRecentFoldersChanged: (callback: (folders: string[]) => void) => () => void;
      assetUrl: (filePath: string) => string;
    };
  }
}

export {};
