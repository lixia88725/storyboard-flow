import { contextBridge, ipcRenderer } from "electron";

type ProjectPayload = {
  project: unknown;
  folderPath: string;
  metadataPath: string;
  renamePlan?: unknown[];
};

const api = {
  openFolderByPath: (folderPath: string) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  autosaveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:autosave", payload) as Promise<ProjectPayload>,
  saveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:save", payload) as Promise<ProjectPayload>,
  importSwbFormat: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:importSwbFormat", payload),
  createBlankShot: (folderPath: string, options: unknown) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  getRecentFolders: () => ipcRenderer.invoke("recent:getFolders") as Promise<string[]>,
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
  assetUrl: (filePath: string) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`
};

contextBridge.exposeInMainWorld("storyboard", api);
