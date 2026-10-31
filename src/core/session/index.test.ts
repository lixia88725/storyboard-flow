import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FlowAssetReceipt, FlowFailure, FlowPixelOutput, FlowResult, FlowSession, FlowSessionOptions, FlowSessionOutcome } from '../../../electron/shared/flowWave2';
import type { AssetReaderV1, CheckpointReceiptV1, ProjectV1, ResultV1 } from '../../../electron/shared/refactorV1';
import { createFlowSession } from './index';
import { createProjectStore } from '../../../electron/core/persistence/index';
import { openFlowAssetDepot } from '../../../electron/core/persistence/depot';
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
    for (const input of [text('x', 'p'), { kind: 'board', command: { kind: 'moveShots', shotIds: ['missing'], destination: 'active' } },
      { kind: 'board', command: { kind: 'moveShots', shotIds: ['a'], destination: 'unknown' } },
      { kind: 'layer', shotId: 'p', edit: { kind: 'setLayer', layerId: 'layer', patch: { opacity: 0.2 } } },
      { kind: 'layer', shotId: 'a', edit: { kind: 'replacePixels', layerId: 'layer', assetId: initialAsset } },
      { kind: 'board', command: { kind: 'applyImageEdit', result: {} } }])
      expect(await session.request(input as Parameters<FlowSession['request']>[0])).toMatchObject({ ok: false });
    expect(session.snapshot().project).toEqual(before);
    await success(session.request({ kind: 'board', command: { kind: 'moveShots', shotIds: ['a'], destination: 'active' } }));
    expect(session.snapshot().project.shots.map(shot => shot.id)).toEqual(['b', 'a']);
    expect(session.snapshot().project.parkedShots).toEqual(before.parkedShots);
  });

  it('moves Pending membership through one history entry without pixel work and checkpoints it', async () => {
    const { session, operations, inputs, saved, advance } = setup();
    const before = session.snapshot().project;
    await success(session.request({ kind: 'board', command: { kind: 'moveShots', shotIds: ['a', 'b'], destination: 'pending', beforeId: 'p' } }));
    expect(session.snapshot().project.shots).toEqual([]);
    expect(session.snapshot().project.parkedShots.map(s => s.id)).toEqual(['a','b','p']);
    expect(session.snapshot().project.images).toEqual(before.images);
    expect(operations).toEqual([]);expect(inputs).toEqual([]);
    await advance(1000);expect(saved.at(-1)?.parkedShots.map(s=>s.id)).toEqual(['a','b','p']);
    await success(session.request({kind:'undo'}));
    expect(session.snapshot().project.shots).toEqual(before.shots);
    await success(session.request({kind:'redo'}));
    await success(session.request({kind:'board',command:{kind:'moveShots',shotIds:['a'],destination:'active'}}));
    expect(session.snapshot().project.shots.map(s=>s.id)).toEqual(['a']);
    await success(session.request({kind:'undo'}));expect(session.snapshot().project.shots).toEqual([]);
    expect(operations).toEqual([]);expect(inputs).toEqual([]);
  });

  it('finishes queued paint before parking and Undo restores the painted shot without file work', async () => {
    const slow=deferred<FlowResult<FlowPixelOutput>>();const {session,operations}=setup({pixels:{produce:()=>slow.promise}});
    const drawing=session.request(paint());
    const parking=session.request({kind:'board',command:{kind:'moveShots',shotIds:['a'],destination:'pending'}});
    await ticks();expect(session.snapshot().project.shots.some(s=>s.id==='a')).toBe(true);
    slow.resolve(painted);await success(drawing);await success(parking);
    const asset=session.snapshot().project.images.i_a.layers[0].assetId;
    expect(asset).not.toBe(initialAsset);expect(session.snapshot().project.parkedShots.some(s=>s.id==='a')).toBe(true);
    await success(session.request({kind:'undo'}));expect(session.snapshot().project.shots.some(s=>s.id==='a')).toBe(true);
    expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(asset);expect(operations).toHaveLength(1);
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

describe('dialogue commands through the Session', () => {
  const dialogue = (shotId: string, text: string, id = 'd') => ({
    kind: 'board' as const, command: { kind: 'setDialogues' as const, shotId, dialogues: [{ id, shotId, text }] }
  });
  it('keeps concurrent dialogue edits through paint, then undoes each operation independently', async () => {
    const pending = deferred<FlowResult<FlowPixelOutput>>();
    const { session } = setup({ pixels: { produce: () => pending.promise }, maxHistoryEntries: 10 });
    await success(session.request(dialogue('b', 'other', 'other')));
    const painting = session.request(paint());
    await ticks();
    const input = dialogue('a', '中文');
    const editing = session.request(input);
    input.command.dialogues[0].text = 'caller mutation';
    await success(editing);
    expect(session.snapshot().project.dialogues.map(d => d.text)).toEqual(['other', '中文']);
    pending.resolve(painted); await success(painting);
    await success(session.request({ kind: 'undo' }));
    expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(initialAsset);
    expect(session.snapshot().project.dialogues.map(d => d.text)).toEqual(['other', '中文']);
    await success(session.request({ kind: 'undo' }));
    expect(session.snapshot().project.dialogues.map(d => d.text)).toEqual(['other']);
    await success(session.request({ kind: 'redo' }));
    expect(session.snapshot().project.dialogues.map(d => d.text)).toEqual(['other', '中文']);
  });
  it('rejects parked targets, foreign bindings and duplicate IDs without changing project', async () => {
    const { session } = setup();
    await success(session.request(dialogue('b', 'other', 'other')));
    const before = session.snapshot().project;
    expect(await session.request(dialogue('p', 'parked'))).toMatchObject({ ok: false });
    expect(await session.request(dialogue('a', 'collision', 'other'))).toMatchObject({ ok: false });
    const foreign = dialogue('a', 'foreign'); foreign.command.dialogues[0].shotId = 'b';
    expect(await session.request(foreign)).toMatchObject({ ok: false });
    expect(session.snapshot().project).toEqual(before);
  });
  it('does not let dialogue overtake an Undo queued behind painting', async () => {
    const pending = deferred<FlowResult<FlowPixelOutput>>();
    const { session } = setup({ pixels: { produce: () => pending.promise } });
    const painting = session.request(paint()); await ticks();
    const undo = session.request({ kind: 'undo' });
    const editing = session.request(dialogue('a', 'after undo'));
    await ticks(); expect(session.snapshot().project.dialogues).toEqual([]);
    pending.resolve(painted);
    await success(painting); await success(undo); await success(editing);
    expect(session.snapshot().project.images.i_a.layers[0].assetId).toBe(initialAsset);
    expect(session.snapshot().project.dialogues[0].text).toBe('after undo');
    await success(session.request({ kind: 'undo' }));
    expect(session.snapshot().project.dialogues).toEqual([]);
  });
});

describe('active board transactions', () => {
  it('removes active shots atomically, retains assets, and restores exact content through undo and redo', async () => {
    const { session, blobs } = setup();
    await success(session.request({ kind: 'board', command: { kind: 'setDialogues', shotId: 'a', dialogues: [{ id: 'd', shotId: 'a', text: 'line' }] } }));
    const before = session.snapshot().project;
    await success(session.request({ kind: 'board', command: { kind: 'removeShots', shotIds: ['b', 'a'] } }));
    expect(session.snapshot().project.shots).toEqual([]);
    expect(session.snapshot().project.dialogues).toEqual([]);
    expect(session.snapshot().project.images).toEqual(before.images);
    expect(blobs.has(initialAsset)).toBe(true);
    await success(session.request({ kind: 'undo' }));
    expect({ ...session.snapshot().project, revision: before.revision }).toEqual(before);
    await success(session.request({ kind: 'redo' }));
    expect(session.snapshot().project.shots).toEqual([]);
    expect(await session.request({ kind: 'board', command: { kind: 'removeShots', shotIds: ['p'] } })).toMatchObject({ ok: false });
  });

  it('moves dialogues in original order as one history entry, rejecting invalid selections without mutation', async () => {
    const p = project(); p.dialogues = [
      { id: 'd1', shotId: 'a', text: 'one' }, { id: 'd2', shotId: 'a', text: 'two' },
      { id: 'd3', shotId: 'b', text: 'three' }, { id: 'dp', shotId: 'p', text: 'parked' }
    ];
    const { session } = setup({ project: p });
    const cmd = (dialogueIds: string[], targetShotId: string, beforeId?: string) => ({ kind: 'board' as const,
      command: { kind: 'moveDialogues' as const, dialogueIds, targetShotId, ...(beforeId ? { beforeId } : {}) } });
    for (const input of [cmd(['d1', 'd1'], 'b'), cmd(['d1', 'missing'], 'b'), cmd(['dp'], 'a'), cmd(['d1'], 'p'), cmd(['d1'], 'b', 'd2'), cmd(['d1'], 'a', 'd1')])
      expect(await session.request(input)).toMatchObject({ ok: false });
    expect(session.snapshot().project).toEqual(p);
    expect((await success(session.request(cmd(['d2'], 'a')))).changed).toBe(false);
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false });
    await success(session.request(cmd(['d2', 'd1'], 'b', 'd3')));
    expect(session.snapshot().project.dialogues).toEqual([
      { id: 'd1', shotId: 'b', text: 'one' }, { id: 'd2', shotId: 'b', text: 'two' },
      { id: 'd3', shotId: 'b', text: 'three' }, { id: 'dp', shotId: 'p', text: 'parked' }
    ]);
    await success(session.request({ kind: 'undo' }));
    expect(session.snapshot().project.dialogues).toEqual(p.dialogues);
    await success(session.request({ kind: 'redo' }));
    expect(session.snapshot().project.dialogues.map(d => d.shotId)).toEqual(['b', 'b', 'b', 'p']);
  });

  it('queues membership and dialogue moves behind paint, snapshots inputs, and respects freeze', async () => {
    const slow = deferred<FlowResult<FlowPixelOutput>>(); const p = project();
    p.dialogues = [{ id: 'd', shotId: 'a', text: 'line' }];
    const { session } = setup({ project: p, pixels: { produce: () => slow.promise } });
    const drawing = session.request(paint());
    const command = { kind: 'board' as const, command: { kind: 'moveDialogues' as const, dialogueIds: ['d'], targetShotId: 'b' } };
    const moving = session.request(command); command.command.dialogueIds[0] = 'missing';
    const removing = session.request({ kind: 'board', command: { kind: 'removeShots', shotIds: ['a'] } });
    const freezing = session.request({ kind: 'freeze' });
    expect(session.snapshot().project).toEqual(p);
    expect(await session.request(text('blocked'))).toMatchObject({ ok: false, error: { code: 'busy' } });
    slow.resolve(painted); await success(drawing); await success(moving); await success(removing); await success(freezing);
    expect(session.snapshot().project.dialogues).toEqual([{ id: 'd', shotId: 'b', text: 'line' }]);
    expect(session.snapshot()).toMatchObject({ phase: 'frozen', checkpoint: { revision: 3 } });
  });
});


