import { describe, expect, it } from 'vitest';
import { createImageFrameStore, validateImageFrame, type FrameIdentity, type ImageFrameHeader, type FrameSnapshot } from './frames';

const who: FrameIdentity = { sessionId: 'session', incarnation: 'incarnation', documentId: 'doc', workerEpoch: 0, epoch: 0 };
const rgba = (...v: number[]) => new Uint8Array(v);
const red = [255, 0, 0, 255], blue = [0, 0, 255, 128], clear = [0, 0, 0, 0];
const key = (patch: Partial<ImageFrameHeader> = {}): ImageFrameHeader => ({ ...who, frameSeq: 1, baseFrameSeq: null,
  imageVersionRef: 'version-1', inputThrough: 0, width: 2, height: 2, encoding: 'srgb-rgba8-straight',
  tiles: [{ x: 0, y: 0, w: 2, h: 2, offset: 0, length: 16 }], ...patch });
const delta = (seq = 2, patch: Partial<ImageFrameHeader> = {}): ImageFrameHeader => key({ frameSeq: seq, baseFrameSeq: seq - 1,
  inputThrough: seq, tiles: [{ x: 0, y: 0, w: 1, h: 1, offset: 0, length: 4 }], ...patch });
const seed = () => { const store = createImageFrameStore(who); expect(store.accept(key(), rgba(...red, ...red, ...red, ...red)).ok).toBe(true); return store; };
const pixels = (store: ReturnType<typeof createImageFrameStore>) => Array.from(store.snapshot().frame!.pixels);
const bad = (h: unknown, p: unknown, code = 'invalid-frame') => expect(validateImageFrame(h, p)).toMatchObject({ ok: false, code });

