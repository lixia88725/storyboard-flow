import type {
  BlankShotOptions,
  FolderScanPayload,
  ImportSwbFormatPayload,
  ImportedImage,
  Project,
  RenamePlanItem,
  WorkspacePayload
} from "../shared/types";

type WorkspaceTaskProgress = {
  kind: "save" | "import" | "open";
  label?: string;
  current: number;
  total: number;
};

declare global {
  interface Window {
    storyboard: {
      openFolderByPath: (folderPath: string) => Promise<FolderScanPayload>;
      filePathForDroppedFile: (file: File) => string;
      selectFolder: () => Promise<string | undefined>;
      inspectStoryboardScript: (sourceMarkdownPath: string) => Promise<{
        fileName: string;
        entryCount: number;
      }>;
      createFromStoryboardScript: (payload: {
        sourceMarkdownPath: string;
        targetFolderPath: string;
        blankShotPreset?: BlankShotOptions["preset"];
      }) => Promise<FolderScanPayload>;
      autosaveWorkspace: (payload: WorkspacePayload) => Promise<WorkspacePayload>;
      ensureLayerAssets: (payload: WorkspacePayload) => Promise<WorkspacePayload>;
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
      watchWorkspaceFolder: (
        folderPath: string,
        callback: (change: { folderPath: string; fileName: string }) => void
      ) => Promise<() => void>;
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
      copyLayerPng: (payload: {
        folderPath: string;
        sourceBitmapPath: string;
        targetBitmapPath: string;
      }) => Promise<{
        folderPath: string;
        sourceBitmapPath: string;
        targetBitmapPath: string;
        targetFilePath: string;
      }>;
      copyShotAssets: (payload: {
        folderPath: string;
        sourceImagePath: string;
        fileName: string;
        layerCopies: Array<{
          sourceBitmapPath: string;
          targetBitmapPath: string;
        }>;
      }) => Promise<{
        folderPath: string;
        sourceImagePath: string;
        fileName: string;
        layerCopies: Array<{
          sourceBitmapPath: string;
          targetBitmapPath: string;
        }>;
        imagePath: string;
        fileName: string;
        previewPath: string;
      }>;
      mergeLayerDown: (payload: {
        folderPath: string;
        sourceBitmapPath: string;
        targetBitmapPath: string;
        width: number;
        height: number;
        sourceOpacity: number;
        sourceBlendMode: "normal" | "multiply" | "screen";
        targetOpacity: number;
        targetBlendMode: "normal" | "multiply" | "screen";
      }) => Promise<{
        folderPath: string;
        sourceBitmapPath: string;
        targetBitmapPath: string;
        width: number;
        height: number;
        sourceOpacity: number;
        sourceBlendMode: "normal" | "multiply" | "screen";
        targetOpacity: number;
        targetBlendMode: "normal" | "multiply" | "screen";
        targetFilePath: string;
      }>;
      mergeVisibleLayers: (payload: {
        folderPath: string;
        targetBitmapPath: string;
        width: number;
        height: number;
        layers: Array<{
          bitmapPath: string;
          opacity: number;
          blendMode: "normal" | "multiply" | "screen";
        }>;
        deleteBitmapPaths: string[];
      }) => Promise<{
        folderPath: string;
        targetBitmapPath: string;
        width: number;
        height: number;
        layers: Array<{
          bitmapPath: string;
          opacity: number;
          blendMode: "normal" | "multiply" | "screen";
        }>;
        deleteBitmapPaths: string[];
        targetFilePath: string;
      }>;
      createBlankShot: (folderPath: string, options: BlankShotOptions) => Promise<ImportedImage>;
      getRecentFolders: () => Promise<string[]>;
      getToolRadialMenu: () => Promise<unknown>;
      setToolRadialMenu: (config: unknown) => Promise<unknown>;
      onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
      onRecentFoldersChanged: (callback: (folders: string[]) => void) => () => void;
      onWorkspaceTaskProgress: (callback: (progress: WorkspaceTaskProgress) => void) => () => void;
      onSaveAndCloseRequested: (callback: (request: { requestId: string }) => void) => () => void;
      finishSaveAndClose: (payload: { requestId: string; saved: boolean }) => Promise<void>;
      updateCloseGuard: (payload: { hasUnsavedChanges: boolean }) => Promise<void>;
      assetUrl: (filePath: string) => string;
    };
  }
}

export {};