describe('board real checkpoint composition', () => {
  it('removes one shot, restores it and reopens using a real depot and synthetic PNG', async () => {
    const root = await temporaryWorkspace('flow-board-');
    const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#123456ff' } }).png().toBuffer();
    const p = project(); for (const image of Object.values(p.images)) image.layers[0].assetId = hash(png);
    const store = createProjectStore();
    expect((await store.saveCheckpoint(root, p, async () => png)).ok).toBe(true);
    const depot = value(await openFlowAssetDepot({ root, sessionId: 'session', maxPixels: 100, maxPngBytes: 10000 }));
    const harness = setup();
    const session = value(createFlowSession({ ...harness.options, project: p, assets: depot, checkpoint: (p, read) => store.saveCheckpoint(root, p, read) }));
    await success(session.request({ kind: 'board', command: { kind: 'removeShots', shotIds: ['a'] } }));
    await success(session.request({ kind: 'undo' }));
    await success(session.request({ kind: 'freeze' }));
    const reopened = await store.loadCheckpoint(root);
    expect(reopened.ok).toBe(true); if (!reopened.ok) throw Error(reopened.error.message);
    expect(reopened.value.project).toEqual(session.snapshot().project);
    expect(Buffer.from(await reopened.value.readAsset(hash(png)))).toEqual(png);
  });
});

