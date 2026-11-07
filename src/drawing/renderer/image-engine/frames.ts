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
  return meta;
};

/** Validates a complete transport frame, then takes a private copy of its exact byte view.
 * Sparse lists, overlapping rectangles/ranges, unused payload and partial keyframes are refused.
 * Chunk assembly belongs to transport: never call this Interface before the whole frame arrives.
 */
export function validateImageFrame(header: unknown, payload: unknown, limits: FrameLimits = defaultFrameLimits): FrameResult<{ header: ImageFrameHeader; pixels: Uint8Array }> {
  try {
    header = dataFields(header, [...identityKeys, 'frameSeq', 'baseFrameSeq', 'imageVersionRef', 'previewId', 'inputThrough', 'width', 'height', 'encoding', 'tiles']);
    const cap = limitsOf(limits), own = identity(header);
    if (!own || !record(header) || !integer(header.frameSeq, 1) ||
        !(header.baseFrameSeq === null || (integer(header.baseFrameSeq, 1) && header.baseFrameSeq < header.frameSeq)) ||
        !(header.imageVersionRef === null || text(header.imageVersionRef)) ||
        !(header.previewId === undefined || text(header.previewId)) || (header.imageVersionRef === null && !text(header.previewId)) ||
        !integer(header.inputThrough) || !integer(header.width, 1) || !integer(header.height, 1) || header.encoding !== 'srgb-rgba8-straight')
      return fail('invalid-frame', 'Invalid frame identity, sequence, version or dimensions');
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
      inputThrough: header.inputThrough, width: header.width, height: header.height, encoding: 'srgb-rgba8-straight', tiles };
    return { ok: true, value: { header: h, pixels: new Uint8Array(payload) } };
  } catch { return fail('invalid-frame', 'Frame could not be snapshotted'); }
}

export type FrameSnapshot = { identity: FrameIdentity; needsKeyframe: boolean; frame: { header: InstalledFrameHeader; pixels: Uint8Array } | null };
/** One session-scoped pixel owner. Surfaces subscribe and borrow snapshots; unmounting a
 * surface never resets this owner. Snapshot byte arrays are private to each caller.
 * Mutating entry points refuse observer reentrancy. Subscribers cannot fail an install.
 */
export function createImageFrameStore(initialIdentity: FrameIdentity, limits: FrameLimits = defaultFrameLimits) {
  let owner = identity(initialIdentity);
  if (!owner) throw Error('Invalid frame store identity');
  const cap = limitsOf(limits);
  let disposed = false, publishing = false, needsKeyframe = true, lastSeq = 0, lastInputThrough = 0, hasVersion = false;
  let frame: { header: ImageFrameHeader; pixels: Uint8Array } | null = null;
  const listeners = new Set<(snapshot: FrameSnapshot) => void>();
  const snapshot = (): FrameSnapshot => ({ identity: { ...owner! }, needsKeyframe,
    frame: disposed || needsKeyframe || !frame ? null : { header: installedHeader(frame.header), pixels: frame.pixels.slice() } });
  const emit = () => {
    publishing = true;
    try { for (const listener of [...listeners]) { if (disposed) break; if (listeners.has(listener)) try { listener(snapshot()); } catch { /* Consumer failure cannot roll back pixels. */ } } }
    finally { publishing = false; }
  };
  const blocked = () => disposed ? fail('disposed', 'Frame store is disposed') : publishing ? fail('busy', 'Frame publication in progress') : null;
  return {
    snapshot,
    subscribe(listener: (snapshot: FrameSnapshot) => void) {
      if (disposed) return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    reset(next: FrameIdentity): FrameResult<true> {
      const error = blocked(); if (error) return error;
      const checked = identity(next); if (!checked) return fail('invalid-frame', 'Invalid reset identity');
      if (checked.sessionId === owner!.sessionId && checked.incarnation === owner!.incarnation &&
          (checked.workerEpoch < owner!.workerEpoch || (checked.workerEpoch === owner!.workerEpoch && checked.epoch < owner!.epoch)))
        return fail('stale-frame', 'Reset cannot move an incarnation backwards');
      if (!sameIdentity(checked, owner!)) { lastSeq = 0; lastInputThrough = 0; hasVersion = false; }
      owner = checked; frame = null; needsKeyframe = true; emit(); return { ok: true, value: true };
    },
    accept(header: unknown, payload: unknown): FrameResult<number> {
      const error = blocked(); if (error) return error;
      const result = validateImageFrame(header, payload, cap); if (!result.ok) return result;
      const { header: h, pixels } = result.value;
      if (!sameIdentity(h, owner!)) return fail('wrong-identity', 'Reset is required before a different identity can be installed');
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
        const next = h.baseFrameSeq === null ? new Uint8Array(h.width * h.height * 4) : frame!.pixels.slice();
        for (const t of h.tiles) for (let row = 0; row < t.h; row++) {
          const start = t.offset + row * t.w * 4;
          next.set(pixels.subarray(start, start + t.w * 4), ((t.y + row) * h.width + t.x) * 4);
        }
        frame = { header: h, pixels: next }; lastSeq = h.frameSeq; lastInputThrough = h.inputThrough;
        hasVersion ||= h.imageVersionRef !== null; needsKeyframe = false;
      } catch { return fail('resource-limit', 'Could not allocate a complete frame'); }
      emit(); return { ok: true, value: h.frameSeq };
    },
    dispose() { disposed = true; frame = null; needsKeyframe = true; listeners.clear(); },
  };
}
