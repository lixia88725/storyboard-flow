import { expect, test, vi } from 'vitest';
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }), useEffect: (effect: () => void) => effect(), useCallback: (fn: unknown) => fn }));
import { addGeneratedShot, createProject } from '../shared/projectOps';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { useProjectHistoryController } from './projectHistoryController';
import type { CompletedEffect } from './normalSaveProjectOwner';

// Public History/queue composition. React hooks, pixels and original persistence
// completion are declared boundary ports; this is NOT mounted/native/ACK proof.
test('a current History restore keeps exclusivity through its original persistence completion before queued Redo', async () => {
  const project = addGeneratedShot(createProject('current'), { imagePath: '/synthetic/shot.tiff', fileName: 'shot.tiff', width: 2, height: 2 });
  const shot = project.shots[0], file = shot.layers![1].bitmapPath!;
  const projectRef = { current: project }, queue = createBitmapLayerWriteQueue();
  let pixels = 'after', writes = 0, completions = 0, release!: () => void, entered!: () => void, written!: () => void;
  const gate = new Promise<void>(r => { release = r; }), completionEntered = new Promise<void>(r => { entered = r; }), firstWrite = new Promise<void>(r => { written = r; });
  const history = useProjectHistoryController({
    isImageImportLocked: () => false, captureWorkspace: () => () => true, captureInstalledHistory: () => () => true,
    api: { readLayerPng: async () => pixels, writeLayerPng: async ({ dataUrl }) => { pixels = dataUrl; writes++; written(); return {} as never; }, deleteLayerPng: async () => ({} as never) },
    captureEffectCompletion: () => Object.assign(async (update: Parameters<CompletedEffect>[0], _ids: readonly string[], hooks?: Parameters<CompletedEffect>[2]) => {
      const previous = projectRef.current, next = typeof update === 'function' ? update(previous) : update;
      projectRef.current = next; completions++; hooks?.published(previous, next);
      if (completions === 1) { entered(); await gate; }
      await hooks?.afterDurable(next);
    }, { failed: vi.fn() }) as unknown as CompletedEffect,
    bitmapLayerWriteQueueRef: { current: queue }, projectRef, folderPathRef: { current: '/synthetic' }, fileNameSyncStateRef: { current: 'synced' },
    selectedShotIdsRef: { current: [shot.id] }, maxEntries: 60, scriptImportCheckIdRef: { current: 0 },
    publishProject: next => { projectRef.current = next; return true; }, setProject: next => { projectRef.current = next; },
    markShotsDirty: vi.fn(), selectShotsByIds: vi.fn(), setAutosaveRevision: vi.fn(), setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(), setStatus: vi.fn(), setWorkspaceSaveState: vi.fn()
  });
  history.recordUndoEntry({ project: { ...project, name: 'historical' }, selectedShotIds: [shot.id], fileNameSyncState: 'synced', layerAssets: [{ bitmapPath: file, dataUrl: 'before' }] });
  const undo = history.applyUndoEntry();
  await firstWrite;
  try {
    expect(await Promise.race([undo.then(() => 'operation-finished'), completionEntered.then(() => 'waiting-original-ack')])).toBe('waiting-original-ack');
    const redo = history.applyRedoEntry();
    await Promise.resolve(); await Promise.resolve();
    expect(writes).toBe(1);
    release(); await undo; await redo;
    expect(completions).toBe(2); expect(writes).toBe(2); expect(pixels).toBe('after');
    expect(history.captureHistoryData().undo).toHaveLength(1); expect(history.captureHistoryData().redo).toHaveLength(0);
  } finally { release(); await undo; }
});
