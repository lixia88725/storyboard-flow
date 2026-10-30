/** Browser-only synthetic checks, invoked by canvas-harness.mjs in a hidden Electron window.
 * This exercises real Canvas2D/decode/PNG output, not UI gestures or production wiring.
 */
import type { FlowPixelInput, FlowPixelOutput, FlowResult, FlowStroke } from '../../../electron/shared/flowWave2';
import { drawStrokePathOnCanvas } from '../sketchRendering';
import { createFlowPixels } from './index';

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
    'dimension refusal', 'real encoded-size refusal', 'owned bitmap/canvas cleanup'],
    width, height, admittedBitmaps, closedBitmaps, productionCanvases: productionCanvases.length,
    userAgent: navigator.userAgent };
}
