import { test, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
vi.mock('react', () => ({ useState: (v: unknown) => [v, vi.fn()], useRef: (v: unknown) => ({ current: v }), useEffect: (fn: () => void) => fn(), useCallback: (fn: unknown) => fn }));
import { useProjectHistoryController } from './projectHistoryController';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { createNormalSaveProjectOwner } from './normalSaveProjectOwner';
import { readLayerAssetSnapshots } from './bitmapLayerHistory';
import { readLayerPng, writeLayerPng, deleteLayerPng } from '../../electron/main/layerAssetService';

// Approved seams: actual controller/queue/owner/native reader + writer.
// Hook storage is synchronous; not mounted React, IPC, prepared Main or cold proof.
const deferred = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'history-compensation-'));
  const paths = ['.storyboard-workbench/layers/s/a.png', '.storyboard-workbench/layers/s/b.png'];
  const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const tiff = await sharp(red).tiff().toBuffer();
  const url = (b: Buffer) => 'data:image/png;base64,' + b.toString('base64');
  await fs.mkdir(path.dirname(path.join(root, paths[0])), { recursive: true, mode: 0o700 });
  for (const file of paths) await fs.writeFile(path.join(root, file), red, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), tiff, { mode: 0o600 });
  const project: any = { id: 'p', name: 'current', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', order: 0, swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: paths.map((bitmapPath, i) => ({ id: i ? 'b' : 'a', kind: 'paint', width: 2, height: 2, bitmapPath })) }], dialogues: [], pendingBake: { version: 1, shots: { s: { state: 'synced', acceptedOutputIdentity: createHash('sha256').update(tiff).digest('hex') } } } };
  const ref = { current: project }, folderRef = { current: root }, queue = createBitmapLayerWriteQueue(), identity = { current: {} };
  const status = vi.fn(), select = vi.fn(), fileSync = vi.fn(), saveState = vi.fn(), dirty = vi.fn(), persist = vi.fn(async () => undefined);
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: vi.fn(), freshToken: () => 'history-token', queue, readIdentity: async () => project.pendingBake.shots.s.acceptedOutputIdentity, persist, output: async () => [], captureEffectPersistence: () => ({ folderPath: root, metadataPath: path.join(root, '.storyboard-workbench/storyboard.project.json'), persist }) });
  const api = { readLayerPng: vi.fn(readLayerPng), writeLayerPng: vi.fn(writeLayerPng), deleteLayerPng: vi.fn(deleteLayerPng) };
  const history = useProjectHistoryController({
    captureWorkspace: () => { const token = identity.current; return () => token === identity.current; },
    captureEffectCompletion: () => owner.captureEffectCompletion(),
    isImageImportLocked: () => false, api, bitmapLayerWriteQueueRef: { current: queue }, folderPathRef: folderRef,
    fileNameSyncStateRef: { current: 'synced' }, projectRef: ref, selectedShotIdsRef: { current: ['s'] }, scriptImportCheckIdRef: { current: 0 }, maxEntries: 60,
    setProject: vi.fn(), markShotsDirty: dirty, selectShotsByIds: select, setAutosaveRevision: vi.fn(), setFileNameSyncState: fileSync, setScriptImportNeeded: vi.fn(), setStatus: status, setWorkspaceSaveState: saveState
  });
  history.recordUndoEntry({ project: { ...project, name: 'historical' }, selectedShotIds: [], fileNameSyncState: 'unsynced', layerAssets: paths.map(bitmapPath => ({ bitmapPath, dataUrl: url(blue) })) });
  return { root, paths, red, blue, url, project, ref, folderRef, queue, identity, owner, api, history, status, select, fileSync, saveState, dirty, persist, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
};

