import type {
  BlankShotOptions,
  BitmapLayer,
  FolderScanPayload,
  ImportSwbFormatPayload,
  ImportedImage,
  Project,
  RenamePlanItem,
  WorkspacePayload,
  SaveWorkspacePayload
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
      openFolderByPath: (folderPath: string, options?: import("../../electron/normalSaveTransport").NormalSaveOpenOptions) => Promise<FolderScanPayload>;
      filePathForDroppedFile: (file: File) => string;
      selectFolder: () => Promise<string | undefined>;
      inspectStoryboardScript: (sourceMarkdownPath: string) => Promise<{
        fileName: string;
        entryCount: number;
      }>;
      createFromStoryboardScript: (payload: {
        normalSave?: boolean;
        normalSaveSource?: WorkspacePayload;
        sourceMarkdownPath: string;
        targetFolderPath: string;
        blankShotPreset?: BlankShotOptions["preset"];
      }) => Promise<FolderScanPayload | import("../../electron/shared/normalSaveImportIpc").NormalSaveImportIpcResult<FolderScanPayload>>;
      readOutputIdentity: (imagePath: string, legacy?: { project: Project; folderPath: string; shotId: string }) => Promise<string>;
      autosaveWorkspace: (payload: WorkspacePayload) => Promise<WorkspacePayload>;
      ensureLayerAssets: (payload: WorkspacePayload) => Promise<WorkspacePayload>;
      saveWorkspace: (
        payload: SaveWorkspacePayload
      ) => Promise<SaveWorkspacePayload>;
      exportPhotoshopTiffs: (payload: WorkspacePayload) => Promise<{
        exportFolderPath: string;
        exportedFiles: string[];
      }>;
      importSwbFormat: (payload: ImportSwbFormatPayload) => Promise<FolderScanPayload | import("../../electron/shared/normalSaveImportIpc").NormalSaveImportIpcResult<FolderScanPayload>>;
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
      createLayerPng: (payload: import("../../electron/main/layerAssetService").CreateLayerAssetPayload) => Promise<import("../../electron/main/layerAssetService").CreateLayerAssetResult>;
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
      moveShotsToPending: (
        payload: WorkspacePayload,
        shotIds: string[]
      ) => Promise<Array<{
        normalSaveOutput?: import("../../electron/normalSaveTransport").NormalSaveOutputAck;
        shotId: string;
        imagePath: string;
        fileName: string;
        baseFingerprint?: string;
      }>>;
      restoreShotsFromPending: (
        payload: WorkspacePayload,
        shotIds: string[]
      ) => Promise<Array<{
        normalSaveOutput?: import("../../electron/normalSaveTransport").NormalSaveOutputAck;
        shotId: string;
        imagePath: string;
        fileName: string;
        baseFingerprint?: string;
      }>>;
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
        sourceIdentities?: import("../../electron/main/mergeSourceCleanup").MergeSourceIdentity[];
        targetDataUrl?: string;
      }>;
      cleanupMergedLayerSources: (payload: import("../../electron/main/mergeSourceCleanup").MergeCleanupPayload) =>
        Promise<{ deleted: string[]; retained: string[]; errors: string[] }>;
      createBlankShot: (folderPath: string, options: BlankShotOptions) => Promise<ImportedImage>;
      getRecentFolders: () => Promise<string[]>;
      getToolRadialMenu: () => Promise<unknown>;
      setToolRadialMenu: (config: unknown) => Promise<unknown>;

      onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
      onRecentFoldersChanged: (
        callback: (folders: string[], reason?: string) => void
      ) => () => void;
      onWorkspaceTaskProgress: (callback: (progress: WorkspaceTaskProgress) => void) => () => void;
      onSaveAndCloseRequested: (callback: (request: { requestId: string }) => void) => () => void;
      finishSaveAndClose: (payload: { requestId: string; saved: boolean }) => Promise<void>;
      updateCloseGuard: (payload: { hasUnsavedChanges: boolean }) => Promise<void>;
      updateBitmapQueueGuard: (payload: { busy: boolean; hasUnsavedChanges: boolean }) => void;
      getAppInfo: () => Promise<{
        version: string;
        platform: NodeJS.Platform;
        arch: NodeJS.Architecture;
        updateManifestUrl: string;
      }>;
      openExternal: (url: string) => Promise<void>;
      assetUrl: (filePath: string) => string;
      layerAssetUrl: (payload: {
        folderPath: string;
        bitmapPath: string;
        revision?: number | string;
      }) => string;
      getRendererPerformanceCounters: () => {
        readLayerPngCalls: number;
      };
    };
  }
}

export {};
