import { contextBridge, ipcRenderer, webUtils } from "electron";
import { buildLayerAssetUrl } from "./layerAssetUrl.js";

type BlankShotPreset = "16:9" | "1.85:1" | "9:16" | "2.39:1" | "1.43:1";

type ProjectPayload = import("../normalSaveTransport.js").NormalSaveTransport & {
  project: unknown;
  folderPath: string;
  metadataPath: string;
  renamePlan?: unknown[];
  blankShotPreset?: BlankShotPreset;
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
















type PendingShotFile = {
  normalSaveOutput?: import("../normalSaveTransport.js").NormalSaveOutputAck;
  shotId: string;
  imagePath: string;
  fileName: string;
  baseFingerprint?: string;
};

let readLayerPngCalls = 0;

const api = {
  openFolderByPath: (folderPath: string, options?: import("../normalSaveTransport.js").NormalSaveOpenOptions) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath, options),
  filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file),
  selectFolder: () =>
    ipcRenderer.invoke("dialog:selectFolder") as Promise<string | undefined>,
  inspectStoryboardScript: (sourceMarkdownPath: string) =>
    ipcRenderer.invoke("workspace:inspectStoryboardScript", sourceMarkdownPath) as Promise<{
      fileName: string;
      entryCount: number;
    }>,
  createFromStoryboardScript: (payload: {
    normalSave?: boolean;
    normalSaveSource?: ProjectPayload;
    sourceMarkdownPath: string;
    targetFolderPath: string;
    blankShotPreset?: BlankShotPreset;
  }) => ipcRenderer.invoke("workspace:createFromStoryboardScript", payload),
  readOutputIdentity: (imagePath: string, legacy?: { project: unknown; folderPath: string; shotId: string }) =>
    ipcRenderer.invoke("workspace:readOutputIdentity", imagePath, legacy) as Promise<string>,
  autosaveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:autosave", payload) as Promise<ProjectPayload>,
  ensureLayerAssets: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:ensureLayerAssets", payload) as Promise<ProjectPayload>,
  acknowledgeSave: (payload: {folderPath:string;nonce:string;project:ProjectPayload["project"]}) => ipcRenderer.invoke("recovery:ackSave", payload) as Promise<boolean>,
  observeWorkspace: (folderPath: string) => ipcRenderer.invoke("recovery:observeWorkspace", folderPath) as Promise<{binding:string;folderPath:string;metadataPath:string}>,
  certifyWorkspaceHandoff: (capture: unknown) => ipcRenderer.invoke("recovery:certifyHandoff", capture) as Promise<boolean | {mode:'ordinary-memory';readonly:false}>,
  saveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:save", payload) as Promise<ProjectPayload | import("../shared/workspaceEffectIpc.js").WorkspaceEffectFailure>,
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
  cleanupMergedLayerSources: (payload: import("../main/mergeSourceCleanup.js").MergeCleanupPayload) =>
    ipcRenderer.invoke("layers:cleanupMergeSources", payload) as Promise<{ deleted: string[]; retained: string[]; errors: string[] }>,
  createLayerPng: (payload: import("../main/layerAssetService.js").CreateLayerAssetPayload) =>
    ipcRenderer.invoke("layers:createPng", payload) as Promise<import("../main/layerAssetService.js").CreateLayerAssetResult>,
  readLayerPng: (payload: LayerAssetPayload) => {
    readLayerPngCalls += 1;
    return ipcRenderer.invoke("layers:readPng", payload) as Promise<string | undefined>;
  },
  deleteLayerPng: (payload: LayerAssetPayload) =>
    ipcRenderer.invoke("layers:deletePng", payload) as Promise<LayerAssetPayload>,
  copyLayerPng: (payload: CopyLayerPngPayload) =>
    ipcRenderer.invoke("layers:copyPng", payload) as Promise<CopyLayerPngPayload & { targetFilePath: string }>,
  copyShotAssets: (payload: CopyShotAssetsPayload) =>
    ipcRenderer.invoke("workspace:copyShotAssets", payload) as Promise<
      (CopyShotAssetsPayload & { imagePath: string; fileName: string; previewPath: string }) |
      import("../shared/copyShotAssetsIpc.js").CopyShotAssetsFailure
    >,
  moveShotsToPending: (payload: ProjectPayload, shotIds: string[]) =>
    ipcRenderer.invoke("workspace:moveShotsToPending", payload, shotIds) as Promise<PendingShotFile[] | import("../shared/workspaceEffectIpc.js").WorkspaceEffectFailure>,
  restoreShotsFromPending: (payload: ProjectPayload, shotIds: string[]) =>
    ipcRenderer.invoke("workspace:restoreShotsFromPending", payload, shotIds) as Promise<PendingShotFile[] | import("../shared/workspaceEffectIpc.js").WorkspaceEffectFailure>,
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

  onOpenRecentFolder: (callback: (folderPath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, folderPath: string) => callback(folderPath);
    ipcRenderer.on("recent:openFolder", listener);
    return () => ipcRenderer.removeListener("recent:openFolder", listener);
  },
  onRecentFoldersChanged: (callback: (folders: string[], reason?: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, folders: string[], reason?: string) =>
      callback(folders, reason);
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
  onPrepareCloseRequested: (callback: (request: { requestId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { requestId: string }) => callback(request);
    ipcRenderer.on("app:prepareClose", listener);
    return () => ipcRenderer.removeListener("app:prepareClose", listener);
  },
  onCloseCancelled: (callback: (request: { reason: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { reason: string }) => callback(request);
    ipcRenderer.on("app:closeCancelled", listener);
    return () => ipcRenderer.removeListener("app:closeCancelled", listener);
  },
  readReadonlyRecovery: (folderPath: string) => ipcRenderer.invoke("recovery:readReadonly", folderPath) as Promise<{ state: 'protectedReadable'; revision: string; projectRaw: unknown; effectFacts: unknown; assets: { role: string; dataUrl: string }[] }>,
  finishCloseCapture: (payload: { requestId: string; captureAvailable: boolean; recoveryRequired: boolean; busy: boolean; hasUnsavedChanges: boolean; capture?: unknown }) =>
    ipcRenderer.invoke("app:finishCloseCapture", payload) as Promise<void>,
  finishSaveAndClose: (payload: { requestId: string; saved: boolean }) =>
    ipcRenderer.invoke("app:finishSaveAndClose", payload) as Promise<void>,
  updateCloseGuard: async (payload: { hasUnsavedChanges: boolean; recoveryRequired?: boolean }) => {
    if (ipcRenderer.sendSync("app:updateCloseGuardSync", payload) !== true) throw new Error("Close guard was not acknowledged");
  },
  updateBitmapQueueGuard: (payload: { busy: boolean; hasUnsavedChanges: boolean }) => {
    if (ipcRenderer.sendSync("app:updateBitmapQueueGuard", payload) !== true) throw new Error("Bitmap queue guard was not acknowledged");
  },
  getAppInfo: () =>
    ipcRenderer.invoke("app:getInfo") as Promise<{
      version: string;
      platform: NodeJS.Platform;
      arch: NodeJS.Architecture;
      updateManifestUrl: string;
    }>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("app:openExternal", url) as Promise<void>,
  assetUrl: (filePath: string) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`,
  layerAssetUrl: (payload: LayerAssetPayload & { revision?: number | string }) =>
    buildLayerAssetUrl(payload),
  getRendererPerformanceCounters: () => ({ readLayerPngCalls })
};

contextBridge.exposeInMainWorld("storyboard", api);
