import { expect, test, vi } from 'vitest';
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }), useEffect: (effect: () => void) => effect(), useCallback: (fn: unknown) => fn }));
import { addGeneratedShot, createProject } from '../shared/projectOps';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { useProjectHistoryController } from './projectHistoryController';
import { createNormalSaveAppAdapter } from './normalSaveAppAdapter';

// Actual History -> owner -> captured original App persistence -> ordinary ACK.
// IPC/filesystem and React are explicit ports, not production/native/GUI proof.
test('real owner and App persistence keep the next History step behind exact ordinary ACK without re-entering their queue', async () => {
  const project = addGeneratedShot(createProject('current'), { imagePath: '/synthetic/shot.tiff', fileName: 'shot.tiff', width: 2, height: 2 });
  const shot = project.shots[0], file = shot.layers![1].bitmapPath!, identity = '0'.repeat(64);
  project.pendingBake = { version: 1, shots: { [shot.id]: { state: 'synced', acceptedOutputIdentity: identity } } };
  const projectRef = { current: project }, queue = createBitmapLayerWriteQueue();
  let pixels = 'after', writes = 0, acks = 0, serial = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ackEntered = new Promise<void>(r => { entered = r; });
  const pending = new Map<string, unknown>();
  const api = {
    saveWorkspace: async () => { throw new Error('History must not substitute an extra TIFF Save for its own ordinary ACK'); },
    readOutputIdentity: async () => identity,
    autosaveWorkspace: async (payload: { project: unknown }) => { const nonce = `ordinary-${++serial}`; pending.set(nonce, payload.project); return { ordinaryPersistenceNonce: nonce }; },
    acknowledgeSave: async (payload: { folderPath: string; nonce: string; project: unknown }) => {
      expect(payload.folderPath).toBe('/synthetic'); expect(pending.get(payload.nonce)).toBe(payload.project);
      acks++; if (acks === 1) { entered(); await gate; } pending.delete(payload.nonce); return true;
    },
    readLayerPng: async () => pixels,
    writeLayerPng: async ({ dataUrl }: { dataUrl: string }) => { writes++; pixels = dataUrl; return {} as never; },
    deleteLayerPng: async () => ({} as never)
  };
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: next => { projectRef.current = next; }, queue, api: () => api,
    paths: () => ({ folderPath: '/synthetic', metadataPath: '/synthetic/project.json' }), freshToken: () => `edit-${serial}-${writes}`, onSave: vi.fn(), onError: vi.fn() });
  expect(adapter.owner.captureEffectAdmission()()).toBe(true);
  const history = useProjectHistoryController({
    isImageImportLocked: () => false, captureWorkspace: () => () => true, captureInstalledHistory: () => () => true, api,
    captureEffectCompletion: () => adapter.owner.captureEffectCompletion(), bitmapLayerWriteQueueRef: { current: queue }, projectRef,
    folderPathRef: { current: '/synthetic' }, fileNameSyncStateRef: { current: 'synced' }, selectedShotIdsRef: { current: [shot.id] }, maxEntries: 60, scriptImportCheckIdRef: { current: 0 },
    publishProject: () => { throw new Error('History must persist through its captured original completion, not detached publication'); }, setProject: next => { projectRef.current = next; },
    markShotsDirty: vi.fn(), selectShotsByIds: vi.fn(), setAutosaveRevision: vi.fn(), setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(), setStatus: vi.fn(), setWorkspaceSaveState: vi.fn()
  });
  history.recordUndoEntry({ project: { ...project, name: 'historical' }, selectedShotIds: [shot.id], fileNameSyncState: 'synced', layerAssets: [{ bitmapPath: file, dataUrl: 'before' }] });
  const undo = history.applyUndoEntry();
  try {
    expect(await Promise.race([undo.then(() => 'finished-before-ack'), ackEntered.then(() => 'ack-pending')])).toBe('ack-pending');
    const redo = history.applyRedoEntry(); await Promise.resolve(); await Promise.resolve();
    expect(writes).toBe(1); expect(acks).toBe(1); expect(pending.size).toBe(1);
    release(); await undo; await redo;
    expect(writes).toBe(2); expect(acks).toBe(2); expect(pending.size).toBe(0); expect(pixels).toBe('after');
    expect(history.captureHistoryData().undo).toHaveLength(1); expect(history.captureHistoryData().redo).toHaveLength(0);
    expect(adapter.owner.lastError).toBeUndefined(); expect(projectRef.current.pendingBake?.shots[shot.id].state).toBe('pending');
  } finally { release(); await undo; }
});