describe('native display frame validation', () => {
  it('snapshots a nonzero-offset view and tile metadata without copying unrelated pooled bytes', () => {
    const pool = rgba(99, 98, ...red, ...red, ...red, ...red, 97);
    const h = key(); const result = validateImageFrame(h, pool.subarray(2, 18));
    expect(result.ok).toBe(true); if (!result.ok) return;
    pool.fill(0); h.tiles[0].x = 1;
    expect(Array.from(result.value.pixels)).toEqual([...red, ...red, ...red, ...red]);
    expect(result.value.header.tiles[0].x).toBe(0);
  });
  it('copies Buffer views rather than inheriting Buffer.slice aliasing', () => {
    const pooled = Buffer.from([99, ...red, ...red, ...red, ...red, 98]);
    const result = validateImageFrame(key(), pooled.subarray(1, 17));
    expect(result.ok).toBe(true); pooled.fill(7);
    if (result.ok) expect(Array.from(result.value.pixels)).toEqual([...red, ...red, ...red, ...red]);
  });
  it('accepts an out-of-order payload directory when ranges and rectangles exactly partition', () => {
    const result = validateImageFrame(key({ tiles: [
      { x: 0, y: 0, w: 2, h: 1, offset: 8, length: 8 },
      { x: 0, y: 1, w: 2, h: 1, offset: 0, length: 8 },
    ] }), rgba(...blue, ...blue, ...red, ...red));
    expect(result.ok).toBe(true);
  });
  it.each(['sessionId', 'incarnation', 'documentId', 'workerEpoch', 'epoch', 'frameSeq', 'inputThrough', 'width', 'height', 'encoding', 'imageVersionRef'] as const)('requires valid %s', field => {
    bad({ ...key(), [field]: undefined }, new Uint8Array(16));
  });
  it.each([NaN, Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1])('refuses unsafe geometry and sequences: %s', n => {
    bad(key({ width: n }), new Uint8Array(16)); bad(key({ frameSeq: n }), new Uint8Array(16));
    bad(key({ tiles: [{ x: 0, y: 0, w: 2, h: 2, offset: n, length: 16 }] }), new Uint8Array(16));
  });
  it('enforces budgets before allocating or accepting oversized images', () => {
    expect(validateImageFrame(key(), new Uint8Array(16), { maxPixels: 3, maxPayloadBytes: 16, maxTiles: 1, maxDimension: 2 })).toMatchObject({ code: 'resource-limit' });
    expect(validateImageFrame(key(), new Uint8Array(16), { maxPixels: 4, maxPayloadBytes: 15, maxTiles: 1, maxDimension: 2 })).toMatchObject({ code: 'resource-limit' });
    expect(validateImageFrame(key(), new Uint8Array(16), { maxPixels: 4, maxPayloadBytes: 16, maxTiles: 1, maxDimension: 1 })).toMatchObject({ code: 'resource-limit' });
    bad(key({ width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }), new Uint8Array(16), 'resource-limit');
    expect(() => createImageFrameStore(who, { maxPixels: Number.MAX_SAFE_INTEGER, maxPayloadBytes: 16, maxTiles: 1, maxDimension: 2 })).toThrow();
    expect(() => createImageFrameStore(who, { maxPixels: 4, maxPayloadBytes: 16, maxTiles: 4097, maxDimension: 2 })).toThrow();
  });
  it('refuses sparse lists, partial keyframes, overlaps, gaps and trailing bytes', () => {
    bad(key({ tiles: new Array(1) }), new Uint8Array(16));
    bad(key({ tiles: [] }), new Uint8Array(16));
    bad(key({ tiles: delta().tiles }), new Uint8Array(4));
    const tile = { x: 0, y: 0, w: 1, h: 1, offset: 0, length: 4 };
    bad(delta(2, { tiles: [tile, { ...tile, offset: 4 }] }), new Uint8Array(8));
    bad(delta(2, { tiles: [tile, { ...tile, x: 1 }] }), new Uint8Array(8));
    bad(delta(2, { tiles: [{ ...tile, offset: 1 }] }), new Uint8Array(5));
    bad(delta(), new Uint8Array(5));
    bad(delta(2, { tiles: [{ ...tile, x: 2 }] }), new Uint8Array(4));
    bad(delta(2, { tiles: [{ ...tile, length: 3 }] }), new Uint8Array(4));
    bad(delta(2, { tiles: [{ ...tile, offset: Number.MAX_SAFE_INTEGER }] }), new Uint8Array(4));
  });
  it('refuses incomplete payloads, nonbyte views, shared memory and throwing accessors', () => {
    bad(key(), new Uint8Array(15)); bad(key(), new Float32Array(4)); bad(key(), new ArrayBuffer(16));
    bad(key(), new Uint8Array(new SharedArrayBuffer(16)));
    let invoked = 0; bad({ get sessionId() { invoked++; throw Error('hostile'); } }, new Uint8Array(16)); expect(invoked).toBe(0);
    bad(key({ tiles: [Object.defineProperty({}, 'x', { get() { throw Error('tile accessor'); } }) as never] }), new Uint8Array(16));
    const detached = new Uint8Array(16); structuredClone(detached.buffer, { transfer: [detached.buffer] }); bad(key(), detached);
  });
  it('requires a preview id for the uninstalled initial version', () => {
    bad(key({ imageVersionRef: null }), new Uint8Array(16));
    expect(validateImageFrame(key({ imageVersionRef: null, previewId: 'initial-live' }), new Uint8Array(16)).ok).toBe(true);
  });
});

