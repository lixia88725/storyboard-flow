import path from 'node:path';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { createAppRootActor, appCallerAdapterScope } from '../../src/renderer/appCallerAdapterScope';

/** Test composition only: first open starts unrooted; preloaded fixtures may
 * keep their already-loaded initial Project. Main owns every observation and
 * Handoff. No pre-created parent, fake binding, lease or certificate.
 * The event represents the fixture's current top frame; no Electron GUI proof. */
export async function createAppOpenCallerScope(ports, preloaded = false, probeOperation = false, ui = {}) {
  const frame = {}, sender = { mainFrame: frame };
  const event = { sender, senderFrame: frame };
  const main = createPreparedWorkspaceSave({
    budget: { bytes: 1048576, records: 100, assets: 16, jsonDepth: 40 },
    python: '/opt/homebrew/bin/python3.12',
    script: path.resolve('scripts/recovery-content-permissions.py')
  });
  Object.assign(ports.api(), {
    certifyWorkspaceHandoff: capture => main.certifyHandoff(event, capture),
    readReadonlyRecovery: folder => main.readReadonly(folder)
  });
  const adapter = await createAppRootActor(ports, {
    observeWorkspace: folder => main.observeWorkspace(event, folder), preloaded, probeOperation,
    publishScan: ui.publishScan,
    admitPreloaded: load => main.ordinary(event, 'workspace:openFolderByPath', ports.paths().folderPath, [ports.paths().folderPath], load),
    // These old fixtures mount no canvas or History. Empty UI capture is a
    // declared fixture boundary, never a replacement for native certification.
    captureView: () => ({ canvas: { captures: [], hasUnsettledGesture: false }, history: null,
      selectedShotIds: [], dirtyShotIds: [], fileNameSyncState: 'synced', workspaceSaveState: 'saved', recoveryMessage: null })
  });
  return appCallerAdapterScope({ normalSaveAppAdapterRef: { current: adapter }, projectRef: ports.projectRef });
}
