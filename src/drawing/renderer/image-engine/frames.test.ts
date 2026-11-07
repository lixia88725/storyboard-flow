import { describe, expect, it } from 'vitest';
import { createImageFrameStore, validateImageFrame, type FrameIdentity, type ImageFrameHeader, type FrameView } from './frames';

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
    expect(store.snapshot().frame!.header).not.toHaveProperty('tiles');
    expect(store.snapshot().frame!.header).not.toHaveProperty('baseFrameSeq');
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
    const store = seed(), a: { header: unknown; pixels: number[] }[] = [], b: { header: unknown; pixels: number[] }[] = [];
    const stop = store.subscribe(s => { a.push({ header: { ...s.header }, pixels: Array.from(s.readRegion()!) }); s.readRegion()!.fill(9); s.header!.width = 9; throw Error('bad consumer'); });
    store.subscribe(s => b.push({ header: { ...s.header }, pixels: Array.from(s.readRegion()!) })); expect(store.accept(delta(), rgba(...blue)).ok).toBe(true);
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
  it('keeps old views stable across a delta and reads only requested regions across internal tile seams', () => {
    const store = createImageFrameStore(who), width = 258;
    const bytes = new Uint8Array(width * 2 * 4);
    for (let i = 0; i < width * 2; i++) bytes.set(red, i * 4);
    const h = key({ width, height: 2, tiles: [{ x: 0, y: 0, w: width, h: 2, offset: 0, length: bytes.length }] });
    expect(store.accept(h, bytes).ok).toBe(true); const old = store.view();
    const notifications: FrameView[] = []; store.subscribe(v => notifications.push(v));
    expect(store.accept(delta(2, { width, height: 2, tiles: [{ x: 255, y: 0, w: 3, h: 2, offset: 0, length: 24 }] }), rgba(...blue, ...clear, ...blue, ...clear, ...blue, ...clear)).ok).toBe(true);
    expect(Array.from(old.readRegion({ x: 255, y: 0, w: 3, h: 2 })!)).toEqual([...red, ...red, ...red, ...red, ...red, ...red]);
    expect(Array.from(notifications[0].readRegion({ x: 255, y: 0, w: 3, h: 2 })!)).toEqual([...blue, ...clear, ...blue, ...clear, ...blue, ...clear]);
    expect(notifications[0]).not.toHaveProperty('pixels');
    expect(notifications[0].damage).toEqual([{ x: 255, y: 0, w: 3, h: 2 }]);
    expect(() => old.readRegion({ x: 258, y: 0, w: 1, h: 1 })).toThrow(RangeError);
    expect(() => old.readRegion({ x: 0, y: 0, w: Number.MAX_SAFE_INTEGER, h: 1 })).toThrow(RangeError);
    store.dispose(); expect(store.view().readRegion()).toBeNull();
  });
  it('matches a flat reference after overlapping updates across horizontal and vertical chunk seams', () => {
    const store = createImageFrameStore(who), width = 259, height = 258;
    const reference = new Uint8Array(width * height * 4);
    expect(store.accept(key({ width, height, tiles: [{ x: 0, y: 0, w: width, h: height, offset: 0, length: reference.length }] }), reference).ok).toBe(true);
    const regions = [{ x: 254, y: 254, w: 5, h: 4 }, { x: 0, y: 255, w: 259, h: 2 }, { x: 255, y: 0, w: 4, h: 258 }, { x: 12, y: 12, w: 3, h: 3 }];
    for (let i = 0; i < 16; i++) {
      const r = regions[i % regions.length], patch = new Uint8Array(r.w * r.h * 4);
      for (let j = 0; j < patch.length; j++) patch[j] = (i * 17 + j * 11) % 256;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) for (let c = 0; c < 4; c++)
        reference[((r.y + y) * width + r.x + x) * 4 + c] = patch[(y * r.w + x) * 4 + c];
      expect(store.accept(delta(i + 2, { width, height, tiles: [{ ...r, offset: 0, length: patch.length }] }), patch).ok).toBe(true);
      expect(Buffer.compare(store.snapshot().frame!.pixels, reference)).toBe(0);
    }
  });
  it('notifies both borrowed surfaces to conceal pixels when the owner is disposed', () => {
    const store = seed(), a: FrameView[] = [], b: FrameView[] = []; store.subscribe(v => a.push(v)); store.subscribe(v => b.push(v));
    store.dispose(); expect(a).toHaveLength(1); expect(b).toHaveLength(1);
    for (const v of [a[0], b[0]]) { expect(v.header).toBeNull(); expect(v.needsKeyframe).toBe(true); expect(v.readRegion()).toBeNull(); }
    store.dispose(); expect(a).toHaveLength(1); expect(b).toHaveLength(1);
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