describe('Session insertion admission', () => {
  const insertion = (assetId = initialAsset) => {
    const image = structuredClone(project().images.i_a); image.id = 'i_new'; image.layers[0].assetId = assetId;
    return { kind: 'board' as const, command: { kind: 'insertShot' as const,
      shot: { id: 'new', imageId: 'i_new', name: 'New', scriptText: '' }, image, index: 1 } };
  };
  it('rejects malformed, colliding and missing assets without installing history', async () => {
    const harness = setup(); const read = vi.fn(harness.options.assets.read);
    const session = value(createFlowSession({ ...harness.options, assets: { ...harness.options.assets, read } }));
    const before = session.snapshot().project;
    const invalid = insertion(); invalid.command.index = 20;
    expect(await session.request(invalid)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    const sparse = insertion(); sparse.command.image.layers = Array(1);
    expect(await session.request(sparse)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(read).not.toHaveBeenCalled();
    const fabricated = { ...insertion(), receipt: { assetId: initialAsset } };
    expect(await session.request(fabricated as unknown as Parameters<FlowSession['request']>[0])).toMatchObject({ ok: false });
    const missing = insertion('f'.repeat(64));
    expect(await session.request(missing)).toMatchObject({ ok: false, error: { code: 'missing-asset', effect: 'none' } });
    expect(read).toHaveBeenCalledTimes(1);
    expect(session.snapshot().project).toEqual(before);
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
  it.each(['sessionId', 'operationId', 'assetId', 'width', 'height', 'byteLength', 'directorySync'] as const)(
    'rejects a mismatched %s receipt without publishing', async field => {
      const harness = setup(); const base = harness.options.assets;
      const session = value(createFlowSession({ ...harness.options, assets: { ...base, async put(input) {
        const result = await base.put(input); if (!result.ok) return result;
        const bad = { ...result.value, [field]: field === 'width' || field === 'height' || field === 'byteLength' ? 99 : 'forged' };
        return { ok: true, value: bad as FlowAssetReceipt };
      } } }));
      const before = session.snapshot().project;
      expect(await session.request(insertion())).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'unknown' } });
      expect(session.snapshot().project).toEqual(before);
      expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    });
  it('reports retained partial admission and leaves project/checkpoint/history untouched', async () => {
    const harness = setup(); const first = initialAsset, second = hash(Uint8Array.of(8));
    harness.blobs.set(second, Uint8Array.of(8)); let puts = 0;
    const base = harness.options.assets;
    const session = value(createFlowSession({ ...harness.options, assets: { ...base, async put(input) {
      if (++puts === 2) return error('io-failure'); return base.put(input);
    } } }));
    await success(session.request({ kind: 'checkpoint' })); const before = session.snapshot();
    const cmd = insertion(first); cmd.command.image.layers.push({ ...cmd.command.image.layers[0], id: 'layer2', assetId: second });
    expect(await session.request(cmd)).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'retained' } });
    expect(session.snapshot().project).toEqual(before.project); expect(session.snapshot().checkpoint).toEqual(before.checkpoint);
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false });
  });
  it('snapshots input during await and serializes undo and freeze behind insertion', async () => {
    const harness = setup(); const gate = deferred<FlowResult<Uint8Array>>(); const base = harness.options.assets;
    const session = value(createFlowSession({ ...harness.options, assets: { ...base, read: () => gate.promise } }));
    const cmd = insertion(); const pending = session.request(cmd);
    cmd.command.shot.name = 'mutated'; cmd.command.image.layers[0].assetId = 'f'.repeat(64); cmd.command.index = 999;
    const undo = session.request({ kind: 'undo' }); const freeze = session.request({ kind: 'freeze' });
    await ticks(); expect(session.snapshot().project.shots.map(s => s.id)).toEqual(['a', 'b']);
    gate.resolve({ ok: true, value: initialBytes }); await success(pending); await success(undo); await success(freeze);
    expect(session.snapshot().project.shots.map(s => s.id)).toEqual(['a', 'b']);
    expect(session.snapshot()).toMatchObject({ phase: 'frozen', checkpoint: { revision: 2 } });
  });
  it('validates real depot dimensions and preserves insertion across undo, redo and checkpoint reopen', async () => {
    const root = await temporaryWorkspace('flow-insert-');
    const original = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#203040ff' } }).png().toBuffer();
    const fresh = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#abcdef88' } }).png().toBuffer();
    const p = project(); for (const image of Object.values(p.images)) image.layers[0].assetId = hash(original);
    const store = createProjectStore(); expect((await store.saveCheckpoint(root, p, async () => original)).ok).toBe(true);
    const depot = value(await openFlowAssetDepot({ root, sessionId: 'session', maxPixels: 100, maxPngBytes: 10000 }));
    value(await depot.put({ operationId: 'external_admission', png: fresh, width: 4, height: 3 }));
    const harness = setup(); const session = value(createFlowSession({ ...harness.options, project: p, assets: depot,
      checkpoint: (project, read) => store.saveCheckpoint(root, project, read) }));
    const wrong = insertion(hash(fresh)); wrong.command.image.width = 5; wrong.command.image.layers[0].width = 5;
    expect(await session.request(wrong)).toMatchObject({ ok: false });
    expect(session.snapshot().project).toEqual(p);
    expect(await session.request({ kind: 'undo' })).toMatchObject({ ok: false });
    await success(session.request(insertion(hash(fresh))));
    expect(session.snapshot().project.shots.map(s => s.id)).toEqual(['a', 'new', 'b']);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.shots.map(s => s.id)).toEqual(['a', 'b']);
    await success(session.request({ kind: 'redo' })); await success(session.request({ kind: 'freeze' }));
    const loaded = await store.loadCheckpoint(root); expect(loaded.ok).toBe(true); if (!loaded.ok) throw Error(loaded.error.message);
    expect(loaded.value.project).toEqual(session.snapshot().project);
    expect(Buffer.from(await loaded.value.readAsset(hash(fresh)))).toEqual(fresh);
  });
});

