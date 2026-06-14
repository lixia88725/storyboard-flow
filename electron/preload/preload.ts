import { contextBridge, ipcRenderer, webUtils } from "electron";

type ProjectPayload = {
  project: unknown;
  folderPath: string;
  metadataPath: string;
  renamePlan?: unknown[];
  blankShotPreset?: string;
  dirtyShotIds?: string[];
  preserveDirtyShotLayers?: boolean;
};

type LayerAssetPayload = {
  folderPath: string;
  bitmapPath: string;
};

type WriteLayerAssetPayload = LayerAssetPayload & {
  dataUrl: string;
};

type MergeLayerDownPayload = {
  folderPath: string;
  sourceBitmapPath: string;
  targetBitmapPath: string;
  width: number;
  height: number;
  sourceOpacity: number;
  sourceBlendMode: "normal" | "multiply" | "screen";
  targetOpacity: number;
  targetBlendMode: "normal" | "multiply" | "screen";
};

type MergeVisibleLayersPayload = {
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
};

type CopyLayerPngPayload = {
  folderPath: string;
  sourceBitmapPath: string;
  targetBitmapPath: string;
};

type CopyShotAssetsPayload = {
  folderPath: string;
  sourceImagePath: string;
  fileName: string;
  layerCopies: Array<{
    sourceBitmapPath: string;
    targetBitmapPath: string;
  }>;
};

type WorkspaceTaskProgress = {
  kind: "save" | "import" | "open";
  label?: string;
  current: number;
  total: number;
};

type AiResourceMetadata = {
  version: 1;
  resources: Array<{
    fileName: string;
    role: string;
    note: string;
  }>;
};

type AiCredentialStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
  hasValidComfyUiSettings: boolean;
  comfyUi: {
    serverUrl: string;
    workflowJson: string;
    timeoutMs: number;
  };
};

type AiProviderName = "openai" | "seedream" | "comfyui";

type AiGenerateCandidatePayload = {
  folderPath: string;
  project: unknown;
  shotId: string;
  selectedShotContext?: string;
  selectedResourceIds?: string[];
  generationSettings?: {
    provider?: AiProviderName;
    model?: string;
  };
};

type AiGenerateBatchCandidatesPayload = {
  folderPath: string;
  project: unknown;
  shotIds: string[];
  selectedResourceIds?: string[];
  resourceAssignments?: Record<string, string[]>;
  generationSettings?: {
    provider?: AiProviderName;
    model?: string;
  };
};

type AiRequestPreviewPayload = AiGenerateCandidatePayload | AiGenerateBatchCandidatesPayload;

type AiApplyCandidatePayload = {
  folderPath: string;
  project: unknown;
  candidateId: string;
};

