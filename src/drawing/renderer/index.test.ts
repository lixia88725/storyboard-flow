import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FlowPixelInput, FlowPixelLimits, FlowResult } from '../../platform/contracts/flowWave2';
import { createFlowPixels } from '.';

let png: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  png = new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 4, background: '#0000ff80' } }).png().toBuffer());
});
afterEach(() => vi.unstubAllGlobals());
const limits = (): FlowPixelLimits => ({ maxPixels: 96, maxPngBytes: 4096, maxPoints: 4 });
const input = (): FlowPixelInput => ({
  image: { id: 'image', revision: 4, width: 12, height: 8, layers: [
    { id: 'layer', name: '绘画', kind: 'paint', visible: true, locked: false,
      width: 12, height: 8, assetId: 'a'.repeat(64), opacity: 1, blendMode: 'normal' }
  ] }, layerId: 'layer',
  stroke: { tool: 'brush', color: '#fA0', size: 3, opacity: 0.5, softness: 0.25, points: [3, 4] }
});
const errorCode = (result: FlowResult<unknown>, code: string) => {
  expect(result).toMatchObject({ ok: false, error: { code, effect: 'none' } });
};

/** These doubles verify admission and lifetime only. Real raster assertions live in canvas-harness.mjs. */
function canvasEnvironment(options: {
  context?: boolean; decodedWidth?: number; decodedHeight?: number; encoded?: Blob | null;
  encodeThrow?: boolean; decodeThrow?: boolean;
} = {}) {
  const context = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    globalCompositeOperation: '', globalAlpha: 0, lineWidth: 0, shadowBlur: 0 };
  const bitmap = { width: options.decodedWidth ?? 12, height: options.decodedHeight ?? 8, close: vi.fn() };
  const decode = vi.fn(async (_blob: Blob) => {
    if (options.decodeThrow) throw new Error('Synthetic PNG decoder failure');
    return bitmap;
  });
  const canvas = { width: 0, height: 0,
    getContext: vi.fn(() => options.context === false ? null : context),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
      if (options.encodeThrow) throw new Error('Synthetic encoder failure');
      callback(options.encoded === undefined ? new Blob([png], { type: 'image/png' }) : options.encoded);
    }) };
  const create = vi.fn(() => canvas);
  vi.stubGlobal('document', { createElement: create });
  vi.stubGlobal('createImageBitmap', decode);
  return { canvas, bitmap, context, decode, create };
}

