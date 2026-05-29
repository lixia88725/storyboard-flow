const { contextBridge, ipcRenderer } = require("electron");

const api = {
  openFolderByPath: (folderPath) => ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  autosaveWorkspace: (payload) => ipcRenderer.invoke("workspace:autosave", payload),
  saveWorkspace: (payload) => ipcRenderer.invoke("workspace:save", payload),
  importSwbFormat: (payload) => ipcRenderer.invoke("workspace:importSwbFormat", payload),
  writeLayerPng: (payload) => ipcRenderer.invoke("layers:writePng", payload),
  readLayerPng: (payload) => ipcRenderer.invoke("layers:readPng", payload),
  deleteLayerPng: (payload) => ipcRenderer.invoke("layers:deletePng", payload),
  createBlankShot: (folderPath, options) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  getRecentFolders: () => ipcRenderer.invoke("recent:getFolders"),
  getKeyboardShortcuts: () => ipcRenderer.invoke("settings:getKeyboardShortcuts"),
  setKeyboardShortcuts: (shortcuts) => ipcRenderer.invoke("settings:setKeyboardShortcuts", shortcuts),
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
  assetUrl: (filePath) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`
};

contextBridge.exposeInMainWorld("storyboard", api);
