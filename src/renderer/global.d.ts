import type {
  BlankShotOptions,
  FolderScanPayload,
  ImportSwbFormatPayload,
  ImportedImage,
  Project,
  RenamePlanItem,
  WorkspacePayload
} from "../shared/types";
import type { KeyboardShortcuts } from "./keyboardShortcuts";

type WorkspaceTaskProgress = {
  kind: "save" | "import";
  current: number;
  total: number;
};

declare global {
  interface Window {
    storyboard: {
      openFolderByPath: (folderPath: string) => Promise<FolderScanPayload>;
      autosaveWorkspace: (payload: WorkspacePayload) => Promise<WorkspacePayload>;
      saveWorkspace: (
        payload: WorkspacePayload & { renamePlan?: RenamePlanItem[] }
      ) => Promise<WorkspacePayload>;
      exportPhotoshopTiffs: (payload: WorkspacePayload) => Promise<{
        exportFolderPath: string;
        exportedFiles: string[];
      }>;
      importSwbFormat: (payload: ImportSwbFormatPayload) => Promise<FolderScanPayload>;
      checkStoryboardScript: (
        payload: WorkspacePayload
      ) => Promise<{ scriptImportNeeded: boolean }>;
      checkExternalChanges: (
        payload: WorkspacePayload
      ) => Promise<{ images: ImportedImage[]; scriptImportNeeded: boolean }>;
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
      getKeyboardShortcuts: () => Promise<Partial<KeyboardShortcuts>>;
      setKeyboardShortcuts: (shortcuts: KeyboardShortcuts) => Promise<Partial<KeyboardShortcuts>>;
      onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
      onRecentFoldersChanged: (callback: (folders: string[]) => void) => () => void;
      onWorkspaceTaskProgress: (callback: (progress: WorkspaceTaskProgress) => void) => () => void;
      assetUrl: (filePath: string) => string;
    };
  }
}

export {};