describe('queued pixel tools', () => {
  const mergeRequest = () => ({ kind: 'pixelTool' as const, shotId: 'a', tool: { kind: 'merge' as const, layerIds: ['layer', 'top'] } });
  const mergeProject = () => {
    const p = project(); p.images.i_a.layers[0].opacity = .5;
    p.images.i_a.layers.push({ ...p.images.i_a.layers[0], id: 'top', opacity: .7 }); return p;
  };
  const output = (image: ReturnType<typeof project>['images'][string]) => ({ png: Uint8Array.of(7, 6), width: 4, height: 3,
    baseline: structuredClone(image), plan: { kind: 'merge' as const, targetId: 'layer', removeIds: ['top'], targetProperties: { opacity: 1 as const, blendMode: 'normal' as const } } });
  it('merges as one image revision and one Undo; retains exact layer metadata and pixels for Redo', async () => {
    const p = mergeProject();
    const { session } = setup({ project: p, tools: { produce: async ({ image }) => ({ ok: true, value: output(image) }) } });
    await success(session.request(mergeRequest()));
    const merged = session.snapshot().project.images.i_a;
    expect(merged).toMatchObject({ revision: 1, layers: [{ id: 'layer', assetId: hash(Uint8Array.of(7, 6)), opacity: 1, blendMode: 'normal' }] });
    expect(merged.layers).toHaveLength(1);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.images.i_a).toEqual(p.images.i_a);
    await success(session.request({ kind: 'redo' })); expect(session.snapshot().project.images.i_a).toEqual(merged);
  });
  it.each(['baseline', 'plan', 'dimensions'] as const)('rejects forged %s before writing assets or history', async field => {
    const harness = setup(), put = vi.fn(harness.options.assets.put), p = mergeProject();
    const { session } = setup({ project: p, assets: { ...harness.options.assets, put }, tools: { produce: async ({ image }) => {
      const result = output(image);
      if (field === 'baseline') result.baseline.revision++;
      if (field === 'plan') result.plan.removeIds = ['foreign'];
      if (field === 'dimensions') result.width++;
      return { ok: true, value: result };
    } } });
    expect((await session.request(mergeRequest())).ok).toBe(false); expect(put).not.toHaveBeenCalled();
    expect(session.snapshot().project).toEqual(p); expect((await session.request({ kind: 'undo' })).ok).toBe(false);
  });
  it('keeps text during a slow tool and serializes Undo/freeze; captures caller inputs', async () => {
    const gate = deferred<FlowResult<ReturnType<typeof output>>>(), p = mergeProject();
    const { session } = setup({ project: p, tools: { produce: () => gate.promise } });
    const request = mergeRequest(); const pending = session.request(request); request.tool.layerIds[0] = 'mutated';
    await success(session.request(text('during merge')));
    const undo = session.request({ kind: 'undo' }), frozen = session.request({ kind: 'freeze' });
    gate.resolve({ ok: true, value: output(p.images.i_a) });
    await success(pending); await success(undo); await success(frozen);
    expect(session.snapshot().project.images.i_a).toEqual(p.images.i_a);
    expect(session.snapshot().project.shots[0].scriptText).toBe('during merge');
    expect(session.snapshot().phase).toBe('frozen');
  });
  it('rejects sparse colors and locked merges before producer work', async () => {
    const produce = vi.fn(), p = mergeProject(); p.images.i_a.layers[0].locked = true;
    const { session } = setup({ project: p, tools: { produce } });
    expect((await session.request(mergeRequest())).ok).toBe(false);
    expect((await session.request({ kind: 'pixelTool', shotId: 'a', tool: { kind: 'fill', layerId: 'top', x: 0, y: 0, tolerance: 0, color: Array(4) as any } })).ok).toBe(false);
    expect(produce).not.toHaveBeenCalled();
  });
  it('reports failed asset admission without publishing or adding history', async () => {
    const harness = setup(), p = mergeProject();
    const { session } = setup({ project: p, assets: { ...harness.options.assets, put: async () => error('io-failure', 'disk', 'unknown') },
      tools: { produce: async ({ image }) => ({ ok: true, value: output(image) }) } });
    expect(await session.request(mergeRequest())).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(session.snapshot().project).toEqual(p); expect((await session.request({ kind: 'undo' })).ok).toBe(false);
  });
});

