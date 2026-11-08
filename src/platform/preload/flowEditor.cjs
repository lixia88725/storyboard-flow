const {contextBridge, ipcRenderer} = require('electron');
const listen = (channel, listener) => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('flowEditor', {
  imageWorkspace: {
    bootstrap: () => ipcRenderer.invoke('flow-image-workspace:bootstrap'),
    request: request => ipcRenderer.invoke('flow-image-workspace:request', request),
    input: (owner, input, identity) => ipcRenderer.invoke('flow-image-workspace:input', owner, input, identity),
    waitOperation: (owner, operationId) => ipcRenderer.invoke('flow-image-workspace:wait', owner, operationId),
    thumbnail: (owner, id) => ipcRenderer.invoke('flow-image-workspace:thumbnail', owner, id),
    subscribe: listener => {
      const handler = (_event, event) => listener(event);
      ipcRenderer.on('flow-image-workspace:event', handler);
      return () => { ipcRenderer.removeListener('flow-image-workspace:event', handler); };
    },
    connectFrames: identity => {
      const handler = (event, descriptor) => {
        if (!descriptor || !descriptor.owner || descriptor.nonce !== identity.nonce || descriptor.streamGeneration !== identity.streamGeneration || descriptor.owner.sessionId !== identity.owner.sessionId || descriptor.owner.incarnation !== identity.owner.incarnation || descriptor.owner.workspaceEpoch !== identity.owner.workspaceEpoch) return;
        ipcRenderer.removeListener('flow-image-workspace:port', handler);
        const port = event.ports[0];
        if (port) window.postMessage({ type: 'flow-image-workspace:port', identity: descriptor }, '*', [port]);
      };
      ipcRenderer.on('flow-image-workspace:port', handler);
      return ipcRenderer.invoke('flow-image-workspace:connect', identity).catch(error => {
        ipcRenderer.removeListener('flow-image-workspace:port', handler); throw error;
      });
    }
  },

  open: () => ipcRenderer.invoke('flow-editor:open'),
  read: (sessionId, id) => ipcRenderer.invoke('flow-editor:read', sessionId, id),
  put: (sessionId, input) => ipcRenderer.invoke('flow-editor:put', sessionId, input),
  refresh: (sessionId, project) => ipcRenderer.invoke('flow-editor:refresh', sessionId, project),
  folderStatus: (sessionId, request) => ipcRenderer.invoke('flow-editor:folderStatus', sessionId, request),
  outputNames: (sessionId, project) => ipcRenderer.invoke('flow-editor:outputNames', sessionId, project),
  exportPsd: (sessionId, project, shotId) => ipcRenderer.invoke('flow-editor:export-psd', sessionId, project, shotId),
  saveTiff: (sessionId, project) => ipcRenderer.invoke('flow-editor:saveTiff', sessionId, project),
  checkpoint: (sessionId, project) => ipcRenderer.invoke('flow-editor:checkpoint', sessionId, project),
  onClose: listener => listen('flow-editor:close', listener),
  switchProject: (sessionId, project, target) => ipcRenderer.invoke('flow-editor:switch-project', sessionId, project, target),
  finishClose: (sessionId, id, project) => ipcRenderer.invoke('flow-editor:finish-close', sessionId, id, project),
  launcherState: () => ipcRenderer.invoke('flow-editor:launcher-state'),
  updateRecentName: (sessionId, name) => ipcRenderer.invoke('flow-editor:update-recent-name', sessionId, name),
  removeRecent: id => ipcRenderer.invoke('flow-editor:remove-recent', id),
  relocateRecent: id => ipcRenderer.invoke('flow-editor:relocate-recent', id),
  launch: (target, currentOwner) => currentOwner ? ipcRenderer.invoke('flow-editor:launch', target, currentOwner) : ipcRenderer.invoke('flow-editor:launch', target),
  nativeWindowReady: () => ipcRenderer.invoke('flow-editor:native-window-ready'),
  recoverNativeProjects: () => ipcRenderer.invoke('flow-editor:recover-native-projects'),
  finishNativeClose: (owner, requestId, ticket) => ipcRenderer.invoke('flow-editor:finish-native-close', owner, requestId, ticket),
  chooseOpen: () => ipcRenderer.invoke('flow-editor:choose-open'),
  upgradeChooseDestination: draftId => ipcRenderer.invoke('flow-editor:upgrade-choose-destination', draftId),
  upgradeUpdate: (draftId, patch) => ipcRenderer.invoke('flow-editor:upgrade-update', draftId, patch),
  upgradeDiscard: draftId => ipcRenderer.invoke('flow-editor:upgrade-discard', draftId),
  createDraft: mode => ipcRenderer.invoke('flow-editor:create-draft', mode),
  createChooseSource: (draftId, kind) => ipcRenderer.invoke('flow-editor:create-choose-source', draftId, kind),
  createChooseDestination: draftId => ipcRenderer.invoke('flow-editor:create-choose-destination', draftId),
  createUpdate: (draftId, patch) => ipcRenderer.invoke('flow-editor:create-update', draftId, patch),
  createAbort: draftId => ipcRenderer.invoke('flow-editor:create-abort', draftId),
  createDiscard: draftId => ipcRenderer.invoke('flow-editor:create-discard', draftId),
  respondCreateIssues: (requestId, decision) => ipcRenderer.invoke('flow-editor:create-issues-response', requestId, decision),
  onCreateProgress: listener => listen('flow-editor:create-progress', listener),
  onCreateIssues: listener => listen('flow-editor:create-issues', listener),
  pendingCapability: () => ipcRenderer.invoke('flow-editor:pending-capability'),
  pendingAdd: (sessionId, project, request) => ipcRenderer.invoke('flow-editor:pending-add', sessionId, project, request),
  cancelPendingAdd: (sessionId, operationId) => ipcRenderer.invoke('flow-editor:pending-cancel', sessionId, operationId),
  respondPendingIssues: (requestId, decision) => ipcRenderer.invoke('flow-editor:pending-issues-response', requestId, decision),
  onPendingProgress: listener => listen('flow-editor:pending-progress', listener),
  onPendingIssues: listener => listen('flow-editor:pending-issues', listener)
});