describe('createFlowPixels admission', () => {
  it('returns unavailable without a document, before reading an asset', async () => {
    vi.stubGlobal('document', undefined);
    const reader = vi.fn();
    errorCode(await createFlowPixels(limits()).produce(input(), reader), 'unavailable');
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(['maxPixels', 'maxPngBytes', 'maxPoints'] as const)('rejects invalid %s limits', async key => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const reader = vi.fn();
      errorCode(await createFlowPixels({ ...limits(), [key]: value }).produce(input(), reader), 'invalid-input');
      expect(reader).not.toHaveBeenCalled();
    }
  });

  it('copies limits at construction', async () => {
    canvasEnvironment();
    const config = limits(); const pixels = createFlowPixels(config);
    config.maxPixels = 1; config.maxPoints = 0; config.maxPngBytes = 0;
    expect((await pixels.produce(input(), async () => png)).ok).toBe(true);
  });

  it.each([
    ['bad tool', (i: FlowPixelInput) => { (i.stroke as { tool: string }).tool = 'fill'; }],
    ['bad color', (i: FlowPixelInput) => { i.stroke.color = 'red'; }],
    ['bad hex', (i: FlowPixelInput) => { i.stroke.color = '#abcde'; }],
    ['zero size', (i: FlowPixelInput) => { i.stroke.size = 0; }],
    ['infinite size', (i: FlowPixelInput) => { i.stroke.size = Infinity; }],
    ['negative opacity', (i: FlowPixelInput) => { i.stroke.opacity = -0.1; }],
    ['opacity overflow', (i: FlowPixelInput) => { i.stroke.opacity = 1.1; }],
    ['softness overflow', (i: FlowPixelInput) => { i.stroke.softness = 1.1; }],
    ['NaN softness', (i: FlowPixelInput) => { i.stroke.softness = NaN; }],
    ['odd points', (i: FlowPixelInput) => { i.stroke.points = [1, 2, 3]; }],
    ['no points', (i: FlowPixelInput) => { i.stroke.points = []; }],
    ['nonfinite point', (i: FlowPixelInput) => { i.stroke.points = [NaN, 1]; }],
    ['sparse pair', (i: FlowPixelInput) => { i.stroke.points = new Array<number>(2); }],
    ['string point', (i: FlowPixelInput) => { i.stroke.points = ['1' as unknown as number, 1]; }]
  ])('rejects %s before reading/decoding', async (_name, change) => {
    const i = input(); change(i); const env = canvasEnvironment(); const reader = vi.fn();
    errorCode(await createFlowPixels(limits()).produce(i, reader), 'invalid-input');
    expect(reader).not.toHaveBeenCalled(); expect(env.decode).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate layers', (i: FlowPixelInput) => i.image.layers.push({ ...i.image.layers[0] })],
    ['layer size mismatch', (i: FlowPixelInput) => { i.image.layers[0].width = 10; }],
    ['bad asset', (i: FlowPixelInput) => { i.image.layers[0].assetId = '../source'; }],
    ['unsupported image data', (i: FlowPixelInput) => { Object.assign(i.image, { metadata: 'do not discard' }); }],
    ['hidden target', (i: FlowPixelInput) => { i.image.layers[0].visible = false; }]
  ])('rejects %s with no effects', async (_name, change) => {
    const i = input(); change(i); const reader = vi.fn();
    errorCode(await createFlowPixels(limits()).produce(i, reader), 'invalid-input');
    expect(reader).not.toHaveBeenCalled();
  });

  it('refuses locked and missing targets', async () => {
    const i = input(); i.image.layers[0].locked = true;
    errorCode(await createFlowPixels(limits()).produce(i, vi.fn()), 'locked');
    i.layerId = 'missing';
    errorCode(await createFlowPixels(limits()).produce(i, vi.fn()), 'not-found');
  });

  it('checks pixels and coordinate-pair limits before decoding, accepting exact boundaries', async () => {
    const env = canvasEnvironment(); const reader = vi.fn(async () => png);
    errorCode(await createFlowPixels({ ...limits(), maxPixels: 95 }).produce(input(), reader), 'resource-limit');
    const i = input(); i.stroke.points = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    errorCode(await createFlowPixels(limits()).produce(i, reader), 'resource-limit');
    expect(reader).not.toHaveBeenCalled(); expect(env.decode).not.toHaveBeenCalled();
    i.stroke.points = [-10, -10, 1, 1, 2, 2, 100, 100];
    expect((await createFlowPixels(limits()).produce(i, reader)).ok).toBe(true);
  });

  it.each([null, {}, { image: null }, { ...input(), stroke: null }])('keeps malformed runtime input typed', async value => {
    errorCode(await createFlowPixels(limits()).produce(value as unknown as FlowPixelInput, vi.fn()), 'invalid-input');
  });
});

