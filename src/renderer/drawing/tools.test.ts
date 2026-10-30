import { describe, it, expect, vi } from 'vitest';
import { createPixelTools, type PixelToolRequest } from './tools';
const layer = (id: string) => ({ id, name: id, kind: 'paint' as const, visible: true, locked: false, opacity: 1, blendMode: 'normal' as const, width: 2, height: 2, assetId: 'a'.repeat(64) });
const image = () => ({ id: 'image', revision: 5, width: 2, height: 2, layers: [layer('a'), layer('b'), layer('c')] });
const tools = () => createPixelTools({ maxPixels: 4, maxPngBytes: 1000, maxLayers: 3 });
const fill = (): Extract<PixelToolRequest, { kind: 'fill' }> => ({ kind: 'fill', image: image(), layerId: 'a', x: 0, y: 0, color: [1, 2, 3, 4], tolerance: 0 });
describe('pixel tool admission', () => {
  it('refuses hidden, locked, and missing targets before reading', async () => {
    const read = vi.fn(); const req = fill();
    req.image.layers[0].visible = false;
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    req.image.layers[0].visible = true; req.image.layers[0].locked = true;
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'locked' } });
    req.layerId = 'missing'; expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects sparse RGBA arrays before reading or allocating Canvas', async () => {
    const create = vi.fn(); const read = vi.fn();
    vi.stubGlobal('document', { createElement: create });
    vi.stubGlobal('createImageBitmap', vi.fn());
    try {
      for (const missing of [-1, 0, 1, 2, 3]) {
        const req = fill();
        const color = missing === -1 ? new Array<number>(4) : [1, 2, 3, 4];
        if (missing >= 0) delete color[missing];
        req.color = color as unknown as typeof req.color;
        expect(await tools().produce(req, read), `missing channel ${missing}`).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
        expect(read).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects every invalid channel and sparse merge IDs before effects', async () => {
    const create = vi.fn(); const read = vi.fn();
    vi.stubGlobal('document', { createElement: create }); vi.stubGlobal('createImageBitmap', vi.fn());
    try {
      for (const invalid of [-1, 256, 1.5, NaN, Infinity, undefined, '1']) {
        for (let index = 0; index < 4; index++) {
          const req = fill(); const color: unknown[] = [0, 1, 2, 255]; color[index] = invalid;
          req.color = color as unknown as typeof req.color;
          expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
        }
      }
      const inherited = [0, 1, 2, 255]; delete inherited[0];
      const prototype = Object.create(Array.prototype); prototype[0] = 5; Object.setPrototypeOf(inherited, prototype);
      const inheritedRequest = fill(); inheritedRequest.color = inherited as unknown as typeof inheritedRequest.color;
      expect(await tools().produce(inheritedRequest, read)).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
      const ids = ['a', 'b']; delete ids[1];
      const merge: PixelToolRequest = { kind: 'merge', image: image(), layerIds: ids };
      expect((await tools().produce(merge, read)).ok).toBe(false);
      expect(read).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects bad fill and allocation before reader', async () => {
    const read = vi.fn(); const req = fill(); req.tolerance = 256;
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    req.tolerance = 0; expect(await createPixelTools({ maxPixels: 3, maxPngBytes: 100, maxLayers: 3 }).produce(req, read)).toMatchObject({ ok: false, error: { code: 'resource-limit' } });
    expect(read).not.toHaveBeenCalled();
  });
  it('refuses noncontiguous, locked, hidden, and backdrop dependent merges', async () => {
    const req: PixelToolRequest = { kind: 'merge', image: image(), layerIds: ['a', 'c'] }; const read = vi.fn();
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    req.layerIds = ['b', 'c']; req.image.layers[1].locked = true;
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'locked' } });
    req.image.layers[1].locked = false; req.image.layers[1].visible = false;
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    req.image.layers[1].visible = true; (req.image.layers[2] as { blendMode: string }).blendMode = 'multiply';
    expect(await tools().produce(req, read)).toMatchObject({ ok: false, error: { code: 'invalid-input' } }); expect(read).not.toHaveBeenCalled();
  });
});

describe('pixel tool resource ownership', () => {
  it('captures fill request before awaiting and releases resources on success and encoder failure', async () => {
    const { default: sharp } = await import('sharp');
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0000ff' } }).png().toBuffer());
    const close = vi.fn(); const bitmap = { width: 2, height: 2, close };
    const data = new Uint8ClampedArray(16); const put = vi.fn();
    const context = { drawImage: vi.fn(), clearRect: vi.fn(), getImageData: () => ({ data, width: 2, height: 2 }), putImageData: put, globalAlpha: 1, globalCompositeOperation: '' };
    let encodeFails = false;
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (cb: (v: Blob | null) => void) => cb(encodeFails ? null : new Blob([Uint8Array.from(png).buffer], { type: 'image/png' })) };
    vi.stubGlobal('document', { createElement: () => canvas }); vi.stubGlobal('createImageBitmap', async () => bitmap);
    try {
      const req = fill(); let finish!: (v: Uint8Array) => void;
      const pending = tools().produce(req, () => new Promise(resolve => { finish = resolve; }));
      req.color = [8, 9, 10, 11]; req.image.revision = 99; req.image.layers[0].assetId = 'b'.repeat(64); req.x = 1;
      finish(png); const result = await pending;
      expect(result.ok).toBe(true); if (!result.ok) throw Error('expected output');
      expect(result.value.baseline.revision).toBe(5); expect(result.value.baseline.layers[0].assetId).toBe('a'.repeat(64));
      expect([...data.slice(0, 4)]).toEqual([1, 2, 3, 4]); expect(put).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledTimes(1); expect([canvas.width, canvas.height]).toEqual([0, 0]);
      encodeFails = true;
      expect(await tools().produce({ kind: 'clear', image: image(), layerId: 'a' }, async () => png)).toMatchObject({ ok: false, error: { code: 'io-failure' } });
      expect(close).toHaveBeenCalledTimes(2); expect([canvas.width, canvas.height]).toEqual([0, 0]);
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects source size, header dimensions and decoded dimensions and releases allocated resources', async () => {
    const { default: sharp } = await import('sharp');
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#000' } }).png().toBuffer());
    const close = vi.fn(); const bitmap = { width: 1, height: 2, close };
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }) };
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal('document', { createElement: () => canvas }); vi.stubGlobal('createImageBitmap', decode);
    try {
      const req: PixelToolRequest = { kind: 'clear', image: image(), layerId: 'a' };
      expect(await createPixelTools({ maxPixels: 4, maxPngBytes: png.length - 1, maxLayers: 3 }).produce(req, async () => png)).toMatchObject({ ok: false, error: { code: 'resource-limit' } });
      const wrong = new Uint8Array(png); new DataView(wrong.buffer).setUint32(16, 3);
      expect(await tools().produce(req, async () => wrong)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
      expect(decode).not.toHaveBeenCalled();
      expect(await tools().produce(req, async () => png)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
      expect(close).toHaveBeenCalledOnce(); expect([canvas.width, canvas.height]).toEqual([0, 0]);
    } finally { vi.unstubAllGlobals(); }
  });
});