test.each(['stale', 'A→B', 'ABA', 'reload', 'same-scope P2'])('first native restore followed by %s compensates original Root without publishing late state', async mode => {
  const s = await setup();
  try {
    const entered = deferred(), gate = deferred();
    s.api.writeLayerPng.mockImplementation(async payload => {
      const result = await writeLayerPng(payload);
      if (payload.dataUrl === s.url(s.blue)) { entered.release(); await gate.promise; }
      return result;
    });
    const before = s.history.captureHistoryData(), task = s.history.applyUndoEntry();
    await entered.promise;
    const original = s.ref.current;
    if (mode !== 'same-scope P2') s.identity.current = {};
    if (mode === 'A→B') { s.ref.current = { ...s.project, id: 'B', name: 'B' }; s.folderRef.current = '/synthetic-B'; }
    if (mode === 'ABA') { s.ref.current = { ...s.project, id: 'B' }; s.identity.current = {}; s.ref.current = original; }
    if (mode === 'reload') s.ref.current = { ...s.project, name: 'reloaded' };
    if (mode === 'same-scope P2') s.ref.current = { ...s.project, name: 'P2', dialogues: [{ id: 'new', text: 'keep new edit' }] };
    const latest = s.ref.current;
    gate.release(); await task; await s.queue.drain();
    expect(await fs.readFile(path.join(s.root, s.paths[0]))).toEqual(s.red);
    expect(await fs.readFile(path.join(s.root, s.paths[1]))).toEqual(s.red);
    expect(s.api.writeLayerPng.mock.calls.map(([p]) => p.folderPath)).toEqual([s.root, s.root]);
    expect(s.ref.current).toBe(latest); expect(s.history.captureHistoryData()).toEqual(before);
    for (const port of [s.select, s.fileSync, s.saveState, s.dirty, s.status]) expect(port).not.toHaveBeenCalled();
    expect(s.persist).toHaveBeenCalledWith(mode === 'A→B' ? s.project : latest);
    expect(s.owner.recoveryRequired()).toBe(false);
  } finally { await s.cleanup(); }
}, 120000);

test('compensation native refusal retains committed/residual/original versions in owner without false success', async () => {
  const s = await setup();
  try {
    await fs.chmod(path.join(s.root, s.paths[1]), 0o400);
    s.api.writeLayerPng.mockImplementation(async payload => {
      if (payload.bitmapPath === s.paths[0] && payload.dataUrl === s.url(s.red)) await fs.chmod(path.join(s.root, s.paths[0]), 0o400);
      return writeLayerPng(payload);
    });
    const before = s.history.captureHistoryData();
    await s.history.applyUndoEntry(); await s.queue.drain();
    expect(await fs.readFile(path.join(s.root, s.paths[0]))).toEqual(s.blue);
    expect(await fs.readFile(path.join(s.root, s.paths[1]))).toEqual(s.red);
    expect(s.history.captureHistoryData()).toEqual(before); expect(s.ref.current.name).toBe('current');
    expect(s.owner.recoveryRequired()).toBe(true);
    const capture: any = s.owner.captureRecoveryContent();
    expect(capture.effectFacts.historyRestore).toMatchObject({ folderPath: s.root, assets: [
      { bitmapPath: s.paths[0], before: s.url(s.red), desired: s.url(s.blue), actual: s.url(s.blue), started: true, acknowledged: true, compensationStarted: true, compensationAcknowledged: false },
      { bitmapPath: s.paths[1], before: s.url(s.red), actual: s.url(s.red), started: true, acknowledged: false }
    ] });
    expect(s.status.mock.calls.flat().join(' ')).toContain('compensation incomplete');
    expect(s.persist).not.toHaveBeenCalled(); expect(s.select).not.toHaveBeenCalled();
  } finally { await s.cleanup(); }
}, 120000);

