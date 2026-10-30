import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FlowAssetReceipt, FlowFailure, FlowPixelOutput, FlowResult, FlowSession, FlowSessionOptions, FlowSessionOutcome } from '../../../electron/shared/flowWave2';
import type { AssetReaderV1, CheckpointReceiptV1, ProjectV1, ResultV1 } from '../../../electron/shared/refactorV1';
import { createFlowSession } from './index';
import { createProjectStore } from '../../../electron/core/persistence/index';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const initialBytes = Uint8Array.of(1, 2, 3), initialAsset = hash(initialBytes);
const project = (): ProjectV1 => ({ schema: 'storyboard-flow.project', version: 1, id: 'project', revision: 0, name: '合成',
  shots: ['a', 'b'].map(id => ({ id, imageId: `i_${id}`, name: id, scriptText: '' })),
  parkedShots: [{ id: 'p', imageId: 'i_p', name: 'pending', scriptText: '保留' }], dialogues: [],
  images: Object.fromEntries(['a', 'b', 'p'].map(id => [`i_${id}`, { id: `i_${id}`, revision: 0, width: 4, height: 3,
    layers: [{ id: 'layer', name: 'Image', kind: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', width: 4, height: 3, assetId: initialAsset }] }])) });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const ticks = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const error = (code: FlowFailure['code'], message: string = code, effect: FlowFailure['effect'] = 'none'): FlowResult<never> => ({ ok: false, error: { code, message, effect } });
const receipt = (p: ProjectV1): ResultV1<CheckpointReceiptV1> => ({ ok: true, value: { projectId: p.id, revision: p.revision, manifestPath: '/synthetic/project.json' } });
const painted: FlowResult<FlowPixelOutput> = { ok: true, value: { png: Uint8Array.of(9, 8, 7), width: 4, height: 3 } };
const stroke = () => ({ tool: 'brush' as const, color: '#abc', size: 2, opacity: 0.5, softness: 0, points: [1, 1, 2, 2] });
const paint = () => ({ kind: 'paint' as const, shotId: 'a', layerId: 'layer', stroke: stroke() });
const text = (value: string, shotId = 'a') => ({ kind: 'board' as const, command: { kind: 'setScriptText' as const, shotId, text: value } });
const value = <T>(result: FlowResult<T>): T => { expect(result.ok).toBe(true); if (!result.ok) throw Error(result.error.message); return result.value; };
const success = async (pending: Promise<FlowResult<FlowSessionOutcome>>) => value(await pending);

function setup(overrides: Partial<FlowSessionOptions> = {}) {
  let now = 0, timerId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const blobs = new Map<string, Uint8Array>([[initialAsset, initialBytes.slice()]]);
  const inputs: string[] = [], saved: ProjectV1[] = [], operations: string[] = [];
  const options: FlowSessionOptions = {
    sessionId: 'session', incarnation: 'open_1', project: project(), maxHistoryEntries: 3, maxPendingRequests: 12,
    clock: {
      setTimeout(run, delay) { const id = ++timerId; timers.set(id, { at: now + delay, run }); return id; },
      clearTimeout(handle) { timers.delete(handle as number); }
    },
    assets: {
      async read(assetId) { const bytes = blobs.get(assetId); return bytes ? { ok: true, value: bytes.slice() } : error('missing-asset'); },
      async put(input) {
        const assetId = hash(input.png); blobs.set(assetId, input.png.slice()); operations.push(input.operationId);
        return { ok: true, value: { sessionId: 'session', operationId: input.operationId, assetId, width: input.width, height: input.height, byteLength: input.png.length, directorySync: 'synced' } };
      }
    },
    pixels: { async produce(input, read) {
      const assetId = input.image.layers.find(layer => layer.id === input.layerId)!.assetId;
      inputs.push(assetId);
      const bytes = await read(assetId);
      return { ok: true, value: { png: Uint8Array.from([...bytes, Math.round(input.stroke.points[0])]), width: 4, height: 3 } };
    } },
    async checkpoint(snapshot, read) {
      for (const image of Object.values(snapshot.images)) for (const layer of image.layers) await read(layer.assetId);
      saved.push(structuredClone(snapshot)); return receipt(snapshot);
    }, ...overrides
  };
  const session = value(createFlowSession(options));
  return { session, options, timers, blobs, inputs, saved, operations,
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
      await ticks();
    } };
}

describe('FlowSession public Interface', () => {
  it('validates options, snapshots initial project and gives isolated snapshots/listeners', async () => {
    const harness = setup();
    harness.options.project.shots[0].scriptText = 'foreign';
    const view = harness.session.snapshot(); view.project.shots[0].scriptText = 'foreign';
    const bad = vi.fn(() => { throw Error('observer'); }), good = vi.fn();
    harness.session.subscribe(bad); const unsubscribe = harness.session.subscribe(good);
    harness.session.subscribe(async () => { throw Error('async observer'); });
    await success(harness.session.request(text('中文\n🌙')));
    expect(harness.session.snapshot().project.shots[0].scriptText).toBe('中文\n🌙'); expect(good).toHaveBeenCalled();
    unsubscribe(); const calls = good.mock.calls.length;
    await success(harness.session.request(text('more'))); expect(good.mock.calls.length).toBe(calls);
    expect(createFlowSession({ ...harness.options, maxPendingRequests: 0 })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(createFlowSession({ ...harness.options, maxHistoryEntries: 0 })).toMatchObject({ ok: false });
    expect(createFlowSession({ ...harness.options, incarnation: '' })).toMatchObject({ ok: false });
    expect(createFlowSession({ ...harness.options, project: { ...project(), version: 9 } } as unknown as FlowSessionOptions)).toMatchObject({ ok: false });
  });

  it('combines actual drawing/history; no-op and invalid layer operations create no history', async () => {
    const { session } = setup();
    expect((await success(session.request(text('')))).changed).toBe(false);
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await session.request({ kind: 'layer', shotId: 'a', edit: { kind: 'removeLayer', layerId: 'layer' } })).toMatchObject({ ok: false });
    await success(session.request({ kind: 'layer', shotId: 'a', edit: { kind: 'setLayer', layerId: 'layer', patch: { opacity: 0.2 } } }));
    expect(session.snapshot().project.images.i_a.layers[0].opacity).toBe(0.2);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.images.i_a.layers[0].opacity).toBe(1);
    expect(session.snapshot().project.revision).toBe(2);
  });

  it('restricts edits to active shots, preserves Pending, rejects fabricated results/pixel edits', async () => {
    const { session } = setup(); const before = session.snapshot().project;
    for (const input of [text('x', 'p'), { kind: 'board', command: { kind: 'moveShots', shotIds: ['p'], destination: 'active' } },
      { kind: 'board', command: { kind: 'moveShots', shotIds: ['a'], destination: 'pending' } },
      { kind: 'layer', shotId: 'p', edit: { kind: 'setLayer', layerId: 'layer', patch: { opacity: 0.2 } } },
      { kind: 'layer', shotId: 'a', edit: { kind: 'replacePixels', layerId: 'layer', assetId: initialAsset } },
      { kind: 'board', command: { kind: 'applyImageEdit', result: {} } }])
      expect(await session.request(input as Parameters<FlowSession['request']>[0])).toMatchObject({ ok: false });
    expect(session.snapshot().project).toEqual(before);
    await success(session.request({ kind: 'board', command: { kind: 'moveShots', shotIds: ['a'], destination: 'active' } }));
    expect(session.snapshot().project.shots.map(shot => shot.id)).toEqual(['b', 'a']);
    expect(session.snapshot().project.parkedShots).toEqual(before.parkedShots);
  });

  it('keeps slow paint plus intervening text as two actual ordered history entries', async () => {
    const slow = deferred<FlowResult<FlowPixelOutput>>(); const { session } = setup({ pixels: { produce: () => slow.promise } });
    const drawing = session.request(paint());
    await success(session.request(text('穿插文字')));
    expect(session.snapshot().project.revision).toBe(1);
    slow.resolve(painted); await success(drawing);
    const after = session.snapshot().project;
    expect(after.revision).toBe(2); expect(after.shots[0].scriptText).toBe('穿插文字');
    expect(after.images.i_a.layers[0].assetId).toBe(hash(value(painted).png));
    await success(session.request({ kind: 'undo' }));
    expect(session.snapshot().project.shots[0].scriptText).toBe('穿插文字');
    expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(initialAsset);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.shots[0].scriptText).toBe('');
  });

  it('serializes two paints from the first installed asset and retains old reads for Undo/Redo', async () => {
    const { session, inputs, operations, blobs } = setup();
    const first = session.request(paint()), second = session.request(paint());
    const a = (await success(first)).snapshot.project.images.i_a.layers[0].assetId;
    const b = (await success(second)).snapshot.project.images.i_a.layers[0].assetId;
    expect(inputs).toEqual([initialAsset, a]); expect(a).not.toBe(b); expect(new Set(operations).size).toBe(2);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(a);
    await success(session.request({ kind: 'redo' })); expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(b);
    expect(blobs.has(initialAsset) && blobs.has(a) && blobs.has(b)).toBe(true);
  });

  it('does not create history for paint whose verified asset reference is unchanged', async () => {
    const { session } = setup({ pixels: { async produce(input, read) {
      return { ok: true, value: { png: await read(input.image.layers[0].assetId), width: 4, height: 3 } };
    } } });
    expect((await success(session.request(paint()))).changed).toBe(false);
    expect(session.snapshot().project.revision).toBe(0);
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it.each(['undo', 'layer', 'moveShots'] as const)('does not let later text overtake queued %s after slow paint', async kind => {
    const slow = deferred<FlowResult<FlowPixelOutput>>(); const { session } = setup({ pixels: { produce: () => slow.promise } });
    const drawing = session.request(paint());
    const barrier = session.request(kind === 'undo' ? { kind } : kind === 'layer' ?
      { kind, shotId: 'a', edit: { kind: 'setLayer', layerId: 'layer', patch: { locked: true } } } :
      { kind: 'board', command: { kind, shotIds: ['a'], destination: 'active' } });
    const laterText = session.request(text('后来的文字'));
    expect(session.snapshot().project.revision).toBe(0);
    slow.resolve(painted); await Promise.all([success(drawing), success(barrier), success(laterText)]);
    expect(session.snapshot().project.revision).toBe(3);
    if (kind === 'undo') expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(initialAsset);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.shots.find(shot => shot.id === 'a')!.scriptText).toBe('');
  });

  it('looks up history only at queue head, clears Redo on a new branch, and respects max history', async () => {
    const { session } = setup({ maxHistoryEntries: 2 });
    await success(session.request(paint()));
    await success(session.request({ kind: 'undo' }));
    await success(session.request({ kind: 'redo' }));
    expect(session.snapshot().project.revision).toBe(3);
    await success(session.request({ kind: 'undo' })); await success(session.request(text('branch')));
    expect(await session.request({ kind: 'redo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    await success(session.request(text('2'))); await success(session.request(text('3')));
    await success(session.request({ kind: 'undo' })); await success(session.request({ kind: 'undo' }));
    expect(session.snapshot().project.shots[0].scriptText).toBe('branch');
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('snapshots queued request arrays, stroke data, initial options and dependency inputs', async () => {
    const slow = deferred<FlowResult<FlowPixelOutput>>(); const seen: number[][] = [];
    const { session, options } = setup({ pixels: { async produce(input) {
      seen.push([...input.stroke.points]); input.image.layers[0].assetId = 'f'.repeat(64);
      return seen.length === 1 ? slow.promise : painted;
    } } });
    const first = session.request(paint()), request = paint(), next = session.request(request);
    request.stroke.points[0] = 100; request.layerId = 'foreign'; options.pixels.produce = async () => { throw Error('replaced'); };
    slow.resolve(painted); await success(first); await success(next);
    expect(seen).toEqual([[1, 1, 2, 2], [1, 1, 2, 2]]);
    expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(hash(value(painted).png));
  });

  it.each([
    { ...paint(), stroke: { ...stroke(), points: [1] } }, { ...paint(), stroke: { ...stroke(), points: [1, NaN] } },
    { ...paint(), stroke: { ...stroke(), size: 0 } }, { ...paint(), stroke: { ...stroke(), color: 'red' } },
    { ...paint(), stroke: { ...stroke(), opacity: 2 } }, { ...paint(), stroke: { ...stroke(), points: Array(2) } }
  ])('rejects malformed stroke %# before invoking pixels', async input => {
    const produce = vi.fn(); const { session } = setup({ pixels: { produce } });
    expect(await session.request(input)).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    expect(produce).not.toHaveBeenCalled(); expect(session.snapshot().project.revision).toBe(0);
  });

  it('rejects locked/invisible layers without starting pixels', async () => {
    const produce = vi.fn(); const { session } = setup({ pixels: { produce } });
    await success(session.request({ kind: 'layer', shotId: 'a', edit: { kind: 'setLayer', layerId: 'layer', patch: { locked: true } } }));
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'locked' } }); expect(produce).not.toHaveBeenCalled();
    await success(session.request({ kind: 'layer', shotId: 'a', edit: { kind: 'setLayer', layerId: 'layer', patch: { locked: false, visible: false } } }));
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'locked' } });
  });

  it('rejects sparse shot arrays as invalid input before entering history', async () => {
    const { session } = setup();
    expect(await session.request({ kind: 'board', command: { kind: 'moveShots', shotIds: Array(1), destination: 'active' } }))
      .toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(session.snapshot().project.revision).toBe(0);
  });

  it('settles failures/throws without installing pixels and keeps subsequent queue operable', async () => {
    const produce = vi.fn().mockRejectedValueOnce(Error('decode')).mockResolvedValueOnce(error('unavailable')).mockResolvedValue(painted);
    const { session } = setup({ pixels: { produce } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'none' } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(session.snapshot().project.revision).toBe(0);
    await success(session.request(paint())); expect(session.snapshot().project.revision).toBe(1); expect(session.snapshot().pending).toBe(0);
  });

  it('bridges a typed asset read failure even if producer swallows it and returns success', async () => {
    const { session } = setup({ assets: { read: async () => error('missing-asset'), put: vi.fn() }, pixels: {
      async produce(input, read) { try { await read(input.image.layers[0].assetId); } catch { /* bad fallback */ } return painted; }
    } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'missing-asset' } });
    expect(session.snapshot().project.revision).toBe(0);
  });

  it.each(['sessionId', 'operationId', 'assetId', 'width', 'byteLength', 'directorySync'] as const)('checks untrusted asset receipt %s', async field => {
    const { session } = setup({ pixels: { produce: async () => painted }, assets: { read: vi.fn(), async put(input) {
      const receipt: FlowAssetReceipt = { sessionId: 'session', operationId: input.operationId, assetId: hash(input.png), width: 4, height: 3, byteLength: input.png.length, directorySync: 'synced' };
      Object.assign(receipt, { [field]: typeof receipt[field] === 'number' ? 999 : 'foreign' });
      return { ok: true, value: receipt };
    } } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'unknown' } });
    expect(session.snapshot().project.revision).toBe(0);
  });

  it('propagates put failures and exceptions; rejects wrong producer dimensions before put', async () => {
    const put = vi.fn().mockResolvedValueOnce(error('io-failure', 'retained', 'retained')).mockRejectedValueOnce(Error('unknown'));
    const produce = vi.fn().mockResolvedValue(painted); const { session } = setup({ assets: { read: vi.fn(), put }, pixels: { produce } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { effect: 'retained' } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    produce.mockResolvedValue({ ok: true, value: { ...value(painted), width: 9 } });
    expect(await session.request(paint())).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(put).toHaveBeenCalledTimes(2); expect(session.snapshot().project.revision).toBe(0);
  });

  it('debounces changes at 600ms, supports explicit initial checkpoint, and copies returned receipts', async () => {
    const harness = setup(); const { session, saved } = harness;
    expect(session.snapshot().checkpoint).toBeNull();
    await success(session.request({ kind: 'checkpoint' })); expect(saved.map(p => p.revision)).toEqual([0]);
    await success(session.request(text('1'))); await harness.advance(500);
    await success(session.request(text('2'))); await harness.advance(599); expect(saved).toHaveLength(1);
    await harness.advance(1); expect(saved.map(p => p.revision)).toEqual([0, 2]);
    const view = session.snapshot(); view.checkpoint!.receipt.revision = 999;
    expect(session.snapshot().checkpoint!.revision).toBe(2); expect(session.snapshot().checkpoint!.receipt.revision).toBe(2);
  });

  it('allows r+1 edits while checkpoint r is in flight and serializes one latest follow-up', async () => {
    const slow = deferred<ResultV1<CheckpointReceiptV1>>(); const captured: ProjectV1[] = [];
    const { session, advance } = setup({ async checkpoint(p) { captured.push(structuredClone(p)); return captured.length === 1 ? slow.promise : receipt(p); } });
    await success(session.request(text('r1'))); const first = session.request({ kind: 'checkpoint' }); await ticks();
    await success(session.request(text('r2'))); await success(session.request(text('r3'))); await advance(600);
    expect(captured.map(p => p.revision)).toEqual([1]); expect(session.snapshot().checkpoint).toBeNull();
    slow.resolve(receipt(captured[0])); await success(first);
    expect(session.snapshot().project.revision).toBe(3);
    await success(session.request({ kind: 'checkpoint' }));
    expect(captured.map(p => p.revision)).toEqual([1, 3]); expect(session.snapshot().checkpoint!.revision).toBe(3);
  });

  it('captures checkpoint input before awaits; no hot retry; explicit retry clears only its own error', async () => {
    let attempt = 0; const { session, advance } = setup({ async checkpoint(p) {
      const accepted = structuredClone(p); p.revision = 888; p.shots[0].scriptText = 'foreign';
      if (++attempt === 1) return { ok: false, error: { code: 'io-failure', message: 'disk' } };
      return receipt(accepted);
    } });
    await success(session.request(text('original'))); await advance(600);
    expect(session.snapshot()).toMatchObject({ project: { revision: 1 }, lastError: { message: 'disk' } });
    await advance(10000); expect(attempt).toBe(1);
    expect(await session.request({ kind: 'layer', shotId: 'missing', edit: { kind: 'removeLayer', layerId: 'layer' } })).toMatchObject({ ok: false });
    await success(session.request({ kind: 'checkpoint' })); expect(attempt).toBe(2);
    expect(session.snapshot().project.shots[0].scriptText).toBe('original'); expect(session.snapshot().lastError).toMatchObject({ code: 'not-found' });
  });

  it.each(['projectId', 'revision'] as const)('rejects wrong checkpoint receipt %s and retains current edit', async field => {
    const { session } = setup({ async checkpoint(p) { const result = receipt(p); if (!result.ok) throw Error();
      Object.assign(result.value, { [field]: field === 'revision' ? 100 : 'foreign' }); return result; } });
    await success(session.request(text('not lost')));
    expect(await session.request({ kind: 'checkpoint' })).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'unknown' } });
    expect(session.snapshot().checkpoint).toBeNull(); expect(session.snapshot().project.shots[0].scriptText).toBe('not lost');
  });

  it('propagates checkpoint throw/read errors without successful receipt', async () => {
    let attempt = 0; const { session } = setup({ async checkpoint(p, read) {
      if (++attempt === 1) throw Error('write');
      try { await read('f'.repeat(64)); } catch { /* invalid ACK despite read failure */ }
      return receipt(p);
    } });
    expect(await session.request({ kind: 'checkpoint' })).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(await session.request({ kind: 'checkpoint' })).toMatchObject({ ok: false, error: { code: 'missing-asset' } });
    expect(session.snapshot().checkpoint).toBeNull();
  });

  it('freeze immediately stops admission, drains paint/checkpoint callbacks, shares pending work, then resumes', async () => {
    const pixels = deferred<FlowResult<FlowPixelOutput>>(), disk = deferred<ResultV1<CheckpointReceiptV1>>(); let captured: ProjectV1 | undefined;
    const { session, timers } = setup({ pixels: { produce: () => pixels.promise }, async checkpoint(p) { captured = p; return disk.promise; } });
    const drawing = session.request(paint()), freeze = session.request({ kind: 'freeze' });
    expect(session.request({ kind: 'freeze' })).toBe(freeze);
    expect(session.snapshot().phase).toBe('freezing');
    expect(await session.request(text('late'))).toMatchObject({ ok: false, error: { code: 'busy' } });
    expect(await session.request({ kind: 'resume' })).toMatchObject({ ok: false, error: { code: 'busy' } });
    pixels.resolve(painted); await success(drawing); await ticks();
    expect(session.snapshot().phase).toBe('freezing'); expect(captured!.revision).toBe(1);
    disk.resolve(receipt(captured!)); await success(freeze);
    expect(session.snapshot()).toMatchObject({ phase: 'frozen', pending: 0, checkpoint: { revision: 1 } }); expect(timers.size).toBe(0);
    await success(session.request({ kind: 'resume' })); await success(session.request(text('now')));
    expect(session.snapshot().phase).toBe('active');
  });

  it('failed freeze stays freezing, refuses resume/new requests, and can retry checkpoint', async () => {
    let attempt = 0; const { session, timers } = setup({ async checkpoint(p) {
      return ++attempt === 1 ? { ok: false, error: { code: 'io-failure', message: 'disk full' } } : receipt(p);
    } });
    await success(session.request(text('kept')));
    expect(await session.request({ kind: 'freeze' })).toMatchObject({ ok: false });
    expect(session.snapshot()).toMatchObject({ phase: 'freezing', lastError: { message: 'disk full' } });
    for (const request of [text('late'), paint(), { kind: 'checkpoint' as const }, { kind: 'resume' as const }])
      expect(await session.request(request)).toMatchObject({ ok: false, error: { code: 'busy' } });
    await success(session.request({ kind: 'freeze' }));
    expect(session.snapshot()).toMatchObject({ phase: 'frozen', lastError: null, pending: 0 }); expect(timers.size).toBe(0);
  });

  it('enforces pending capacity without cancelling accepted work and reopens capacity on settlement', async () => {
    const slow = deferred<FlowResult<FlowPixelOutput>>(); const { session } = setup({ maxPendingRequests: 2, pixels: { produce: () => slow.promise } });
    const drawing = session.request(paint()), undo = session.request({ kind: 'undo' });
    expect(await session.request(text('overflow'))).toMatchObject({ ok: false, error: { code: 'resource-limit' } });
    expect(session.snapshot()).toMatchObject({ pending: 2, project: { revision: 0 } });
    slow.resolve(painted); await success(drawing); await success(undo);
    expect(session.snapshot().pending).toBe(0); await success(session.request(text('capacity')));
  });

  it('freeze waits checkpoint r callbacks then flushes the latest accepted r+1', async () => {
    const slow = deferred<ResultV1<CheckpointReceiptV1>>(), captured: ProjectV1[] = [];
    const { session } = setup({ async checkpoint(p) { captured.push(p); return captured.length === 1 ? slow.promise : receipt(p); } });
    await success(session.request(text('r1')));
    const checkpoint = session.request({ kind: 'checkpoint' }); await ticks();
    await success(session.request(text('r2')));
    const freezing = session.request({ kind: 'freeze' });
    expect(await session.request(text('rejected'))).toMatchObject({ ok: false });
    slow.resolve(receipt(captured[0])); await success(checkpoint); await success(freezing);
    expect(captured.map(p => p.revision)).toEqual([1, 2]);
    expect(session.snapshot()).toMatchObject({ phase: 'frozen', pending: 0, checkpoint: { revision: 2 } });
  });

  it('does not report frozen while a clock refuses cancellation; retains the handle for retry', async () => {
    let failClear = true;
    const harness = setup(), clock = harness.options.clock;
    const session = value(createFlowSession({ ...harness.options, clock: { ...clock, clearTimeout(handle) {
      if (failClear) throw Error('timer cancellation failed'); clock.clearTimeout(handle);
    } } }));
    await success(session.request(text('kept')));
    expect(await session.request({ kind: 'freeze' })).toMatchObject({ ok: false, error: { message: 'timer cancellation failed' } });
    expect(session.snapshot().phase).toBe('freezing'); expect(harness.timers.size).toBe(1);
    expect(await session.request({ kind: 'resume' })).toMatchObject({ ok: false });
    failClear = false; await success(session.request({ kind: 'freeze' }));
    expect(harness.timers.size).toBe(0); expect(session.snapshot().phase).toBe('frozen');
    expect(session.snapshot().lastError).toMatchObject({ message: 'timer cancellation failed' }); // Checkpoint retry cannot erase other failures.
  });

  it('isolates both dependency byte inputs and reader return buffers', async () => {
    const readerResults: Uint8Array[] = [];
    const harness = setup();
    const session = value(createFlowSession({ ...harness.options, pixels: { async produce(input, read) {
      const bytes = await read(input.image.layers[0].assetId); readerResults.push(bytes); bytes[0] = 99;
      return painted;
    } }, assets: { ...harness.options.assets, async read() { return { ok: true, value: initialBytes }; } } }));
    await success(session.request(paint()));
    expect([...initialBytes]).toEqual([1, 2, 3]); expect(readerResults).toHaveLength(1);
    const snapshot = session.snapshot(); snapshot.lastError = { code: 'io-failure', message: 'foreign', effect: 'unknown' };
    expect(session.snapshot().lastError).toBeNull();
  });

  it('settles one paint once despite a multiply-resolved dependency Promise', async () => {
    const twice = deferred<FlowResult<FlowPixelOutput>>();
    const { session, operations } = setup({ pixels: { produce: () => twice.promise } });
    const request = session.request(paint()); twice.resolve(painted); twice.resolve(painted); twice.reject(Error('too late'));
    await success(request); await ticks();
    expect(session.snapshot().project.revision).toBe(1); expect(operations).toHaveLength(1);
    await success(session.request({ kind: 'undo' }));
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('checkpoints actual PNGs on a real temporary filesystem and reopens precise editable content', async () => {
    const root = await temporaryWorkspace('flow-session-');
    const original = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#00000000' } }).png().toBuffer();
    const edited = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#cc0044ff' } }).png().toBuffer();
    const harness = setup(), p = project();
    for (const image of Object.values(p.images)) image.layers[0].assetId = hash(original);
    harness.blobs.set(hash(original), original);
    const store = createProjectStore();
    const session = value(createFlowSession({ ...harness.options, project: p,
      pixels: { async produce() { return { ok: true, value: { png: edited, width: 4, height: 3 } }; } },
      checkpoint: (p, read) => store.saveCheckpoint(root, p, read) }));
    await success(session.request(text('真实暂存 🌙'))); await success(session.request(paint()));
    await success(session.request({ kind: 'freeze' }));
    const loaded = await createProjectStore().loadCheckpoint(root);
    expect(loaded.ok).toBe(true); if (!loaded.ok) throw Error(loaded.error.message);
    expect(loaded.value.project).toEqual(session.snapshot().project);
    expect(Buffer.from(await loaded.value.readAsset(hash(edited)))).toEqual(edited);
    expect(Buffer.from(await loaded.value.readAsset(hash(original)))).toEqual(original); // Other/parked images still use it.
    await success(session.request({ kind: 'resume' })); await success(session.request({ kind: 'undo' }));
    await success(session.request({ kind: 'freeze' }));
    const undone = await store.loadCheckpoint(root); expect(undone.ok).toBe(true);
    if (!undone.ok) throw Error(undone.error.message);
    expect(undone.value.project.shots[0].scriptText).toBe('真实暂存 🌙');
    expect(undone.value.project.images.i_a.layers[0].assetId).toBe(hash(original));
    expect(undone.value.project.revision).toBe(3);
  });
});
