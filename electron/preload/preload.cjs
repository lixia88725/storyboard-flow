const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  openFolderByPath: (folderPath) => ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  filePathForDroppedFile: (file) => webUtils.getPathForFile(file),
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  inspectStoryboardScript: (sourceMarkdownPath) =>
    ipcRenderer.invoke("workspace:inspectStoryboardScript", sourceMarkdownPath),
  createFromStoryboardScript: (payload) =>
    ipcRenderer.invoke("workspace:createFromStoryboardScript", payload),
  autosaveWorkspace: (payload) => ipcRenderer.invoke("workspace:autosave", payload),
  ensureLayerAssets: (payload) => ipcRenderer.invoke("workspace:ensureLayerAssets", payload),
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
  readLayerPng: (payload) => ipcRenderer.invoke("layers:readPng", payload),
  deleteLayerPng: (payload) => ipcRenderer.invoke("layers:deletePng", payload),
  copyLayerPng: (payload) => ipcRenderer.invoke("layers:copyPng", payload),
  copyShotAssets: (payload) => ipcRenderer.invoke("workspace:copyShotAssets", payload),
  mergeLayerDown: (payload) => ipcRenderer.invoke("layers:mergeDown", payload),
  mergeVisibleLayers: (payload) => ipcRenderer.invoke("layers:mergeVisible", payload),
  createBlankShot: (folderPath, options) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  getRecentFolders: () => ipcRenderer.invoke("recent:getFolders"),
  getToolRadialMenu: () => ipcRenderer.invoke("settings:getToolRadialMenu"),
  setToolRadialMenu: (config) => ipcRenderer.invoke("settings:setToolRadialMenu", config),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings"),
    saveOpenAiApiKey: (apiKey) => ipcRenderer.invoke("ai:saveOpenAiApiKey", apiKey),
    clearOpenAiApiKey: () => ipcRenderer.invoke("ai:clearOpenAiApiKey"),
    saveSeedreamApiKey: (apiKey) => ipcRenderer.invoke("ai:saveSeedreamApiKey", apiKey),
    clearSeedreamApiKey: () => ipcRenderer.invoke("ai:clearSeedreamApiKey"),
    listResources: (folderPath) => ipcRenderer.invoke("ai:listResources", folderPath),
    importResources: (folderPath, sourceFilePaths) =>
      ipcRenderer.invoke("ai:importResources", folderPath, sourceFilePaths),
    deleteResource: (folderPath, fileName) => ipcRenderer.invoke("ai:deleteResource", folderPath, fileName),
    updateResourceMetadata: (folderPath, metadata) =>
      ipcRenderer.invoke("ai:updateResourceMetadata", folderPath, metadata),
    generateCandidate: (payload) => ipcRenderer.invoke("ai:generateCandidate", payload),
    copyRequestPreview: (payload) => ipcRenderer.invoke("ai:copyRequestPreview", payload),
    discardCandidate: (folderPath, candidateId) =>
      ipcRenderer.invoke("ai:discardCandidate", folderPath, candidateId),
    applyCandidate: (payload) => ipcRenderer.invoke("ai:applyCandidate", payload)
  },
  onOpenRecentFolder: (callback) => {
    const listener = (_event, folderPath) => callback(folderPath);
    ipcRenderer.on("recent:openFolder", listener);
    return () => ipcRenderer.removeListener("recent:openFolder", listener);
  },
  onRecentFoldersChanged: (callback) => {
    const listener = (_event, folders) => callback(folders);
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
  updateCloseGuard: (payload) => ipcRenderer.invoke("app:updateCloseGuard", payload),
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  assetUrl: (filePath) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`
};

contextBridge.exposeInMainWorld("storyboard", api);
