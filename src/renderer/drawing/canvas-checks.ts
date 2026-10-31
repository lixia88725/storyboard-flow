/** Browser-only synthetic checks, invoked by canvas-harness.mjs in a hidden Electron window.
 * This exercises real Canvas2D/decode/PNG output, not UI gestures or production wiring.
 */
import type { FlowPixelInput, FlowPixelOutput, FlowResult, FlowStroke } from '../../../electron/shared/flowWave2';
import { drawStrokePathOnCanvas } from '../sketchRendering';
import { createFlowPixels, createPixelTools, type PixelToolRequest } from './index';
import type { AssetReaderV1 } from '../../../electron/shared/refactorV1';

const width = 32, height = 24;
const assert = (condition: unknown, label: string): void => {
  if (!condition) throw Error(`Canvas assertion failed: ${label}`);
};
const value = <T>(result: FlowResult<T>): T => {
  if (!result.ok) throw Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const bytesOf = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(Error('Reference PNG encode failed')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
};
const canvasOf = () => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Real Canvas2D unavailable');
  return { canvas, context };
};
const inputOf = (stroke: FlowStroke): FlowPixelInput => ({
  image: { id: 'image', revision: 0, width, height, layers: [
    { id: 'layer', name: 'Synthetic', kind: 'paint', visible: true, locked: false,
      opacity: 1, blendMode: 'normal', width, height, assetId: 'a'.repeat(64) }
  ] }, layerId: 'layer', stroke
});
const baseStroke = (patch: Partial<FlowStroke> = {}): FlowStroke => ({
  tool: 'brush', color: '#ff0000', size: 8, opacity: 1, softness: 0, points: [16, 12], ...patch
});
const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