test('one rejected reciprocal read keeps the exclusive queue busy until every started read settles', async () => {
  const queue = createBitmapLayerWriteQueue(), entered = deferred(), gate = deferred();
  let secondSettled = false, followingStarted = false;
  const operation = queue.runExclusive(() => readLayerAssetSnapshots({ readLayerPng: async ({ bitmapPath }) => {
    if (bitmapPath === 'bad') throw new Error('read refused');
    entered.release(); await gate.promise; secondSettled = true; return 'pixels';
  } }, '/synthetic', ['bad', 'slow']));
  const rejected = expect(operation).rejects.toThrow('read refused');
  await entered.promise;
  const next = queue.runExclusive(async () => { followingStarted = true; expect(secondSettled).toBe(true); });
  await Promise.resolve(); await Promise.resolve();
  expect(queue.isBusy!()).toBe(true); expect(followingStarted).toBe(false);
  gate.release(); await rejected; await next; await queue.drain(); expect(queue.isBusy!()).toBe(false);
});

test('new edit in final-restore completion microtask cannot be overwritten by old Project publication', async () => {
  const s = await setup();
  try {
    const before = s.history.captureHistoryData();
    const latest = { ...s.project, name: 'last-turn P2' };
    s.api.writeLayerPng.mockImplementation(async payload => {
      const result = await writeLayerPng(payload);
      if (payload.bitmapPath === s.paths[1] && payload.dataUrl === s.url(s.blue)) {
        queueMicrotask(() => queueMicrotask(() => { s.ref.current = latest; }));
      }
      return result;
    });
    await s.history.applyUndoEntry(); await s.queue.drain();
    expect(s.ref.current).toBe(latest); expect(s.history.captureHistoryData()).toEqual(before);
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.red);
    expect(s.status).not.toHaveBeenCalled();
  } finally { await s.cleanup(); }
}, 120000);

test('second writer committed then rejected ACK compensates both real PNGs and retains failure status', async () => {
  const s = await setup();
  try {
    s.api.writeLayerPng.mockImplementation(async payload => {
      const result = await writeLayerPng(payload);
      if (payload.bitmapPath === s.paths[1] && payload.dataUrl === s.url(s.blue)) throw new Error('injected post-commit ACK rejection');
      return result;
    });
    const before = s.history.captureHistoryData();
    await s.history.applyUndoEntry(); await s.queue.drain();
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.red);
    expect(s.history.captureHistoryData()).toEqual(before); expect(s.ref.current).toBe(s.project);
    expect(s.api.writeLayerPng.mock.calls.map(([p]) => p.bitmapPath)).toEqual([s.paths[0], s.paths[1], s.paths[1], s.paths[0]]);
    expect(s.status.mock.calls.flat().join(' ')).toContain('injected post-commit ACK rejection');
    expect(s.owner.recoveryRequired()).toBe(false); expect(s.persist).toHaveBeenCalledWith(s.project);
  } finally { await s.cleanup(); }
}, 120000);

test('successful multi-asset History with a real absence restores PNG/absence on reciprocal Redo', async () => {
  const s = await setup();
  try {
    s.history.restoreHistoryData({ undo: [{ project: { ...s.project, name: 'absent history' }, selectedShotIds: [], fileNameSyncState: 'unsynced',
      layerAssets: [{ bitmapPath: s.paths[0], dataUrl: undefined }, { bitmapPath: s.paths[1], dataUrl: s.url(s.blue) }] }], redo: [] });
    await s.history.applyUndoEntry();
    await expect(fs.lstat(path.join(s.root, s.paths[0]))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(s.root, s.paths[1]))).toEqual(s.blue);
    expect(s.history.captureHistoryData().redo[0].layerAssets).toEqual(s.paths.map(bitmapPath => ({ bitmapPath, dataUrl: s.url(s.red) })));
    await s.history.applyRedoEntry();
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.red);
    expect(s.history.captureHistoryData().undo[0].layerAssets?.[0]).toEqual({ bitmapPath: s.paths[0], dataUrl: undefined });
  } finally { await s.cleanup(); }
}, 120000);

