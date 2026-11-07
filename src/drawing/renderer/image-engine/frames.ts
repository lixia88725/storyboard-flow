/** Native display transport descriptor. Pixels are the document composite, never a layer.
 * RGBA8 is straight-alpha sRGB, top-left origin, tightly packed rows per tile.
 * Tile bytes REPLACE the destination (including alpha=0). No blend is performed here.
 * Main→renderer currently clones bytes; this Interface makes no zero-copy claim.
 */
export type FrameIdentity = {
  sessionId: string;
  incarnation: string;
  documentId: string;
  workerEpoch: number;
  epoch: number;
};
export type FrameTile = { x: number; y: number; w: number; h: number; offset: number; length: number };
export type ImageFrameHeader = FrameIdentity & {
  frameSeq: number;
  baseFrameSeq: number | null;
  imageVersionRef: string | null;
  previewId?: string;
  /** Display lineage only; these completed strokes are not yet durable-accepted.
   * imageVersionRef identifies only the accepted prefix, not all displayed pixels. */
  pipelineId?: string;
  pendingOperationIds?: readonly string[];
  workingHeadOperationId?: string;
  inputThrough: number;
  width: number;
  height: number;
  encoding: 'srgb-rgba8-straight';
  tiles: readonly FrameTile[];
};
export type FrameLimits = { maxPixels: number; maxPayloadBytes: number; maxTiles: number; maxDimension: number };
export const defaultFrameLimits: Readonly<FrameLimits> = Object.freeze({
  maxPixels: 16_777_216, maxPayloadBytes: 67_108_864, maxTiles: 4096, maxDimension: 32768,
});
export type FrameFailureCode = 'invalid-frame' | 'resource-limit' | 'wrong-identity' | 'stale-frame' | 'needs-keyframe' | 'busy' | 'disposed';
export type FrameResult<T> = { ok: true; value: T } | { ok: false; code: FrameFailureCode; message: string };
const fail = (code: FrameFailureCode, message: string): FrameResult<never> => ({ ok: false, code, message });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
function dataFields(v: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!record(v)) return;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (d && !Object.hasOwn(d, 'value')) return;
    out[key] = d?.value;
  }
  return out;
}
const identityKeys = ['sessionId', 'incarnation', 'documentId', 'workerEpoch', 'epoch'];
function identity(v: unknown): FrameIdentity | undefined {
  v = dataFields(v, identityKeys);
  if (!record(v) || !text(v.sessionId) || !text(v.incarnation) || !text(v.documentId) || !integer(v.workerEpoch) || !integer(v.epoch)) return;
  return { sessionId: v.sessionId, incarnation: v.incarnation, documentId: v.documentId, workerEpoch: v.workerEpoch, epoch: v.epoch };
}
function limitsOf(v: FrameLimits): FrameLimits {
  if (!record(v) || !integer(v.maxPixels, 1) || v.maxPixels > Math.floor(Number.MAX_SAFE_INTEGER / 4) ||
      !integer(v.maxPayloadBytes, 1) || !integer(v.maxTiles, 1) || v.maxTiles > 4096 || !integer(v.maxDimension, 1))
    throw Error('Invalid frame limits (maxTiles must not exceed 4096)');
  return { maxPixels: v.maxPixels, maxPayloadBytes: v.maxPayloadBytes, maxTiles: v.maxTiles, maxDimension: v.maxDimension };
}
const sameIdentity = (a: FrameIdentity, b: FrameIdentity) => a.sessionId === b.sessionId && a.incarnation === b.incarnation &&
  a.documentId === b.documentId && a.workerEpoch === b.workerEpoch && a.epoch === b.epoch;
export type InstalledFrameHeader = Omit<ImageFrameHeader, 'tiles' | 'baseFrameSeq'>;
const installedHeader = (h: ImageFrameHeader): InstalledFrameHeader => {
  const { tiles: _tiles, baseFrameSeq: _base, ...meta } = h;
  return { ...meta, ...(meta.pendingOperationIds ? { pendingOperationIds: [...meta.pendingOperationIds] } : {}) };
};

/** Validates a complete transport frame, then takes a private copy of its exact byte view.
 * Sparse lists, overlapping rectangles/ranges, unused payload and partial keyframes are refused.
 * Chunk assembly belongs to transport: never call this Interface before the whole frame arrives.
 */
