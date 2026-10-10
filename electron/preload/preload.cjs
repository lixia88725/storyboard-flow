const { contextBridge, ipcRenderer, webUtils } = require("electron");

let readLayerPngCalls = 0;

// Import failures remain plain data across invoke AND contextBridge. Decode in renderer.

const api = {
  openFolderByPath: (folderPath, options) => ipcRenderer.invoke("workspace:openFolderByPath", folderPath, options),
  filePathForDroppedFile: (file) => webUtils.getPathForFile(file),
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  inspectStoryboardScript: (sourceMarkdownPath) =>
    ipcRenderer.invoke("workspace:inspectStoryboardScript", sourceMarkdownPath),
  // Keep plain business failures as data across contextBridge; renderer decodes them.
  createFromStoryboardScript: (payload) =>
    ipcRenderer.invoke("workspace:createFromStoryboardScript", payload),
  readOutputIdentity: (imagePath, legacy) => ipcRenderer.invoke("workspace:readOutputIdentity", imagePath, legacy),
  autosaveWorkspace: (payload) => ipcRenderer.invoke("workspace:autosave", payload),
  ensureLayerAssets: (payload) => ipcRenderer.invoke("workspace:ensureLayerAssets", payload),
  /** @param {import("../normalSaveTransport").NormalSaveTransport & { project: unknown, folderPath: string, metadataPath: string, renamePlan?: unknown[], dirtyShotIds?: string[] }} payload */
  saveWorkspace: (payload) => ipcRenderer.invoke("workspace:save", payload),
  exportPhotoshopTiffs: (payload) => ipcRenderer.invoke("workspace:exportPhotoshopTiffs", payload),
  importSwbFormat: (payload) => ipcRenderer.invoke("workspace:importSwbFormat", payload),
  checkStoryboardScript: (payload) => ipcRenderer.invoke("workspace:checkStoryboardScript", payload),
  checkExternalChanges: (payload) => ipcRenderer.invoke("workspace:checkExternalChanges", payload),
  watchWorkspaceFolder: async (folderPath, callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on("workspace:folderChanged", listener);
    const watcherId = await ipcRenderer.invoke("workspace:startFolderWatch", folderPath);
    return () => {
      ipcRenderer.removeListener("workspace:folderChanged", listener);
      void ipcRenderer.invoke("workspace:stopFolderWatch", watcherId);
    };
  },
  writeLayerPng: (payload) => ipcRenderer.invoke("layers:writePng", payload),
  createLayerPng: (payload) => ipcRenderer.invoke("layers:createPng", payload),
  cleanupMergedLayerSources: (payload) => ipcRenderer.invoke("layers:cleanupMergeSources", payload),
  readLayerPng: (payload) => {
    readLayerPngCalls += 1;
    return ipcRenderer.invoke("layers:readPng", payload);
  },
  deleteLayerPng: (payload) => ipcRenderer.invoke("layers:deletePng", payload),
  copyLayerPng: (payload) => ipcRenderer.invoke("layers:copyPng", payload),
  copyShotAssets: (payload) => ipcRenderer.invoke("workspace:copyShotAssets", payload),
  moveShotsToPending: (payload, shotIds) =>
    ipcRenderer.invoke("workspace:moveShotsToPending", payload, shotIds),
  restoreShotsFromPending: (payload, shotIds) =>
    ipcRenderer.invoke("workspace:restoreShotsFromPending", payload, shotIds),
  mergeLayerDown: (payload) => ipcRenderer.invoke("layers:mergeDown", payload),
  mergeVisibleLayers: (payload) => ipcRenderer.invoke("layers:mergeVisible", payload),
  createBlankShot: (folderPath, options) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  getRecentFolders: () => ipcRenderer.invoke("recent:getFolders"),
  getToolRadialMenu: () => ipcRenderer.invoke("settings:getToolRadialMenu"),
  setToolRadialMenu: (config) => ipcRenderer.invoke("settings:setToolRadialMenu", config),

  onOpenRecentFolder: (callback) => {
    const listener = (_event, folderPath) => callback(folderPath);
    ipcRenderer.on("recent:openFolder", listener);
    return () => ipcRenderer.removeListener("recent:openFolder", listener);
  },
  onRecentFoldersChanged: (callback) => {
    const listener = (_event, folders, reason) => callback(folders, reason);
    ipcRenderer.on("recent:foldersChanged", listener);
    return () => ipcRenderer.removeListener("recent:foldersChanged", listener);
  },
  onWorkspaceTaskProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("workspace:taskProgress", listener);
    return () => ipcRenderer.removeListener("workspace:taskProgress", listener);
  },
  onSaveAndCloseRequested: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on("app:saveAndClose", listener);
    return () => ipcRenderer.removeListener("app:saveAndClose", listener);
  },
  finishSaveAndClose: (payload) => ipcRenderer.invoke("app:finishSaveAndClose", payload),
  updateCloseGuard: async (payload) => {
    if (ipcRenderer.sendSync("app:updateCloseGuardSync", payload) !== true) throw new Error("Close guard was not acknowledged");
  },
  updateBitmapQueueGuard: (payload) => {
    if (ipcRenderer.sendSync("app:updateBitmapQueueGuard", payload) !== true) throw new Error("Bitmap queue guard was not acknowledged");
  },
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  assetUrl: (filePath) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`,
  layerAssetUrl: (payload) => {
    const { folderPath, bitmapPath, revision } = payload;
    const query = new URLSearchParams({ folderPath, bitmapPath });
    if (revision !== undefined) {
      query.set("revision", String(revision));
    }
    return `storyboard-img://layer?${query.toString()}`;
  },
  getRendererPerformanceCounters: () => ({ readLayerPngCalls })
};

contextBridge.exposeInMainWorld("storyboard", api);