test('History waiting for exclusive admission and then invalidated performs no effects or replay', async () => {
  const s = await setup();
  try {
    const gate = deferred(), entered = deferred();
    const blocker = s.queue.runExclusive(async () => { entered.release(); await gate.promise; });
    await entered.promise;
    const before = s.history.captureHistoryData(), undo = s.history.applyUndoEntry();
    s.identity.current = {}; gate.release(); await blocker; await undo; await s.queue.drain();
    expect(s.api.readLayerPng).not.toHaveBeenCalled(); expect(s.api.writeLayerPng).not.toHaveBeenCalled(); expect(s.api.deleteLayerPng).not.toHaveBeenCalled();
    expect(s.history.captureHistoryData()).toEqual(before); expect(s.persist).not.toHaveBeenCalled(); expect(s.status).not.toHaveBeenCalled();
  } finally { await s.cleanup(); }
}, 120000);

test('compensation commits original PNG then rejects ACK but keeps failed compensation facts and owner pins', async () => {
  const s = await setup();
  try {
    await fs.chmod(path.join(s.root, s.paths[1]), 0o400);
    s.api.writeLayerPng.mockImplementation(async payload => {
      const result = await writeLayerPng(payload);
      if (payload.bitmapPath === s.paths[0] && payload.dataUrl === s.url(s.red)) throw new Error('compensation ACK rejected after commit');
      return result;
    });
    const before = s.history.captureHistoryData(); await s.history.applyUndoEntry(); await s.queue.drain();
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.red);
    expect(s.history.captureHistoryData()).toEqual(before); expect(s.ref.current.name).toBe('current');
    expect(s.owner.recoveryRequired()).toBe(true);
    const facts: any = s.owner.captureRecoveryContent().effectFacts;
    expect(facts.historyRestore.assets[0]).toMatchObject({ actual: s.url(s.red), compensationAcknowledged: false, compensationError: 'compensation ACK rejected after commit' });
    expect(s.persist).not.toHaveBeenCalled();
  } finally { await s.cleanup(); }
}, 120000);

test('compensated bytes awaiting bound persistence keep queue/pins and do not publish late error over P2', async () => {
  const s = await setup();
  try {
    await fs.chmod(path.join(s.root, s.paths[1]), 0o400);
    const entered = deferred(), gate = deferred();
    s.persist.mockImplementationOnce(async () => { entered.release(); await gate.promise; throw new Error('bound metadata ACK refused'); });
    const before = s.history.captureHistoryData(), task = s.history.applyUndoEntry();
    await entered.promise;
    expect(s.queue.isBusy!()).toBe(true);
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.red);
    const latest = { ...s.project, name: 'P2 during persistence' }; s.ref.current = latest;
    gate.release(); await task; await s.queue.drain();
    expect(s.ref.current).toBe(latest); expect(s.history.captureHistoryData()).toEqual(before); expect(s.status).not.toHaveBeenCalled();
    expect(s.owner.recoveryRequired()).toBe(true);
    const captured: any = s.owner.captureRecoveryContent();
    expect(captured.effectFacts.historyRestore.assets[0]).toMatchObject({ before: s.url(s.red), actual: s.url(s.red), compensationAcknowledged: true });
    expect(captured.effectFacts.error.message).toContain('PNG_REFUSED');
    expect(captured.effectFacts.error.message).toContain('bound metadata ACK refused');
  } finally { await s.cleanup(); }
}, 120000);

test('multi-PNG successful Undo/Redo preserves reciprocal pixels and historical markers', async () => {
  const s = await setup();
  try {
    await s.history.applyUndoEntry();
    expect(s.ref.current.name).toBe('historical');
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.blue);
    expect(s.history.captureHistoryData().redo[0].project.name).toBe('current');
    await s.history.applyRedoEntry();
    expect(s.ref.current.name).toBe('current');
    for (const p of s.paths) expect(await fs.readFile(path.join(s.root, p))).toEqual(s.red);
    expect(s.history.captureHistoryData().undo[0].project.name).toBe('historical');
  } finally { await s.cleanup(); }
}, 120000);