export function validateImageFrame(header: unknown, payload: unknown, limits: FrameLimits = defaultFrameLimits): FrameResult<{ header: ImageFrameHeader; pixels: Uint8Array }> {
  try {
    header = dataFields(header, [...identityKeys, 'frameSeq', 'baseFrameSeq', 'imageVersionRef', 'previewId', 'pipelineId', 'pendingOperationIds', 'workingHeadOperationId', 'inputThrough', 'width', 'height', 'encoding', 'tiles']);
    const cap = limitsOf(limits), own = identity(header);
    if (!own || !record(header) || !integer(header.frameSeq, 1) ||
        !(header.baseFrameSeq === null || (integer(header.baseFrameSeq, 1) && header.baseFrameSeq < header.frameSeq)) ||
        !(header.imageVersionRef === null || text(header.imageVersionRef)) ||
        !(header.previewId === undefined || text(header.previewId)) || (header.imageVersionRef === null && !text(header.previewId)) ||
        !integer(header.inputThrough) || !integer(header.width, 1) || !integer(header.height, 1) || header.encoding !== 'srgb-rgba8-straight')
      return fail('invalid-frame', 'Invalid frame identity, sequence, version or dimensions');
    const pipeline = header.pipelineId;
    const pending = header.pendingOperationIds;
    const head = header.workingHeadOperationId;
    let pendingIds: string[] | undefined;
    if (pipeline === undefined) {
      if (pending !== undefined || head !== undefined) return fail('invalid-frame', 'Pending lineage requires a pipeline identity');
    } else {
      if (!text(pipeline) || !Array.isArray(pending) || pending.length > 4)
        return fail('invalid-frame', 'Invalid pipeline identity or bounded pending list');
      pendingIds = [];
      for (let i = 0; i < pending.length; i++) {
        const entry = Object.getOwnPropertyDescriptor(pending, String(i));
        if (!entry || !Object.hasOwn(entry, 'value') || !text(entry.value) || pendingIds.includes(entry.value))
          return fail('invalid-frame', 'Pending operations must be distinct own string entries');
        pendingIds.push(entry.value);
      }
      if (head !== pendingIds.at(-1)) return fail('invalid-frame', 'Working head must equal the pending tail');
    }
    if (header.width > cap.maxDimension || header.height > cap.maxDimension || header.width > Math.floor(cap.maxPixels / header.height))
      return fail('resource-limit', 'Frame exceeds canvas budget');
    if (!(payload instanceof Uint8Array) || !(payload.buffer instanceof ArrayBuffer)) return fail('invalid-frame', 'Payload must be an unshared Uint8Array');
    if (payload.byteLength > cap.maxPayloadBytes) return fail('resource-limit', 'Payload exceeds byte budget');
    if (!Array.isArray(header.tiles) || header.tiles.length > cap.maxTiles) return fail('resource-limit', 'Tile list exceeds budget or is invalid');
    if (!header.tiles.length) return fail('invalid-frame', 'An empty update is not a frame');
    const tiles: FrameTile[] = [];
    let bytes = 0;
    for (let i = 0; i < header.tiles.length; i++) {
      if (!Object.hasOwn(header.tiles, i)) return fail('invalid-frame', 'Sparse tile list');
      const entry = Object.getOwnPropertyDescriptor(header.tiles, String(i));
      if (!entry || !Object.hasOwn(entry, 'value')) return fail('invalid-frame', 'Accessor tile entry');
      const t: unknown = dataFields(entry.value, ['x', 'y', 'w', 'h', 'offset', 'length']);
      if (!record(t) || !integer(t.x) || !integer(t.y) || !integer(t.w, 1) || !integer(t.h, 1) || !integer(t.offset) || !integer(t.length, 1) ||
          t.w > header.width || t.h > header.height || t.x > header.width - t.w || t.y > header.height - t.h ||
          t.w > Math.floor(cap.maxPixels / t.h) || t.length !== t.w * t.h * 4 || t.length > payload.byteLength || t.offset > payload.byteLength - t.length)
        return fail('invalid-frame', 'Invalid tile geometry or byte range');
      if (t.length > payload.byteLength - bytes) return fail('invalid-frame', 'Tile byte total exceeds payload');
      bytes += t.length;
      for (const p of tiles) if (t.x < p.x + p.w && p.x < t.x + t.w && t.y < p.y + p.h && p.y < t.y + t.h)
        return fail('invalid-frame', 'Overlapping tile rectangles');
      tiles.push({ x: t.x, y: t.y, w: t.w, h: t.h, offset: t.offset, length: t.length });
    }
    const byOffset = [...tiles].sort((a, b) => a.offset - b.offset);
    let end = 0;
    for (const t of byOffset) { if (t.offset !== end) return fail('invalid-frame', 'Tile ranges overlap or leave unused bytes'); end += t.length; }
    if (end !== payload.byteLength) return fail('invalid-frame', 'Unexpected trailing payload');
    if (header.baseFrameSeq === null && bytes !== header.width * header.height * 4) return fail('invalid-frame', 'Keyframe must cover the entire canvas');
    const h: ImageFrameHeader = { ...own, frameSeq: header.frameSeq, baseFrameSeq: header.baseFrameSeq,
      imageVersionRef: header.imageVersionRef, ...(header.previewId === undefined ? {} : { previewId: header.previewId }),
      ...(pipeline === undefined ? {} : { pipelineId: pipeline as string, pendingOperationIds: pendingIds!, ...(head === undefined ? {} : { workingHeadOperationId: head as string }) }),
      inputThrough: header.inputThrough, width: header.width, height: header.height, encoding: 'srgb-rgba8-straight', tiles };
    return { ok: true, value: { header: h, pixels: new Uint8Array(payload) } };
  } catch { return fail('invalid-frame', 'Frame could not be snapshotted'); }
}

