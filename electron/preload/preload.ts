import { contextBridge, ipcRenderer } from "electron";

type ProjectPayload = {
  project: unknown;
  folderPath: string;
  metadataPath: string;
  renamePlan?: unknown[];
};

type LayerAssetPayload = {
  folderPath: string;
  bitmapPath: string;
};

type WriteLayerAssetPayload = LayerAssetPayload & {
  dataUrl: string;
};

type WorkspaceTaskProgress = {
  kind: "save" | "import";
  current: number;
  total: number;
};

const api = {
  openFolderByPath: (folderPath: string) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  autosaveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:autosave", payload) as Promise<ProjectPayload>,
  saveWorkspace: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:save", payload) as Promise<ProjectPayload>,
  exportPhotoshopTiffs: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:exportPhotoshopTiffs", payload) as Promise<{
      exportFolderPath: string;
      exportedFiles: string[];
    }>,
  importSwbFormat: (payload: ProjectPayload) =>
    ipcRenderer.invoke("workspace:importSwbFormat", payload),
  writeLayerPng: (payload: WriteLayerAssetPayload) =>
    ipcRenderer.invoke("layers:writePng", payload) as Promise<WriteLayerAssetPayload & { filePath: string }>,
  readLayerPng: (payload: LayerAssetPayload) =>
    ipcRenderer.invoke("layers:readPng", payload) as Promise<string | undefined>,
  deleteLayerPng: (payload: LayerAssetPayload) =>
    ipcRenderer.invoke("layers:deletePng", payload) as Promise<LayerAssetPayload>,
  createBlankShot: (folderPath: string, options: unknown) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  getRecentFolders: () => ipcRenderer.invoke("recent:getFolders") as Promise<string[]>,
  getKeyboardShortcuts: () =>
    ipcRenderer.invoke("settings:getKeyboardShortcuts") as Promise<Record<string, string>>,
  setKeyboardShortcuts: (shortcuts: Record<string, string>) =>
    ipcRenderer.invoke("settings:setKeyboardShortcuts", shortcuts) as Promise<Record<string, string>>,
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
  assetUrl: (filePath: string) => `storyboard-img://asset?path=${encodeURIComponent(filePath)}`
};

contextBridge.exposeInMainWorld("storyboard", api);