async function withHtmlImage<T>(png: Uint8Array, run: (image: HTMLImageElement) => T): Promise<T> {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(png).buffer], { type: 'image/png' }));
  const image = new Image();
  try { image.src = url; await image.decode(); return run(image); }
  finally { image.src = ''; URL.revokeObjectURL(url); }
}
async function rgbaOf(png: Uint8Array): Promise<Uint8Array> {
  const { canvas, context } = canvasOf();
  try {
    return await withHtmlImage(png, image => {
      assert(image.naturalWidth === width && image.naturalHeight === height, 'output natural dimensions');
      context.drawImage(image, 0, 0);
      return new Uint8Array(context.getImageData(0, 0, width, height).data);
    });
  } finally { canvas.width = canvas.height = 0; }
}
async function reference(source: Uint8Array, stroke: FlowStroke): Promise<Uint8Array> {
  const { canvas, context } = canvasOf();
  try {
    await withHtmlImage(source, image => context.drawImage(image, 0, 0));
    drawStrokePathOnCanvas(context, { ...stroke, id: 'reference', points: [...stroke.points] });
    return await bytesOf(canvas);
  } finally { canvas.width = canvas.height = 0; }
}
const pixel = (rgba: Uint8Array, x: number, y: number) => [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function runPixelCanvasChecks() {
  const pixels = createFlowPixels({ maxPixels: width * height, maxPngBytes: 1024 * 1024, maxPoints: 100 });
  const blank = canvasOf();
  const transparent = await bytesOf(blank.canvas);
  blank.context.fillStyle = '#0000ff'; blank.context.fillRect(0, 0, width, height);
  const blue = await bytesOf(blank.canvas);
  blank.canvas.width = blank.canvas.height = 0;
  const cases: { name: string; png: string; reference: string; samples: Record<string, number[]> }[] = [];
  let admittedBitmaps = 0, closedBitmaps = 0;
  const productionCanvases: HTMLCanvasElement[] = [];
  const originalCreate = document.createElement.bind(document);
  const originalDecode = globalThis.createImageBitmap.bind(globalThis);

  // Count only production calls; every actual native bitmap must close, every canvas must clear.
  async function produce(stroke: FlowStroke, source: Uint8Array): Promise<FlowResult<FlowPixelOutput>> {
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = originalCreate(tag, options);
      if (tag === 'canvas') productionCanvases.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement;
    globalThis.createImageBitmap = (async (blob: ImageBitmapSource, ...args: unknown[]) => {
      assert(args.length === 0, 'producer does not rescale decoding');
      const bitmap = await originalDecode(blob);
      admittedBitmaps++;
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => { closedBitmaps++; close(); };
      return bitmap;
    }) as typeof createImageBitmap;
    try {
      const before = new Uint8Array(source);
      const result = await pixels.produce(inputOf(stroke), async id => {
        assert(id === 'a'.repeat(64), 'source through injected reader'); return source;
      });
      assert(equalBytes(before, source), 'source bytes preserved');
      return result;
    } finally {
      document.createElement = originalCreate;
      globalThis.createImageBitmap = originalDecode;
      assert(admittedBitmaps === closedBitmaps, 'production ImageBitmaps released');
      assert(productionCanvases.every(canvas => canvas.width === 0 && canvas.height === 0), 'production canvases released');
    }
  }

  for (const [name, stroke, source] of [
    ['transparent-dot', baseStroke(), transparent],
    ['continuous-line', baseStroke({ color: '#0f0', size: 4, points: [4, 12, 16, 12, 28, 12] }), transparent],
    ['half-opacity', baseStroke({ color: '#00f', opacity: 0.5 }), transparent],
    ['eraser-alpha', baseStroke({ tool: 'eraser', opacity: 0.5 }), blue],
    ['soft-edge', baseStroke({ size: 6, softness: 0.75, points: [6, 12, 26, 12] }), transparent]
  ] as const) {
    const output = value(await produce(stroke, source));
    const expected = await reference(source, stroke);
    const actualRgba = await rgbaOf(output.png), referenceRgba = await rgbaOf(expected);
    assert(equalBytes(actualRgba, referenceRgba), `${name} exact RGBA parity with existing algorithm`);
    const center = pixel(actualRgba, 16, 12), corner = pixel(actualRgba, 0, 0), edge = pixel(actualRgba, 16, 7);
    if (name === 'transparent-dot') assert(center.join() === '255,0,0,255' && corner[3] === 0, 'opaque dot on transparent');
    if (name === 'continuous-line') assert(center.join() === '0,255,0,255' && pixel(actualRgba, 8, 12)[3] === 255 && corner[3] === 0, 'continuous image-pixel line');
    if (name === 'half-opacity') assert(center[2] === 255 && center[3] >= 127 && center[3] <= 128, 'half alpha paint');
    if (name === 'eraser-alpha') assert(center[2] === 255 && center[3] >= 127 && center[3] <= 128 && corner[3] === 255, 'destination-out eraser alpha');
    if (name === 'soft-edge') assert(edge[3] > 0 && edge[3] < center[3], 'softness produces an alpha falloff');
    cases.push({ name, png: base64(output.png), reference: base64(expected), samples: { center, corner, edge } });
  }
  // Exercise the separate preparation API with real decoded and encoded pixels.
  const operations = createPixelTools({ maxPixels: width * height, maxPngBytes: 1024 * 1024, maxLayers: 4 });
  // Observe native resources belonging to each tool call; decode and Canvas remain real.
  const toolLifetimes: { label: string; canvases: number; admitted: number; closed: number }[] = [];
  async function trackedTool(label: string, request: PixelToolRequest, reader: AssetReaderV1,
    producer = operations, expectedCanvases = 1) {
    const canvases: HTMLCanvasElement[] = [];
    let admitted = 0, closed = 0;
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = originalCreate(tag, options);
      if (tag === 'canvas') canvases.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement;
    globalThis.createImageBitmap = (async (source: ImageBitmapSource, ...args: unknown[]) => {
      assert(args.length === 0, 'tool decode does not rescale');
      const bitmap = await originalDecode(source);
      admitted++;
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => { closed++; close(); };
      return bitmap;
    }) as typeof createImageBitmap;
    try { return await producer.produce(request, reader); }
    finally {
      document.createElement = originalCreate;
      globalThis.createImageBitmap = originalDecode;
      assert(canvases.length === expectedCanvases, `${label}: actual canvas allocated`);
      assert(admitted > 0 && admitted === closed, `${label}: all admitted native bitmaps closed`);
      assert(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), `${label}: canvas backing released`);
      toolLifetimes.push({ label, canvases: canvases.length, admitted, closed });
    }
  }
  const base = inputOf(baseStroke()).image;
  const impulse=canvasOf();impulse.context.fillStyle='#0000ff';impulse.context.fillRect(16,12,1,1);
  const impulsePng=await bytesOf(impulse.canvas);impulse.canvas.width=impulse.canvas.height=0;
  const blurRequest:PixelToolRequest={kind:'blur',image:base,layerId:'layer',radius:2};
  const blurred=value(await trackedTool('blur-success',blurRequest,async()=>{blurRequest.radius=50;return impulsePng;},operations,2));
  const blurPixels=await rgbaOf(blurred.png),blurCenter=pixel(blurPixels,16,12),blurEdge=pixel(blurPixels,18,12);
  assert(blurCenter[3]>3 && blurCenter[3]<60 && blurEdge[3]>0,'Gaussian spread replaces sharp core and uses captured radius');
  assert(blurCenter[2]===255 && blurred.plan.kind==='replace' && blurred.plan.layerId==='layer','blur preserves color and target');
  cases.push({name:'tool-blur',png:base64(blurred.png),reference:base64(blurred.png),samples:{center:blurCenter,edge:blurEdge}});
  const barrier = canvasOf();
  barrier.context.fillStyle = '#0000ff'; barrier.context.fillRect(0, 0, width, height);
  barrier.context.fillStyle = '#000000'; barrier.context.fillRect(16, 0, 1, height);
  const barrierPng = await bytesOf(barrier.canvas); barrier.canvas.width = barrier.canvas.height = 0;
  const filled = value(await trackedTool('fill-success', { kind: 'fill', image: base, layerId: 'layer', x: -4, y: 3, color: [255, 0, 0, 255], tolerance: 0 }, async () => barrierPng));
  const fillRgba = await rgbaOf(filled.png);
  assert(pixel(fillRgba, 0, 3).join() === '255,0,0,255' && pixel(fillRgba, 16, 3).join() === '0,0,0,255' && pixel(fillRgba, 17, 3).join() === '0,0,255,255', 'fill contiguous and clamped');
  const cleared = value(await trackedTool('clear-success', { kind: 'clear', image: base, layerId: 'layer' }, async () => blue));
  assert((await rgbaOf(cleared.png)).every(v => v === 0), 'clear all transparent');
  const mergedImage = { ...base, layers: [{ ...base.layers[0], id: 'bottom' }, { ...base.layers[0], id: 'top', assetId: 'b'.repeat(64), opacity: 0.5, blendMode: 'screen' as const }] };
  const redCanvas = canvasOf(); redCanvas.context.fillStyle = '#ff0000'; redCanvas.context.fillRect(0, 0, width, height);
  const red = await bytesOf(redCanvas.canvas); redCanvas.canvas.width = redCanvas.canvas.height = 0;
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const pending = trackedTool('merge-success', { kind: 'merge', image: mergedImage, layerIds: ['top', 'bottom'] }, async id => { if (id === 'a'.repeat(64)) { await gate; return blue; } return red; });
  mergedImage.layers[1].opacity = 0; mergedImage.revision = 99; release();
  const merged = value(await pending), mergedRgba = await rgbaOf(merged.png);
  const sample = pixel(mergedRgba, 4, 4);
  assert(sample[0] >= 127 && sample[0] <= 128 && sample[2] === 255 && sample[3] === 255, 'screen opacity and bottom-to-top order');
  assert(merged.baseline.revision === 0 && merged.baseline.layers[1].opacity === 0.5 && merged.plan.kind === 'merge' && merged.plan.targetId === 'bottom' && merged.plan.removeIds[0] === 'top', 'captured baseline and plan');
  cases.push({ name: 'tool-fill', png: base64(filled.png), reference: base64(filled.png), samples: { left: pixel(fillRgba, 0, 3), barrier: pixel(fillRgba, 16, 3), right: pixel(fillRgba, 17, 3) } });
  cases.push({ name: 'tool-clear', png: base64(cleared.png), reference: base64(transparent), samples: { center: pixel(await rgbaOf(cleared.png), 4, 4) } });
  cases.push({ name: 'tool-merge-screen', png: base64(merged.png), reference: base64(merged.png), samples: { center: sample } });
  const tolCanvas = canvasOf(); tolCanvas.context.fillStyle = 'rgb(100,100,100)'; tolCanvas.context.fillRect(0, 0, width, height);
  tolCanvas.context.fillStyle = 'rgb(110,100,100)'; tolCanvas.context.fillRect(1, 0, 1, height);
  tolCanvas.context.fillStyle = 'rgb(130,100,100)'; tolCanvas.context.fillRect(2, 0, 1, height);
  const tolPng = await bytesOf(tolCanvas.canvas); tolCanvas.canvas.width = tolCanvas.canvas.height = 0;
  const tol = value(await operations.produce({ kind: 'fill', image: base, layerId: 'layer', x: 0, y: 0, color: [0, 255, 0, 128], tolerance: 10 }, async () => tolPng));
  const tolPixels = await rgbaOf(tol.png);
  assert(pixel(tolPixels, 1, 0).join() === '0,255,0,128' && pixel(tolPixels, 2, 0).join() === '130,100,100,255' && pixel(tolPixels, 3, 0).join() === '100,100,100,255', 'tolerance with disconnected region');
  const transparentFill = value(await operations.produce({ kind: 'fill', image: base, layerId: 'layer', x: 0, y: 0, color: [255, 0, 0, 255], tolerance: 0 }, async () => transparent));
  assert(pixel(await rgbaOf(transparentFill.png), 31, 23).join() === '255,0,0,255', 'transparent fill');
  const multiplyImage = { ...base, layers: [{ ...base.layers[0], id: 'bottom' }, { ...base.layers[0], id: 'top', assetId: 'b'.repeat(64), blendMode: 'multiply' as const }] };
  const multiply = value(await operations.produce({ kind: 'merge', image: multiplyImage, layerIds: ['bottom', 'top'] }, async id => id === 'a'.repeat(64) ? blue : red));
  assert(pixel(await rgbaOf(multiply.png), 4, 4).join() === '0,0,0,255', 'multiply compositing');
  const malformed = await operations.produce({ kind: 'clear', image: base, layerId: 'layer' }, async () => blue.slice(0, 40));
  assert(!malformed.ok && malformed.error.code === 'invalid-input', 'malformed PNG rejected');
  const tooSmall = createPixelTools({ maxPixels: width * height, maxPngBytes: transparent.length, maxLayers: 4 });
  const tooLarge = await tooSmall.produce({ kind: 'fill', image: base, layerId: 'layer', x: 0, y: 0, color: [255,0,0,255], tolerance: 0 }, async () => transparent);
  assert(!tooLarge.ok && tooLarge.error.code === 'resource-limit', 'output byte limit');
  cases.push({ name: 'tool-tolerance', png: base64(tol.png), reference: base64(tol.png), samples: { inside: pixel(tolPixels, 1, 0), boundary: pixel(tolPixels, 2, 0), disconnected: pixel(tolPixels, 3, 0) } });
  cases.push({ name: 'tool-multiply', png: base64(multiply.png), reference: base64(multiply.png), samples: { center: pixel(await rgbaOf(multiply.png), 4, 4) } });
  const normalImage = { ...base, layers: [{ ...base.layers[0], id: 'bottom' },
    { ...base.layers[0], id: 'top', assetId: 'b'.repeat(64), opacity: 0.5 }] };
  const normal = value(await trackedTool('normal-success', { kind: 'merge', image: normalImage, layerIds: ['top', 'bottom'] },
    async id => id === 'a'.repeat(64) ? blue : red));
  const normalPixels = await rgbaOf(normal.png);
  for (let i = 0; i < normalPixels.length; i += 4) {
    assert(normalPixels[i] === 128 && normalPixels[i + 1] === 0 && normalPixels[i + 2] === 127 && normalPixels[i + 3] === 255,
      'normal source-over half-opacity exact whole-image RGBA');
  }
  cases.push({ name: 'tool-merge-normal', png: base64(normal.png), reference: base64(normal.png), samples: { center: pixel(normalPixels, 4, 4) } });

  const clearImage = inputOf(baseStroke()).image;
  const clearRequest: Extract<PixelToolRequest, { kind: 'clear' }> = { kind: 'clear', image: clearImage, layerId: 'layer' };
  let finishClear!: (bytes: Uint8Array) => void;
  let readId = '';
  const clearPending = trackedTool('clear-snapshot-success', clearRequest, id => { readId = id; return new Promise(resolve => { finishClear = resolve; }); });
  clearRequest.layerId = 'changed'; clearImage.revision = 42; clearImage.width = 1;
  clearImage.layers[0].assetId = 'b'.repeat(64); clearImage.layers[0].locked = true;
  finishClear(blue);
  const clearSnapshot = value(await clearPending);
  assert(readId === 'a'.repeat(64) && clearSnapshot.width === width && clearSnapshot.baseline.revision === 0 &&
    clearSnapshot.baseline.layers[0].assetId === 'a'.repeat(64) && !clearSnapshot.baseline.layers[0].locked &&
    clearSnapshot.plan.kind === 'replace' && clearSnapshot.plan.layerId === 'layer', 'clear captures request before await');
  assert((await rgbaOf(clearSnapshot.png)).every(v => v === 0), 'clear snapshot produces transparent pixels');
  cases.push({ name: 'tool-clear-snapshot', png: base64(clearSnapshot.png), reference: base64(transparent), samples: { center: pixel(await rgbaOf(clearSnapshot.png), 4, 4) } });

  const readFailure = await trackedTool('merge-read-failure', { kind: 'merge', image: normalImage, layerIds: ['bottom', 'top'] },
    async id => { if (id === 'a'.repeat(64)) return blue; throw Error('synthetic missing second asset'); });
  assert(!readFailure.ok && readFailure.error.code === 'missing-asset', 'merge read failure retained');
  const encodeLimit = await trackedTool('fill-output-limit-failure', { kind: 'fill', image: base, layerId: 'layer', x: 0, y: 0, color: [255, 0, 0, 255], tolerance: 0 },
    async () => transparent, tooSmall);
  assert(!encodeLimit.ok && encodeLimit.error.code === 'resource-limit', 'output limit failure retained');
  const zero = value(await produce(baseStroke({ opacity: 0 }), blue));
  assert(equalBytes(zero.png, blue) && zero.png !== blue, 'opacity zero preserves private source bytes');
  const truncated = await produce(baseStroke(), blue.slice(0, 40));
  assert(!truncated.ok && truncated.error.code === 'invalid-input', 'real truncated PNG decode refuses');
  const wrong = inputOf(baseStroke()); wrong.image.width--; wrong.image.layers[0].width--;
  const wrongResult = await pixels.produce(wrong, async () => blue);
  assert(!wrongResult.ok && wrongResult.error.code === 'invalid-input', 'wrong natural size refuses without scaling');
  const small = createFlowPixels({ maxPixels: width * height, maxPngBytes: transparent.length, maxPoints: 100 });
  const oversized = await small.produce(inputOf(baseStroke()), async () => transparent);
  assert(!oversized.ok && oversized.error.code === 'resource-limit', 'real encoded output budget refuses');
  return { cases, checks: ['exact existing-algorithm RGBA parity', 'private zero-opacity bytes', 'real decode refusal',
    'dimension refusal', 'real encoded-size refusal', 'owned bitmap/canvas cleanup',
    'pixel-tool native lifetime on success and failure', 'normal blend exact whole-image RGBA', 'clear snapshot during asset read'],
    width, height, admittedBitmaps, closedBitmaps, productionCanvases: productionCanvases.length, toolLifetimes,
    userAgent: navigator.userAgent };
}