export type FrameSnapshot = { identity: FrameIdentity; needsKeyframe: boolean; frame: { header: InstalledFrameHeader; pixels: Uint8Array } | null };
export type FrameRegion = { x: number; y: number; w: number; h: number };
/** A stable immutable generation, with copies made only for regions explicitly read.
 * Keeping an old view retains its old tiles, just as keeping a captured snapshot retains bytes.
 */
export type FrameView = { identity: FrameIdentity; needsKeyframe: boolean; header: InstalledFrameHeader | null;
  damage: readonly FrameRegion[];
  readRegion(region?: FrameRegion): Uint8Array | null };
const TILE_SIDE = 256;
type Backing = { width: number; height: number; columns: number; tiles: Map<number, Uint8Array> };
function readRegion(backing: Backing, region?: FrameRegion): Uint8Array {
  const r = region ?? { x: 0, y: 0, w: backing.width, h: backing.height };
  if (!integer(r.x) || !integer(r.y) || !integer(r.w, 1) || !integer(r.h, 1) || r.w > backing.width || r.h > backing.height ||
      r.x > backing.width - r.w || r.y > backing.height - r.h) throw RangeError('Invalid frame read region');
  const pixels = new Uint8Array(r.w * r.h * 4);
  for (let row = 0; row < r.h; row++) {
    const y = r.y + row, cy = Math.floor(y / TILE_SIDE);
    for (let col = 0; col < r.w;) {
      const x = r.x + col, cx = Math.floor(x / TILE_SIDE), chunkWidth = Math.min(TILE_SIDE, backing.width - cx * TILE_SIDE);
      const count = Math.min(r.w - col, chunkWidth - x % TILE_SIDE);
      const chunk = backing.tiles.get(cy * backing.columns + cx)!;
      const start = ((y % TILE_SIDE) * chunkWidth + x % TILE_SIDE) * 4;
      pixels.set(chunk.subarray(start, start + count * 4), (row * r.w + col) * 4); col += count;
    }
  }
  return pixels;
}
function applyFrame(header: ImageFrameHeader, pixels: Uint8Array, previous: Backing | null): Backing {
  const next: Backing = { width: header.width, height: header.height, columns: Math.ceil(header.width / TILE_SIDE),
    tiles: new Map(previous?.tiles) };
  const writable = new Set<number>();
  for (const tile of header.tiles) for (let row = 0; row < tile.h; row++) {
    const y = tile.y + row, cy = Math.floor(y / TILE_SIDE);
    for (let col = 0; col < tile.w;) {
      const x = tile.x + col, cx = Math.floor(x / TILE_SIDE), chunkWidth = Math.min(TILE_SIDE, header.width - cx * TILE_SIDE);
      const count = Math.min(tile.w - col, chunkWidth - x % TILE_SIDE), id = cy * next.columns + cx;
      if (!writable.has(id)) {
        const old = next.tiles.get(id);
        next.tiles.set(id, old ? new Uint8Array(old) : new Uint8Array(chunkWidth * Math.min(TILE_SIDE, header.height - cy * TILE_SIDE) * 4));
        writable.add(id);
      }
      const start = tile.offset + (row * tile.w + col) * 4;
      next.tiles.get(id)!.set(pixels.subarray(start, start + count * 4), ((y % TILE_SIDE) * chunkWidth + x % TILE_SIDE) * 4);
      col += count;
    }
  }
  return next;
}

/** One session-scoped pixel owner. Installation copies only touched internal tiles.
 * Notifications carry stable region views, never automatic full-canvas byte copies.
 * snapshot() explicitly captures a complete private raster; surfaces should read dirty
 * regions from view() instead. Mutating entry points refuse observer reentrancy.
 */