describe('queued blank shot creation', () => {
  const request = () => ({ kind: 'newShot' as const, shotId: 'new', imageId: 'new_image', width: 4, height: 3, afterId: 'a' });
  it('admits real PNG and inserts once; Undo/Redo, freeze and reopen preserve the blank', async () => {
    const root = await temporaryWorkspace('flow-new-shot-');
    const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#fff' } }).png().toBuffer();
    const p = project(); for (const image of Object.values(p.images)) image.layers[0].assetId = hash(png);
    const store = createProjectStore(); value(await store.saveCheckpoint(root, p, async () => png) as any);
    const depot = value(await openFlowAssetDepot({ root, sessionId: 'session', maxPixels: 100, maxPngBytes: 10000 }));
    const h = setup(); const { session } = setup({ project: p, assets: depot, pixels: { ...h.options.pixels, blank: async () => ({ ok: true, value: { png, width: 4, height: 3 } }) }, checkpoint: (p,r) => store.saveCheckpoint(root,p,r) });
    await success(session.request(request())); expect(session.snapshot().project.shots.map(s => s.id)).toEqual(['a','new','b']);
    await success(session.request({ kind: 'undo' })); expect(session.snapshot().project.shots).toEqual(p.shots);
    await success(session.request({ kind: 'redo' })); await success(session.request({ kind: 'freeze' }));
    const loaded = await store.loadCheckpoint(root); expect(loaded.ok).toBe(true); if (!loaded.ok) throw Error(loaded.error.message);
    expect(loaded.value.project).toEqual(session.snapshot().project);
    expect(Buffer.from(await loaded.value.readAsset(loaded.value.project.images.new_image.layers[0].assetId))).toEqual(png);
  });
  it('rejects invalid IDs, missing anchors and producer failure without history or writes', async () => {
    const h=setup(), blank=vi.fn(async()=>error('io-failure')), put=vi.fn(h.options.assets.put);
    const {session}=setup({pixels:{...h.options.pixels,blank},assets:{...h.options.assets,put}});
    expect((await session.request({...request(),shotId:'a'})).ok).toBe(false);
    expect((await session.request({...request(),afterId:'p'})).ok).toBe(false);expect(blank).not.toHaveBeenCalled();
    expect((await session.request(request())).ok).toBe(false); expect(put).not.toHaveBeenCalled();
    expect(session.snapshot().project).toEqual(project());expect((await session.request({kind:'undo'})).ok).toBe(false);
  });
  it('snapshots creation and queues Undo/freeze while blank pixels are pending', async () => {
    const h=setup(), gate=deferred<FlowResult<FlowPixelOutput>>();
    const {session}=setup({pixels:{...h.options.pixels,blank:()=>gate.promise}});
    const input=request(), pending=session.request(input);input.shotId='mutated';input.width=99;
    const undo=session.request({kind:'undo'}), freeze=session.request({kind:'freeze'});
    gate.resolve({ok:true,value:{png:initialBytes,width:4,height:3}});
    await success(pending);await success(undo);await success(freeze);
    expect(session.snapshot().project.shots).toEqual(project().shots);expect(session.snapshot().phase).toBe('frozen');
  });
  it('can create the first shot on an empty board and rejects forged receipts', async () => {
    const h=setup(), p=project();p.shots=[];p.parkedShots=[];p.images={};
    const pixels={...h.options.pixels,blank:async()=>({ok:true as const,value:{png:initialBytes,width:4,height:3}})};
    const {session}=setup({project:p,pixels});
    const {afterId,...first}=request();await success(session.request(first));expect(session.snapshot().project.shots).toHaveLength(1);
    const {session:bad}=setup({project:p,pixels,assets:{...h.options.assets,put:async input=>{const r=await h.options.assets.put(input);if(!r.ok)return r;return {ok:true,value:{...r.value,sessionId:'foreign'}}}}});
    expect(await bad.request(first)).toMatchObject({ok:false,error:{effect:'unknown'}});expect(bad.snapshot().project).toEqual(p);
  });
});