describe('one complete frame owner for both surfaces', () => {
  it('publishes exact absolute replacement pixels including zero alpha and does not reblend', () => {
    const store = seed(); expect(store.accept(delta(), rgba(...clear)).ok).toBe(true);
    expect(pixels(store)).toEqual([...clear, ...red, ...red, ...red]);
    expect(store.accept(delta(3, { tiles: [{ x: 1, y: 1, w: 1, h: 1, offset: 0, length: 4 }] }), rgba(...blue)).ok).toBe(true);
    expect(pixels(store)).toEqual([...clear, ...red, ...red, ...blue]);
  });
  it('copies each packed row to the correct full-canvas stride', () => {
    const store = seed(); expect(store.accept(delta(2, { tiles: [{ x: 1, y: 0, w: 1, h: 2, offset: 0, length: 8 }] }), rgba(...blue, ...clear)).ok).toBe(true);
    expect(pixels(store)).toEqual([...red, ...blue, ...red, ...clear]);
  });
  it('never installs half a frame, even when earlier tiles are valid', () => {
    const store = seed(), before = pixels(store); let events = 0; store.subscribe(() => events++);
    const header = delta(2, { tiles: [{ x: 0, y: 0, w: 1, h: 1, offset: 0, length: 4 }, { x: 1, y: 1, w: 1, h: 1, offset: 4, length: 4 }] });
    expect(store.accept(header, rgba(...blue)).ok).toBe(false); expect(pixels(store)).toEqual(before); expect(events).toBe(0);
    expect(store.accept(header, rgba(...blue, ...clear)).ok).toBe(true); expect(pixels(store)).toEqual([...blue, ...red, ...red, ...clear]); expect(events).toBe(1);
  });
  it('requires a keyframe after a dropped delta instead of treating latest delta as cumulative', () => {
    const store = seed();
    // Missing F2 edits A. F3 carries only B: installing it would silently lose A.
    expect(store.accept(delta(3, { tiles: [{ x: 1, y: 0, w: 1, h: 1, offset: 0, length: 4 }] }), rgba(...blue))).toMatchObject({ code: 'needs-keyframe' });
    expect(store.snapshot()).toMatchObject({ needsKeyframe: true, frame: null });
    expect(store.accept(delta(2), rgba(...clear))).toMatchObject({ code: 'needs-keyframe' });
    expect(store.accept(key({ frameSeq: 4, inputThrough: 3 }), rgba(...clear, ...blue, ...red, ...red)).ok).toBe(true);
    expect(pixels(store)).toEqual([...clear, ...blue, ...red, ...red]);
  });
  it('rejects a wrong base, and accepts a cumulative delta only on its actual base', () => {
    const store = seed(); expect(store.accept(delta(), rgba(...blue)).ok).toBe(true);
    expect(store.accept(delta(3, { baseFrameSeq: 1 }), rgba(...clear))).toMatchObject({ code: 'needs-keyframe' });
    expect(store.accept(key({ frameSeq: 5, inputThrough: 5 }), rgba(...blue, ...clear, ...red, ...red)).ok).toBe(true);
  });
  it('rejects duplicates and late keyframes without changing current pixels', () => {
    const store = seed(); expect(store.accept(delta(), rgba(...blue)).ok).toBe(true); const before = pixels(store);
    expect(store.accept(delta(), rgba(...clear))).toMatchObject({ code: 'stale-frame' });
    expect(store.accept(key(), new Uint8Array(16))).toMatchObject({ code: 'stale-frame' }); expect(pixels(store)).toEqual(before);
  });
  it.each(['sessionId', 'incarnation', 'documentId', 'workerEpoch', 'epoch'] as const)('never adopts changed %s without reset', field => {
    const store = seed(); const before = pixels(store);
    const header = key({ frameSeq: 10, [field]: typeof who[field] === 'number' ? 1 : 'other' });
    expect(store.accept(header, new Uint8Array(16))).toMatchObject({ code: 'wrong-identity' }); expect(pixels(store)).toEqual(before);
  });
  it('resets on history epoch and worker restart; old frames cannot restore obsolete pixels', () => {
    const store = seed(), next = { ...who, epoch: 1 }; expect(store.reset(next).ok).toBe(true);
    expect(store.snapshot().frame).toBeNull(); expect(store.accept(key({ frameSeq: 20 }), new Uint8Array(16))).toMatchObject({ code: 'wrong-identity' });
    expect(store.accept(key({ ...next }), rgba(...blue, ...blue, ...blue, ...blue)).ok).toBe(true);
    expect(store.reset({ ...next, epoch: 0 })).toMatchObject({ code: 'stale-frame' });
    const restart = { ...who, workerEpoch: 1 }; expect(store.reset(restart).ok).toBe(true);
    expect(store.accept(key({ ...next, frameSeq: 2 }), new Uint8Array(16))).toMatchObject({ code: 'wrong-identity' });
    expect(store.accept(key({ ...restart }), rgba(...clear, ...clear, ...clear, ...clear)).ok).toBe(true); expect(pixels(store)).toEqual(Array(16).fill(0));
  });
  it('same-identity reset does not allow a delayed old keyframe back in', () => {
    const store = seed(); expect(store.reset(who).ok).toBe(true);
    expect(store.accept(key(), new Uint8Array(16))).toMatchObject({ code: 'stale-frame' });
    expect(store.accept(key({ frameSeq: 2 }), new Uint8Array(16)).ok).toBe(true);
  });
  it('rejects resizing deltas and decreasing input coverage', () => {
    const store = seed(); expect(store.accept(delta(), rgba(...blue)).ok).toBe(true); const before = pixels(store);
    expect(store.accept(delta(3, { width: 3 }), rgba(...clear))).toMatchObject({ code: 'invalid-frame' });
    expect(store.accept(delta(3, { inputThrough: 1 }), rgba(...clear))).toMatchObject({ code: 'stale-frame' }); expect(pixels(store)).toEqual(before);
    expect(store.accept(key({ frameSeq: 3, imageVersionRef: null, previewId: 'new-live', inputThrough: 3 }), new Uint8Array(16))).toMatchObject({ code: 'invalid-frame' });
  });
  it('publishes the same complete state to two subscribers, isolating bytes and observer failures', () => {
    const store = seed(), a: FrameSnapshot[] = [], b: FrameSnapshot[] = [];
    const stop = store.subscribe(s => { a.push(structuredClone(s)); s.frame!.pixels.fill(9); s.frame!.header.tiles[0].x = 9; throw Error('bad consumer'); });
    store.subscribe(s => b.push(s)); expect(store.accept(delta(), rgba(...blue)).ok).toBe(true);
    expect(a[0]).toEqual(b[0]); expect(pixels(store)).toEqual([...blue, ...red, ...red, ...red]);
    stop(); expect(store.accept(delta(3), rgba(...clear)).ok).toBe(true); expect(a).toHaveLength(1); expect(b).toHaveLength(2);
    // A newly mounted surface starts from this entire backing, not the latest one-pixel patch.
    expect(pixels(store)).toEqual([...clear, ...red, ...red, ...red]);
  });
  it('same identity resync preserves input and installed-version floors', () => {
    const store = seed(); expect(store.accept(delta(), rgba(...blue)).ok).toBe(true); store.reset(who);
    expect(store.accept(key({ frameSeq: 3, inputThrough: 1 }), new Uint8Array(16))).toMatchObject({ code: 'stale-frame' });
    expect(store.accept(key({ frameSeq: 3, inputThrough: 3, imageVersionRef: null, previewId: 'live' }), new Uint8Array(16))).toMatchObject({ code: 'invalid-frame' });
    expect(store.accept(key({ frameSeq: 3, inputThrough: 3 }), new Uint8Array(16)).ok).toBe(true);
  });
  it('refuses reentrant mutation and releases listener ownership on dispose', () => {
    const store = seed(), results: unknown[] = []; store.subscribe(() => {
      results.push(store.accept(delta(3), rgba(...clear)), store.reset(who));
    });
    expect(store.accept(delta(), rgba(...blue)).ok).toBe(true); expect(pixels(store)).toEqual([...blue, ...red, ...red, ...red]);
    expect(results).toEqual([expect.objectContaining({ code: 'busy' }), expect.objectContaining({ code: 'busy' })]);
    store.dispose(); expect(store.snapshot().frame).toBeNull(); expect(store.accept(delta(3), rgba(...clear))).toMatchObject({ code: 'disposed' });
    expect(store.reset(who)).toMatchObject({ code: 'disposed' });
    let called = false; store.subscribe(() => { called = true; }); store.dispose(); expect(called).toBe(false);
  });
});
