import type {
  BlankShotOptions,
  BitmapLayer,
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
      ai: {
        getSettings: () => Promise<{
          hasOpenAiApiKey: boolean;
          hasSeedreamApiKey: boolean;
        }>;
        saveOpenAiApiKey: (apiKey: string) => Promise<{
          hasOpenAiApiKey: boolean;
          hasSeedreamApiKey: boolean;
        }>;
        clearOpenAiApiKey: () => Promise<{
          hasOpenAiApiKey: boolean;
          hasSeedreamApiKey: boolean;
        }>;
        saveSeedreamApiKey: (apiKey: string) => Promise<{
          hasOpenAiApiKey: boolean;
          hasSeedreamApiKey: boolean;
        }>;
        clearSeedreamApiKey: () => Promise<{
          hasOpenAiApiKey: boolean;
          hasSeedreamApiKey: boolean;
        }>;
        listResources: (folderPath: string) => Promise<{
          resourcesFolderPath: string;
          metadataPath: string;
          resources: Array<{
            id: string;
            fileName: string;
            filePath: string;
            role: string;
            note: string;
          }>;
        }>;
        importResources: (folderPath: string, sourceFilePaths: string[]) => Promise<{
          resourcesFolderPath: string;
          metadataPath: string;
          importedFileNames: string[];
          resources: Array<{
            id: string;
            fileName: string;
            filePath: string;
            role: string;
            note: string;
          }>;
        }>;
        deleteResource: (folderPath: string, fileName: string) => Promise<{
          resourcesFolderPath: string;
          metadataPath: string;
          resources: Array<{
            id: string;
            fileName: string;
            filePath: string;
            role: string;
            note: string;
          }>;
        }>;
        updateResourceMetadata: (
          folderPath: string,
          metadata: {
            version: 1;
            resources: Array<{ fileName: string; role: string; note: string }>;
          }
        ) => Promise<unknown>;
        generateCandidate: (payload: {
          folderPath: string;
          project: Project;
          shotId: string;
          selectedShotContext?: string;
          selectedResourceIds?: string[];
          generationSettings?: {
            provider?: "openai" | "seedream";
            model?: string;
          };
        }) => Promise<{
          id: string;
          shotId: string;
          bitmapPath: string;
          filePath: string;
          width: number;
          height: number;
          prompt: string;
          createdAt: string;
        }>;
        generateBatchCandidates: (payload: {
          folderPath: string;
          project: Project;
          shotIds: string[];
          selectedResourceIds?: string[];
          resourceAssignments?: Record<string, string[]>;
          generationSettings?: {
            provider?: "openai" | "seedream";
            model?: string;
          };
        }) => Promise<{
          groups: Array<{
            index: number;
            shotIds: string[];
            candidateIds: string[];
            error?: string;
          }>;
          candidates: Array<{
            id: string;
            shotId: string;
            bitmapPath: string;
            filePath: string;
            width: number;
            height: number;
            prompt: string;
            createdAt: string;
          }>;
        }>;
        copyRequestPreview: (payload: {
          folderPath: string;
          project: Project;
          shotId?: string;
          shotIds?: string[];
          selectedShotContext?: string;
          selectedResourceIds?: string[];
          resourceAssignments?: Record<string, string[]>;
          generationSettings?: {
            provider?: "openai" | "seedream";
            model?: string;
          };
        }) => Promise<{ text: string }>;
        discardCandidate: (folderPath: string, candidateId: string) => Promise<void>;
        applyCandidate: (payload: {
          folderPath: string;
          project: Project;
          candidateId: string;
        }) => Promise<{ project: Project; layer: BitmapLayer }>;
      };
      onOpenRecentFolder: (callback: (folderPath: string) => void) => () => void;
      onRecentFoldersChanged: (callback: (folders: string[]) => void) => () => void;
      onWorkspaceTaskProgress: (callback: (progress: WorkspaceTaskProgress) => void) => () => void;
      onSaveAndCloseRequested: (callback: (request: { requestId: string }) => void) => () => void;
      finishSaveAndClose: (payload: { requestId: string; saved: boolean }) => Promise<void>;
      updateCloseGuard: (payload: { hasUnsavedChanges: boolean }) => Promise<void>;
      getAppInfo: () => Promise<{
        version: string;
        platform: NodeJS.Platform;
        arch: NodeJS.Architecture;
        updateManifestUrl: string;
      }>;
      openExternal: (url: string) => Promise<void>;
      assetUrl: (filePath: string) => string;
    };
  }
}

export {};