it('installs a refresh as one history entry without replacing text and preserves Undo/Redo',async()=>{
 const s=setup({refresh:async before=>{const after=structuredClone(before);after.revision++;after.images.i_a.layers[0].name='external name';return {ok:true,value:after};}});
 await success(s.session.request({kind:'board',command:{kind:'setScriptText',shotId:'a',text:'local words'}}));
 const before=s.session.snapshot().project;
 await success(s.session.request({kind:'refresh'}));
 expect(s.session.snapshot().project.shots).toEqual(before.shots);
 expect(s.session.snapshot().project.images.i_a.layers[0].name).toBe('external name');
 await success(s.session.request({kind:'undo'}));expect(s.session.snapshot().project.images).toEqual(before.images);
 await success(s.session.request({kind:'redo'}));expect(s.session.snapshot().project.images.i_a.layers[0].name).toBe('external name');
});
it('blocks editing after unknown refresh outcome, then retries without pre-checkpointing the stale state',async()=>{
 let calls=0;const s=setup({refresh:async before=>{if(++calls===1)return error('io-failure','retained journal','unknown');const after=structuredClone(before);after.revision++;after.images.i_a.layers[0].name='accepted';return {ok:true,value:after};}});
 expect(await s.session.request({kind:'refresh'})).toMatchObject({ok:false,error:{effect:'unknown'}});
 expect(await s.session.request({kind:'undo'})).toMatchObject({ok:false,error:{code:'busy'}});
 const checkpointCount=s.saved.length;
 await success(s.session.request({kind:'refresh'}));expect(s.saved).toHaveLength(checkpointCount);
 await success(s.session.request({kind:'undo'}));expect(s.session.snapshot().project.images.i_a.layers[0].name).toBe('Image');
});
it('rejects refresh results that alter project text or reference unavailable new assets',async()=>{
 const changed=setup({refresh:async before=>{const after=structuredClone(before);after.revision++;after.shots[0].scriptText='untrusted';return {ok:true,value:after};}});
 expect(await changed.session.request({kind:'refresh'})).toMatchObject({ok:false,error:{effect:'unknown'}});
 expect(changed.session.snapshot().project.shots[0].scriptText).toBe('');
 const missing=setup({refresh:async before=>{const after=structuredClone(before);after.revision++;after.images.i_a.layers[0].assetId='a'.repeat(64);return {ok:true,value:after};}});
 expect(await missing.session.request({kind:'refresh'})).toMatchObject({ok:false,error:{effect:'unknown'}});
 expect(missing.session.snapshot().project.images.i_a.layers[0].assetId).toBe(initialAsset);
});
it('does not let queued edits or Close trap a retained refresh in the freezing phase',async()=>{
 const waiting=deferred<FlowResult<ProjectV1>>();let attempt=0;
 const s=setup({refresh:async before=>++attempt===1?waiting.promise:{ok:true,value:before}});
 const refreshing=s.session.request({kind:'refresh'});await ticks();
 const edit=s.session.request({kind:'board',command:{kind:'setScriptText',shotId:'a',text:'must not install'}});
 const close=s.session.request({kind:'freeze'});
 waiting.resolve(error('io-failure','retry','unknown'));
 expect(await refreshing).toMatchObject({ok:false});expect(await edit).toMatchObject({ok:false});expect(await close).toMatchObject({ok:false});
 expect(s.session.snapshot().phase).toBe('active');expect(s.session.snapshot().project.shots[0].scriptText).toBe('');
 await success(s.session.request({kind:'refresh'}));
});