export function createImageFrameStore(initialIdentity: FrameIdentity, limits: FrameLimits = defaultFrameLimits) {
  let owner = identity(initialIdentity);
  if (!owner) throw Error('Invalid frame store identity');
  const cap = limitsOf(limits);
  let disposed = false, publishing = false, needsKeyframe = true, lastSeq = 0, lastInputThrough = 0, hasVersion = false;
  let pipelineId: string | undefined;
  let frame: { header: ImageFrameHeader; backing: Backing } | null = null;
  const listeners = new Set<(view: FrameView) => void>();
  const view = (): FrameView => {
    const held = disposed || needsKeyframe ? null : frame;
    return { identity: { ...owner! }, needsKeyframe, header: held ? installedHeader(held.header) : null,
      damage: held ? held.header.tiles.map(({ x, y, w, h }) => ({ x, y, w, h })) : [],
      readRegion: region => held ? readRegion(held.backing, region) : null };
  };
  const snapshot = (): FrameSnapshot => {
    const current = view();
    return { identity: current.identity, needsKeyframe: current.needsKeyframe,
      frame: current.header ? { header: current.header, pixels: current.readRegion()! } : null };
  };
  const emit = (includeDisposed = false) => {
    publishing = true;
    try { for (const listener of [...listeners]) { if (disposed && !includeDisposed) break; if (listeners.has(listener)) try { listener(view()); } catch { /* Consumers cannot roll back pixels. */ } } }
    finally { publishing = false; }
  };
  const blocked = () => disposed ? fail('disposed', 'Frame store is disposed') : publishing ? fail('busy', 'Frame publication in progress') : null;
  return {
    snapshot,
    view,
    subscribe(listener: (view: FrameView) => void) {
      if (disposed) return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    reset(next: FrameIdentity): FrameResult<true> {
      const error = blocked(); if (error) return error;
      const checked = identity(next); if (!checked) return fail('invalid-frame', 'Invalid reset identity');
      if (checked.sessionId === owner!.sessionId && checked.incarnation === owner!.incarnation &&
          (checked.workerEpoch < owner!.workerEpoch || (checked.workerEpoch === owner!.workerEpoch && checked.epoch < owner!.epoch)))
        return fail('stale-frame', 'Reset cannot move an incarnation backwards');
      if (!sameIdentity(checked, owner!)) { lastSeq = 0; lastInputThrough = 0; hasVersion = false; pipelineId = undefined; }
      owner = checked; frame = null; needsKeyframe = true; emit(); return { ok: true, value: true };
    },
    accept(header: unknown, payload: unknown): FrameResult<number> {
      const error = blocked(); if (error) return error;
      const result = validateImageFrame(header, payload, cap); if (!result.ok) return result;
      const { header: h, pixels } = result.value;
      if (!sameIdentity(h, owner!)) return fail('wrong-identity', 'Reset is required before a different identity can be installed');
      if (lastSeq > 0 && h.pipelineId !== pipelineId) return fail('wrong-identity', 'Pipeline changes require a new epoch');
      if (h.frameSeq <= lastSeq) return fail('stale-frame', 'Frame is older than the installed sequence');
      if (h.baseFrameSeq !== null && (needsKeyframe || !frame || h.baseFrameSeq !== lastSeq || h.frameSeq !== lastSeq + 1)) {
        needsKeyframe = true; emit(); return fail('needs-keyframe', 'Delta does not extend the installed complete frame');
      }
      if (h.baseFrameSeq !== null && frame && (h.width !== frame.header.width || h.height !== frame.header.height))
        return fail('invalid-frame', 'Delta cannot resize the canvas');
      if (h.inputThrough < lastInputThrough) return fail('stale-frame', 'Frame input prefix moved backwards');
      if (hasVersion && h.imageVersionRef === null)
        return fail('invalid-frame', 'An installed document version cannot become unversioned');
      try {
        const backing = applyFrame(h, pixels, h.baseFrameSeq === null ? null : frame!.backing);
        frame = { header: h, backing }; lastSeq = h.frameSeq; lastInputThrough = h.inputThrough; pipelineId = h.pipelineId;
        hasVersion ||= h.imageVersionRef !== null; needsKeyframe = false;
      } catch { return fail('resource-limit', 'Could not allocate frame tiles'); }
      emit(); return { ok: true, value: h.frameSeq };
    },
    dispose() {
      if (disposed) return;
      disposed = true; frame = null; needsKeyframe = true;
      try { emit(true); } finally { listeners.clear(); }
    },
  };
}
