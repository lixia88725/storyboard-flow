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
  switchProject: (sessionId, project, target) => ipcRenderer.invoke('flow-editor:switch-project', sessionId, project, target),
  finishClose: (sessionId, id, project) => ipcRenderer.invoke('flow-editor:finish-close', sessionId, id, project),
  launcherState: () => ipcRenderer.invoke('flow-editor:launcher-state'),
  updateRecentName: (sessionId, name) => ipcRenderer.invoke('flow-editor:update-recent-name', sessionId, name),
  removeRecent: id => ipcRenderer.invoke('flow-editor:remove-recent', id),
  relocateRecent: id => ipcRenderer.invoke('flow-editor:relocate-recent', id),
  launch: target => ipcRenderer.invoke('flow-editor:launch', target),
  createDraft: () => ipcRenderer.invoke('flow-editor:create-draft'),
  createChooseSource: (draftId, kind) => ipcRenderer.invoke('flow-editor:create-choose-source', draftId, kind),
  createChooseDestination: draftId => ipcRenderer.invoke('flow-editor:create-choose-destination', draftId),
  createUpdate: (draftId, patch) => ipcRenderer.invoke('flow-editor:create-update', draftId, patch),
  createAbort: draftId => ipcRenderer.invoke('flow-editor:create-abort', draftId),
  createDiscard: draftId => ipcRenderer.invoke('flow-editor:create-discard', draftId),
  respondCreateIssues: (requestId, decision) => ipcRenderer.invoke('flow-editor:create-issues-response', requestId, decision),
  onCreateProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('flow-editor:create-progress', handler);
    return () => { ipcRenderer.removeListener('flow-editor:create-progress', handler); };
  },
  onCreateIssues: listener => {
    const handler = (_event: Electron.IpcRendererEvent, issues: Parameters<typeof listener>[0]) => listener(issues);
    ipcRenderer.on('flow-editor:create-issues', handler);
    return () => { ipcRenderer.removeListener('flow-editor:create-issues', handler); };
  },
  pendingCapability: () => ipcRenderer.invoke('flow-editor:pending-capability'),
  pendingAdd: (sessionId, project, request) => ipcRenderer.invoke('flow-editor:pending-add', sessionId, project, request),
  cancelPendingAdd: (sessionId, operationId) => ipcRenderer.invoke('flow-editor:pending-cancel', sessionId, operationId),
  respondPendingIssues: (requestId, decision) => ipcRenderer.invoke('flow-editor:pending-issues-response', requestId, decision),
  onPendingProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('flow-editor:pending-progress', handler);
    return () => { ipcRenderer.removeListener('flow-editor:pending-progress', handler); };
  },
  onPendingIssues: listener => {
    const handler = (_event: Electron.IpcRendererEvent, issues: Parameters<typeof listener>[0]) => listener(issues);
    ipcRenderer.on('flow-editor:pending-issues', handler);
    return () => { ipcRenderer.removeListener('flow-editor:pending-issues', handler); };
  }
};
contextBridge.exposeInMainWorld('flowEditor', api);