describe('source, snapshot and resource ownership', () => {
  it('snapshots image and stroke before the first await without mutating the caller', async () => {
    const env = canvasEnvironment(); const i = input();
    let resolve!: (bytes: Uint8Array) => void;
    const reader = vi.fn(() => new Promise<Uint8Array>(r => { resolve = r; }));
    const run = createFlowPixels(limits()).produce(i, reader);
    i.image.width = 100; i.image.layers[0].assetId = 'b'.repeat(64);
    i.stroke.size = 10; i.stroke.opacity = 0.9; (i.stroke.points as number[])[0] = 99;
    resolve(png);
    const result = await run;
    expect(result).toMatchObject({ ok: true, value: { width: 12, height: 8 } });
    expect(reader).toHaveBeenCalledExactlyOnceWith('a'.repeat(64));
    expect(env.context.lineWidth).toBe(3); expect(env.context.globalAlpha).toBe(0.5);
    expect(env.context.arc).toHaveBeenCalledWith(3, 4, 1.5, 0, Math.PI * 2);
    expect(i.stroke.size).toBe(10); expect(i.image.width).toBe(100);
    expect(env.bitmap.close).toHaveBeenCalledTimes(1);
    expect([env.canvas.width, env.canvas.height]).toEqual([0, 0]);
  });

  it('opacity zero returns private, validated source bytes; each result is independent', async () => {
    const env = canvasEnvironment(); const i = input(); i.stroke.opacity = 0;
    const shared = new Uint8Array(png);
    const pixels = createFlowPixels(limits());
    const first = await pixels.produce(i, async () => shared);
    expect(first.ok).toBe(true);
    if (!first.ok) throw Error('Expected private bytes');
    expect(first.value.png).toEqual(png); expect(first.value.png).not.toBe(shared);
    first.value.png.fill(0);
    const second = await pixels.produce(i, async () => shared);
    expect(second).toMatchObject({ ok: true, value: { png } });
    expect(shared).toEqual(png);
    expect(env.decode).toHaveBeenCalledTimes(2); expect(env.create).not.toHaveBeenCalled();
    expect(env.bitmap.close).toHaveBeenCalledTimes(2);
  });

  it('copies reader-owned bytes before asynchronous decode can observe later mutations', async () => {
    const env = canvasEnvironment(); const i = input(); i.stroke.opacity = 0;
    const shared = new Uint8Array(png);
    let started!: () => void, finish!: () => void;
    const decoding = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      started(); await pending;
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
      return env.bitmap;
    });
    const run = createFlowPixels(limits()).produce(i, async () => shared);
    await decoding; shared.fill(0); finish();
    expect(await run).toMatchObject({ ok: true, value: { png } });
    expect(env.bitmap.close).toHaveBeenCalledOnce();
  });

  it('reader rejection is missing-asset, never a blank source', async () => {
    const env = canvasEnvironment();
    errorCode(await createFlowPixels(limits()).produce(input(), async () => { throw Error('Unreadable synthetic source'); }), 'missing-asset');
    expect(env.decode).not.toHaveBeenCalled(); expect(env.create).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array(), new Uint8Array([1, 2, 3]), 'data:image/png;base64,not-bytes'])('refuses invalid source bytes', async bytes => {
    const env = canvasEnvironment();
    errorCode(await createFlowPixels(limits()).produce(input(), async () => bytes as Uint8Array), 'invalid-input');
    expect(env.decode).not.toHaveBeenCalled();
  });

  it('refuses encoded-size excess and wrong IHDR dimensions before decode/allocation', async () => {
    const env = canvasEnvironment();
    errorCode(await createFlowPixels({ ...limits(), maxPngBytes: png.byteLength - 1 }).produce(input(), async () => png), 'resource-limit');
    const wrong = new Uint8Array(png); new DataView(wrong.buffer).setUint32(16, 100000);
    errorCode(await createFlowPixels(limits()).produce(input(), async () => wrong), 'invalid-input');
    expect(env.decode).not.toHaveBeenCalled(); expect(env.create).not.toHaveBeenCalled();
  });

  it('reports a decoder rejection', async () => {
    const env = canvasEnvironment({ decodeThrow: true });
    errorCode(await createFlowPixels(limits()).produce(input(), async () => png), 'invalid-input');
    expect(env.create).not.toHaveBeenCalled();
  });

  it('refuses a decoded dimension mismatch and closes its bitmap', async () => {
    const env = canvasEnvironment({ decodedWidth: 11 });
    errorCode(await createFlowPixels(limits()).produce(input(), async () => png), 'invalid-input');
    expect(env.bitmap.close).toHaveBeenCalledOnce(); expect(env.create).not.toHaveBeenCalled();
  });

  it.each([
    ['context unavailable', { context: false }, 'unavailable'],
    ['encoder null', { encoded: null }, 'io-failure'],
    ['encoder throws', { encodeThrow: true }, 'io-failure'],
    ['encoder wrong format', { encoded: new Blob(['not-png'], { type: 'image/jpeg' }) }, 'io-failure'],
    ['oversized output', { encoded: new Blob([new Uint8Array(4097)], { type: 'image/png' }) }, 'resource-limit']
  ] as const)('keeps %s a failure and releases resources', async (_name, options, code) => {
    const env = canvasEnvironment(options);
    errorCode(await createFlowPixels(limits()).produce(input(), async () => png), code);
    expect(env.bitmap.close).toHaveBeenCalledOnce();
    expect([env.canvas.width, env.canvas.height]).toEqual([0, 0]);
  });

  it('outputs an independent PNG buffer on the nonzero-opacity path', async () => {
    const env = canvasEnvironment(); const source = new Uint8Array(png); const i = input();
    const before = structuredClone(i);
    const result = await createFlowPixels(limits()).produce(i, async () => source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error('Expected PNG');
    expect(result.value.png).toEqual(png); result.value.png[0] = 0;
    expect(source).toEqual(png); expect(i).toEqual(before);
    expect(env.context.globalCompositeOperation).toBe('source-over');
  });
});

it('distinguishes transparent layer allocation from white new-shot allocation',async()=>{
 const env=canvasEnvironment();const fillRect=vi.fn();Object.assign(env.context,{fillRect});
 const pixels=createFlowPixels(limits());
 expect((await pixels.blank!(12,8,'transparent')).ok).toBe(true);expect(fillRect).not.toHaveBeenCalled();
 expect((await pixels.blank!(12,8)).ok).toBe(true);expect(fillRect).toHaveBeenCalledWith(0,0,12,8);
 expect(env.canvas.width).toBe(0);expect(env.canvas.height).toBe(0);
});
