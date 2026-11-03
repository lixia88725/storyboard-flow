import { expect, test, vi } from 'vitest';
vi.mock('react', () => ({ useState: (v: unknown) => [v, vi.fn()], useRef: (v: unknown) => ({ current: v }), useEffect: (f: () => void) => f(), useCallback: (f: unknown) => f }));
import { useProjectHistoryController } from './projectHistoryController';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { createNormalSaveProjectOwner } from './normalSaveProjectOwner';
import { addGeneratedShot, createProject } from '../shared/projectOps';

// Approved History seam: real controller/queue/owner and exact reciprocal stacks.
// React storage and pixel/persistence ports are in-memory, not native/IPC/GUI proof.
test.each(['queued reload', 'foreign installation', 'new Project', 'new folder', 'reset stacks', 'before last asset', 'missing ACK'] as const)(
  'last acknowledged History completion distinguishes %s from original transaction replacement', async mode => {
    const project = addGeneratedShot(createProject('A'), { imagePath: '/A/s.tiff', fileName: 's.tiff', width: 2, height: 2 });
    const shot = project.shots[0];
    project.pendingBake = { version: 1, shots: { [shot.id]: { state: 'synced', acceptedOutputIdentity: '0'.repeat(64) } } };
    const paths = shot.layers!.slice(mode === 'before last asset' ? 0 : 1).map(l => l.bitmapPath);
    const ref = { current: project }, folder = { current: '/A' }, queue = createBitmapLayerWriteQueue();
    const pixels = new Map(paths.map(p => [p, 'current']));
    let admission = true, installed = true;
    let history!: ReturnType<typeof useProjectHistoryController>;
    const persisted: unknown[] = [], ordinaryPublication = vi.fn(() => false);
    const status = vi.fn(), selection = vi.fn();
    const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: p => { ref.current = p; }, queue,
      freshToken: () => 'new-history-token', readIdentity: async () => '0'.repeat(64), output: async () => [], persist: async () => {},
      captureEffectPersistence: () => ({ folderPath: '/A', metadataPath: '/A/project.json', persist: async p => { persisted.push({ project: p, history: history.captureHistoryData() }); } }) });
    const write = vi.fn(async ({ bitmapPath, dataUrl }: { bitmapPath: string; dataUrl: string }) => {
      pixels.set(bitmapPath, dataUrl);
      if (dataUrl === 'historical') {
        admission = false;
        if (mode === 'foreign installation') installed = false;
        if (mode === 'new Project') ref.current = { ...project, name: 'keep P2' };
        if (mode === 'new folder') folder.current = '/B';
        if (mode === 'reset stacks') history.resetHistoryStacks();
        if (mode === 'missing ACK') throw new Error('settled after-effect failure without ACK');
      }
      return {} as never;
    });
    history = useProjectHistoryController({ captureWorkspace: () => () => admission,
      captureInstalledHistory: () => () => installed, captureEffectCompletion: owner.captureEffectCompletion,
      isImageImportLocked: () => false, api: { readLayerPng: async ({ bitmapPath }) => pixels.get(bitmapPath), writeLayerPng: write,
        deleteLayerPng: async ({ bitmapPath }) => { pixels.delete(bitmapPath); return {} as never; } },
      bitmapLayerWriteQueueRef: { current: queue }, folderPathRef: folder, fileNameSyncStateRef: { current: 'synced' },
      projectRef: ref, selectedShotIdsRef: { current: [shot.id] }, scriptImportCheckIdRef: { current: 0 }, maxEntries: 60,
      publishProject: ordinaryPublication, setProject: vi.fn(), markShotsDirty: vi.fn(), selectShotsByIds: selection,
      setAutosaveRevision: vi.fn(), setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(), setStatus: status, setWorkspaceSaveState: vi.fn() });
    history.recordUndoEntry({ project: { ...project, name: 'historical metadata' }, selectedShotIds: [shot.id], fileNameSyncState: 'synced',
      layerAssets: paths.map(bitmapPath => ({ bitmapPath, dataUrl: 'historical' })) });
    const originalStacks = history.captureHistoryData();
    await history.applyUndoEntry(); await queue.drain();
    expect(ordinaryPublication).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled();
    if (mode === 'queued reload') {
      expect(pixels.get(paths[0])).toBe('historical');
      expect(ref.current.name).toBe('historical metadata');
      expect(ref.current.pendingBake!.shots[shot.id]).toMatchObject({ state: 'pending', editToken: 'new-history-token' });
      expect(history.captureHistoryData().undo).toEqual([]);
      expect(history.captureHistoryData().redo[0].layerAssets).toEqual([{ bitmapPath: paths[0], dataUrl: 'current' }]);
      expect(persisted).toEqual([{ project: ref.current, history: history.captureHistoryData() }]);
    } else {
      for (const p of paths) expect(pixels.get(p)).toBe('current');
      expect(ref.current.name).toBe(mode === 'new Project' ? 'keep P2' : 'A');
      expect(history.captureHistoryData()).toEqual(mode === 'reset stacks' ? { undo: [], redo: [] } : originalStacks);
      if (mode === 'before last asset') expect(write.mock.calls.filter(([p]) => p.bitmapPath === paths[1])).toEqual([]);
      expect(owner.recoveryRequired()).toBe(false); // bytes certified compensated, not a success ACK
    }
  }
);
