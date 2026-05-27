import type {
  FolderScanPayload,
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
      createBlankShot: (folderPath: string) => Promise<ImportedImage>;
      getRecentFolders: () => Promise<string[]>;
      onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
      onRecentFoldersChanged: (callback: (folders: string[]) => void) => () => void;
      assetUrl: (filePath: string) => string;
    };
  }
}

export {};
