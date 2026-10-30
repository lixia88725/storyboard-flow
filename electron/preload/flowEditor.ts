import { contextBridge, ipcRenderer } from 'electron';
import type { FlowEditorBridge } from '../shared/flowEditor.js';
const api: FlowEditorBridge = {
  open: () => ipcRenderer.invoke('flow-editor:open'),
  read: id => ipcRenderer.invoke('flow-editor:read', id),
  put: input => ipcRenderer.invoke('flow-editor:put', input),
  saveTiff: project => ipcRenderer.invoke('flow-editor:saveTiff', project),
  checkpoint: project => ipcRenderer.invoke('flow-editor:checkpoint', project),
  onClose: listener => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('flow-editor:close', handler);
    return () => { ipcRenderer.removeListener('flow-editor:close', handler); };
  },
  finishClose: (id, project) => ipcRenderer.invoke('flow-editor:finish-close', id, project)
};
contextBridge.exposeInMainWorld('flowEditor', api);
