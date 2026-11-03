import { expect, test, vi } from 'vitest';
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }), useEffect: (effect: () => void) => effect(), useCallback: (fn: unknown) => fn }));
import { addGeneratedShot, createProject } from '../shared/projectOps';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { useProjectHistoryController } from './projectHistoryController';
import { createNormalSaveAppAdapter } from './normalSaveAppAdapter';

// Real owner/adapter ACK rejection; React, IPC and pixels are boundary ports.
// A display scope is not mutation admission: own failure must not revoke its UI.
test.each(['current', 'foreign', 'replaced-project'] as const)('ACK failure reports only to its published original display: %s', async mode => {
  const project = addGeneratedShot(createProject('current'), { imagePath: '/synthetic/shot.tiff', fileName: 'shot.tiff', width: 2, height: 2 });
  const shot = project.shots[0], file = shot.layers![1].bitmapPath!, identity = '0'.repeat(64);
  project.pendingBake = { version: 1, shots: { [shot.id]: { state: 'synced', acceptedOutputIdentity: identity } } };
  const projectRef = { current: project }, queue = createBitmapLayerWriteQueue();
  let pixels = 'after', writes = 0, displayCurrent = true, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ackEntered = new Promise<void>(r => { entered = r; });
  const status = vi.fn(), state = vi.fn();
  const api = {
    saveWorkspace: async () => { throw new Error('No extra Save'); }, readOutputIdentity: async () => identity,
    autosaveWorkspace: async () => ({ ordinaryPersistenceNonce: 'original-ordinary' }),
    acknowledgeSave: async () => { entered(); await gate; return false; },
    readLayerPng: async () => pixels, writeLayerPng: async ({ dataUrl }: { dataUrl: string }) => { writes++; pixels = dataUrl; return {} as never; }, deleteLayerPng: async () => ({} as never)
  };
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: next => { projectRef.current = next; }, queue, api: () => api,
    paths: () => ({ folderPath: '/synthetic', metadataPath: '/synthetic/project.json' }), freshToken: () => 'new-edit', onSave: vi.fn(), onError: vi.fn() });
  const history = useProjectHistoryController({
    isImageImportLocked: () => false, captureWorkspace: () => adapter.owner.captureEffectAdmission(),
    captureFailureScope: () => () => displayCurrent, captureInstalledHistory: () => () => displayCurrent, api,
    captureEffectCompletion: () => adapter.owner.captureEffectCompletion(), bitmapLayerWriteQueueRef: { current: queue }, projectRef,
    folderPathRef: { current: '/synthetic' }, fileNameSyncStateRef: { current: 'synced' }, selectedShotIdsRef: { current: [shot.id] }, maxEntries: 60, scriptImportCheckIdRef: { current: 0 },
    publishProject: () => { throw new Error('No detached publication'); }, setProject: next => { projectRef.current = next; },
    markShotsDirty: vi.fn(), selectShotsByIds: vi.fn(), setAutosaveRevision: vi.fn(), setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(), setStatus: status, setWorkspaceSaveState: state
  });
  history.recordUndoEntry({ project: { ...project, name: 'historical' }, selectedShotIds: [shot.id], fileNameSyncState: 'synced', layerAssets: [{ bitmapPath: file, dataUrl: 'before' }] });
  const undo = history.applyUndoEntry();
  try {
    expect(await Promise.race([undo.then(() => 'finished'), ackEntered.then(() => 'ack-pending')])).toBe('ack-pending');
    expect(writes).toBe(1); expect(state).toHaveBeenLastCalledWith('saving');
    const transitioned = history.captureHistoryData(); expect(transitioned.undo).toHaveLength(0); expect(transitioned.redo).toHaveLength(1);
    if (mode === 'foreign') displayCurrent = false;
    if (mode === 'replaced-project') projectRef.current = { ...projectRef.current, name: 'newer' };
    status.mockClear(); state.mockClear(); release(); await undo;
    expect(adapter.owner.lastError).toBeInstanceOf(Error); expect(adapter.owner.captureEffectAdmission()()).toBe(false);
    expect(writes).toBe(1); expect(pixels).toBe('before'); expect(history.captureHistoryData()).toEqual(transitioned);
    if (mode === 'current') {
      expect(status).toHaveBeenLastCalledWith('Undo failed: Ordinary exact persistence ACK refused');
      expect(state).toHaveBeenLastCalledWith('error');
    } else { expect(status).not.toHaveBeenCalled(); expect(state).not.toHaveBeenCalled(); }
  } finally { release(); await undo; }
});