const api = {
  openFolderByPath: (folderPath: string) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file),
  selectFolder: () =>
    ipcRenderer.invoke("dialog:selectFolder") as Promise<string | undefined>,
  inspectStoryboardScript: (sourceMarkdownPath: string) =>
    ipcRenderer.invoke("workspace:inspectStoryboardScript", sourceMarkdownPath) as Promise<{
      fileName: string;
      entryCount: number;
    }>,
  createFromStoryboardScript: (payload: {
    sourceMarkdownPath: string;
    targetFolderPath: string;
    blankShotPreset?: string;
  }) => ipcRenderer.invoke("workspace:createFromStoryboardScript", payload),
  autosaveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:autosave", payload) as Promise<ProjectPayload>,
  ensureLayerAssets: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:ensureLayerAssets", payload) as Promise<ProjectPayload>,
  saveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:save", payload) as Promise<ProjectPayload>,
  exportPhotoshopTiffs: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:exportPhotoshopTiffs", payload) as Promise<{
      exportFolderPath: string;
      exportedFiles: string[];
    }>,
  importSwbFormat: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:importSwbFormat", payload),
  checkStoryboardScript: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:checkStoryboardScript", payload) as Promise<{ scriptImportNeeded: boolean }>,
  checkExternalChanges: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:checkExternalChanges", payload) as Promise<{
      images: unknown[];
      scriptImportNeeded: boolean;
    }>,
  watchWorkspaceFolder: async (
    folderPath: string,
    callback: (change: { folderPath: string; fileName: string }) => void
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, change: { folderPath: string; fileName: string }) =>
      callback(change);
    ipcRenderer.on("workspace:folderChanged", listener);
    const watcherId = (await ipcRenderer.invoke("workspace:startFolderWatch", folderPath)) as number;
    return () => {
      ipcRenderer.removeListener("workspace:folderChanged", listener);
      void ipcRenderer.invoke("workspace:stopFolderWatch", watcherId);
    };
  },
  writeLayerPng: (payload: WriteLayerAssetPayload) =>
    ipcRenderer.invoke("layers:writePng", payload) as Promise<WriteLayerAssetPayload & { filePath: string }>,
  readLayerPng: (payload: LayerAssetPayload) =>
    ipcRenderer.invoke("layers:readPng", payload) as Promise<string | undefined>,
  deleteLayerPng: (payload: LayerAssetPayload) =>
    ipcRenderer.invoke("layers:deletePng", payload) as Promise<LayerAssetPayload>,
  copyLayerPng: (payload: CopyLayerPngPayload) =>
    ipcRenderer.invoke("layers:copyPng", payload) as Promise<CopyLayerPngPayload & { targetFilePath: string }>,
  copyShotAssets: (payload: CopyShotAssetsPayload) =>
    ipcRenderer.invoke("workspace:copyShotAssets", payload) as Promise<
      CopyShotAssetsPayload & { imagePath: string; fileName: string; previewPath: string }
    >,
  mergeLayerDown: (payload: MergeLayerDownPayload) =>
    ipcRenderer.invoke("layers:mergeDown", payload) as Promise<MergeLayerDownPayload & { targetFilePath: string }>,
  mergeVisibleLayers: (payload: MergeVisibleLayersPayload) =>
    ipcRenderer.invoke("layers:mergeVisible", payload) as Promise<MergeVisibleLayersPayload & { targetFilePath: string }>,
  createBlankShot: (folderPath: string, options: unknown) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  getRecentFolders: () => ipcRenderer.invoke("recent:getFolders") as Promise<string[]>,
  getToolRadialMenu: () => ipcRenderer.invoke("settings:getToolRadialMenu") as Promise<unknown>,
  setToolRadialMenu: (config: unknown) =>
    ipcRenderer.invoke("settings:setToolRadialMenu", config) as Promise<unknown>,
  ai: {
    getSettings: () =>
      ipcRenderer.invoke("ai:getSettings") as Promise<AiCredentialStatus>,
    saveOpenAiApiKey: (apiKey: string) =>
      ipcRenderer.invoke("ai:saveOpenAiApiKey", apiKey) as Promise<AiCredentialStatus>,
    clearOpenAiApiKey: () =>
      ipcRenderer.invoke("ai:clearOpenAiApiKey") as Promise<AiCredentialStatus>,
    saveSeedreamApiKey: (apiKey: string) =>
      ipcRenderer.invoke("ai:saveSeedreamApiKey", apiKey) as Promise<AiCredentialStatus>,
    clearSeedreamApiKey: () =>
      ipcRenderer.invoke("ai:clearSeedreamApiKey") as Promise<AiCredentialStatus>,
    saveComfyUiSettings: (settings: { serverUrl: string; workflowJson: string; timeoutMs: number }) =>
      ipcRenderer.invoke("ai:saveComfyUiSettings", settings) as Promise<AiCredentialStatus>,
    testComfyUiConnection: (serverUrl: string) =>
      ipcRenderer.invoke("ai:testComfyUiConnection", serverUrl) as Promise<{ ok: boolean; message: string }>,
    listResources: (folderPath: string) =>
      ipcRenderer.invoke("ai:listResources", folderPath) as Promise<unknown>,
    importResources: (folderPath: string, sourceFilePaths: string[]) =>
      ipcRenderer.invoke("ai:importResources", folderPath, sourceFilePaths) as Promise<unknown>,
    deleteResource: (folderPath: string, fileName: string) =>
      ipcRenderer.invoke("ai:deleteResource", folderPath, fileName) as Promise<unknown>,
    updateResourceMetadata: (folderPath: string, metadata: AiResourceMetadata) =>
      ipcRenderer.invoke("ai:updateResourceMetadata", folderPath, metadata) as Promise<unknown>,
    generateCandidate: (payload: AiGenerateCandidatePayload) =>
      ipcRenderer.invoke("ai:generateCandidate", payload) as Promise<unknown>,
    generateBatchCandidates: (payload: AiGenerateBatchCandidatesPayload) =>
      ipcRenderer.invoke("ai:generateBatchCandidates", payload) as Promise<unknown>,
    copyRequestPreview: (payload: AiRequestPreviewPayload) =>
      ipcRenderer.invoke("ai:copyRequestPreview", payload) as Promise<{ text: string }>,
    discardCandidate: (folderPath: string, candidateId: string) =>
      ipcRenderer.invoke("ai:discardCandidate", folderPath, candidateId) as Promise<void>,
    applyCandidate: (payload: AiApplyCandidatePayload) =>
      ipcRenderer.invoke("ai:applyCandidate", payload) as Promise<unknown>
  },
  onOpenRecentFolder: (callback: (folderPath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, folderPath: string) => callback(folderPath);
    ipcRenderer.on("recent:openFolder", listener);
    return () => ipcRenderer.removeListener("recent:openFolder", listener);
  },
  onRecentFoldersChanged: (callback: (folders: string[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, folders: string[]) => callback(folders);
    ipcRenderer.on("recent:foldersChanged", listener);
    return () => ipcRenderer.removeListener("recent:foldersChanged", listener);
  },
  onWorkspaceTaskProgress: (callback: (progress: WorkspaceTaskProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: WorkspaceTaskProgress) =>
      callback(progress);
    ipcRenderer.on("workspace:taskProgress", listener);
    return () => ipcRenderer.removeListener("workspace:taskProgress", listener);
  },
  onSaveAndCloseRequested: (callback: (request: { requestId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { requestId: string }) =>
      callback(request);
    ipcRenderer.on("app:saveAndClose", listener);
    return () => ipcRenderer.removeListener("app:saveAndClose", listener);
  },
  finishSaveAndClose: (payload: { requestId: string; saved: boolean }) =>
    ipcRenderer.invoke("app:finishSaveAndClose", payload) as Promise<void>,
  updateCloseGuard: (payload: { hasUnsavedChanges: boolean }) =>
    ipcRenderer.invoke("app:updateCloseGuard", payload) as Promise<void>,
  getAppInfo: () =>
    ipcRenderer.invoke("app:getInfo") as Promise<{
      version: string;
      platform: NodeJS.Platform;
      arch: NodeJS.Architecture;
      updateManifestUrl: string;
    }>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("app:openExternal", url) as Promise<void>,
  assetUrl: (filePath: string) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`
};

contextBridge.exposeInMainWorld("storyboard", api);
