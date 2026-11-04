import { contextBridge, ipcRenderer } from 'electron';
import type { FlowEditorBridge } from '../contracts/flowEditor.js';
const api: FlowEditorBridge = {
  open: () => ipcRenderer.invoke('flow-editor:open'),
  read: (sessionId, id) => ipcRenderer.invoke('flow-editor:read', sessionId, id),
  put: (sessionId, input) => ipcRenderer.invoke('flow-editor:put', sessionId, input),
  refresh: (sessionId, project) => ipcRenderer.invoke('flow-editor:refresh', sessionId, project),
  folderStatus: (sessionId, request) => ipcRenderer.invoke('flow-editor:folderStatus', sessionId, request),
  outputNames: (sessionId, project) => ipcRenderer.invoke('flow-editor:outputNames', sessionId, project),
  saveTiff: (sessionId, project) => ipcRenderer.invoke('flow-editor:saveTiff', sessionId, project),
  checkpoint: (sessionId, project) => ipcRenderer.invoke('flow-editor:checkpoint', sessionId, project),
  onClose: listener => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('flow-editor:close', handler);
    return () => { ipcRenderer.removeListener('flow-editor:close', handler); };
  },
  switchProject: (sessionId, project) => ipcRenderer.invoke('flow-editor:switch-project', sessionId, project),
  finishClose: (sessionId, id, project) => ipcRenderer.invoke('flow-editor:finish-close', sessionId, id, project)
};
contextBridge.exposeInMainWorld('flowEditor', api);