describe('structural layer workflow',()=>{
 const blank=vi.fn(async()=>painted);
 const make=()=>setup({pixels:{blank,produce:async()=>({ok:true,value:{png:Uint8Array.of(4,5,6),width:4,height:3}})}});
 it('admits a new layer, paints it, removes it and restores exact assets through history',async()=>{
  const {session,blobs}=make();
  await success(session.request({kind:'newLayer',shotId:'a',layerId:'ink',afterId:'layer'}));
  expect(blank).toHaveBeenLastCalledWith(4,3,'transparent');
  const added=session.snapshot().project.images.i_a;
  expect(added.layers.map(l=>l.id)).toEqual(['layer','ink']);expect(blobs.has(added.layers[1].assetId)).toBe(true);
  await success(session.request({...paint(),layerId:'ink'}));
  const drawn=session.snapshot().project.images.i_a;
  await success(session.request({kind:'layer',shotId:'a',edit:{kind:'removeLayer',layerId:'ink'}}));
  await success(session.request({kind:'undo'}));expect(session.snapshot().project.images.i_a).toEqual(drawn);
  await success(session.request({kind:'undo'}));expect(session.snapshot().project.images.i_a).toEqual(added);
  await success(session.request({kind:'undo'}));expect(session.snapshot().project.images.i_a.layers).toHaveLength(1);
  await success(session.request({kind:'redo'}));expect(session.snapshot().project.images.i_a).toEqual(added);
 });
 it('rejects stale, duplicate and parked requests before producing pixels; failed admission creates no history',async()=>{
  const producer=vi.fn(async()=>painted),{session}=setup({pixels:{blank:producer,produce:async()=>painted}});
  for(const request of [{kind:'newLayer',shotId:'a',layerId:'layer'},{kind:'newLayer',shotId:'p',layerId:'new'},{kind:'newLayer',shotId:'a',layerId:'new',afterId:'missing'}] as const)expect((await session.request(request)).ok).toBe(false);
  expect(producer).not.toHaveBeenCalled();expect((await session.request({kind:'undo'})).ok).toBe(false);
  const failed=setup({pixels:{blank:async()=>error('io-failure'),produce:async()=>painted}}).session;
  expect((await failed.request({kind:'newLayer',shotId:'a',layerId:'new'})).ok).toBe(false);
  expect(failed.snapshot().project).toEqual(project());
 });
 it('queues Undo behind new layer creation and freezes only after its exact checkpoint',async()=>{
  const gate=deferred<FlowResult<FlowPixelOutput>>();const {session,saved}=setup({pixels:{blank:()=>gate.promise,produce:async()=>painted}});
  const add=session.request({kind:'newLayer',shotId:'a',layerId:'new'}),undo=session.request({kind:'undo'}),freeze=session.request({kind:'freeze'});
  gate.resolve(painted);await success(add);await success(undo);await success(freeze);
  expect(session.snapshot().project.images.i_a.layers).toHaveLength(1);expect(saved.at(-1)).toEqual(session.snapshot().project);
 });
 it('moves a group in stack order as one undoable action and refuses locked members atomically',async()=>{
  const p=project();p.images.i_a.layers=['a','b','c','d'].map(id=>({...p.images.i_a.layers[0],id}));
  const {session}=setup({project:p});
  const move={kind:'layer' as const,shotId:'a',edit:{kind:'moveLayers' as const,layerIds:['c','a'],targetLayerId:'d',placement:'after' as const}};
  await success(session.request(move));expect(session.snapshot().project.images.i_a.layers.map(l=>l.id)).toEqual(['b','d','a','c']);
  await success(session.request({kind:'undo'}));expect(session.snapshot().project.images.i_a).toEqual(p.images.i_a);
  await success(session.request({kind:'layer',shotId:'a',edit:{kind:'setLayer',layerId:'c',patch:{locked:true}}}));
  const before=session.snapshot().project;expect((await session.request(move)).ok).toBe(false);expect(session.snapshot().project).toEqual(before);
 });
});
