const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('flowEditor', {
  open: () => ipcRenderer.invoke('flow-editor:open'),
  read: id => ipcRenderer.invoke('flow-editor:read', id),
  put: input => ipcRenderer.invoke('flow-editor:put', input),
  saveTiff: project => ipcRenderer.invoke('flow-editor:saveTiff', project),
  checkpoint: project => ipcRenderer.invoke('flow-editor:checkpoint', project),
  onClose: listener => { const handler = (_event, id) => listener(id); ipcRenderer.on('flow-editor:close', handler); return () => ipcRenderer.removeListener('flow-editor:close', handler); },
  finishClose: (id, project) => ipcRenderer.invoke('flow-editor:finish-close', id, project)
});
