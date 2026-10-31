import type {
  FlowFailure, FlowPixelInput, FlowPixelLimits, FlowPixelOutput, FlowPixels,
  FlowResult, FlowStroke
} from '../../../electron/shared/flowWave2';
import type { AssetReaderV1, ImageDocumentV1 } from '../../../electron/shared/refactorV1';
import { applyImageEdit } from '../../core/drawing';
import { drawStrokePathOnCanvas } from '../sketchRendering';

const fail = (code: FlowFailure['code'], message: string): FlowResult<never> =>
  ({ ok: false, error: { code, message, effect: 'none' } });
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const unitInterval = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type Prepared = { image: ImageDocumentV1; assetId: string; stroke: FlowStroke };

/** Validate before allocating the private points/image snapshot or starting an async reader.
 * The no-op uses drawing's public Interface to validate the complete image and target,
 * keeping its structural/unsupported-field policy in one place without importing private helpers.
 */
const prepare = (input: FlowPixelInput, limits: FlowPixelLimits): FlowResult<Prepared> => {
  if (!record(input)) return fail('invalid-input', 'Pixel input must be an object');
  const checked = applyImageEdit(input.image, { kind: 'setLayer', layerId: input.layerId, patch: {} });
  if (!checked.ok) return { ok: false, error: { ...checked.error, effect: 'none' } };
  const layer = input.image.layers.find(item => item.id === input.layerId)!;
  if (layer.locked) return fail('locked', 'Pixel target is locked');
  if (!layer.visible) return fail('invalid-input', 'Pixel target must be visible');
  if (input.image.width > limits.maxPixels / input.image.height)
    return fail('resource-limit', 'Image exceeds maxPixels');

  const stroke = input.stroke;
  if (!record(stroke) || (stroke.tool !== 'brush' && stroke.tool !== 'eraser') ||
      typeof stroke.color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(stroke.color) ||
      typeof stroke.size !== 'number' || !Number.isFinite(stroke.size) || stroke.size <= 0 ||
      !unitInterval(stroke.opacity) || !unitInterval(stroke.softness) ||
      !Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length % 2 !== 0)
    return fail('invalid-input', 'Stroke requires a tool, hex color, positive size, unit opacity/softness and coordinate pairs');
  if (stroke.points.length / 2 > limits.maxPoints) return fail('resource-limit', 'Stroke exceeds maxPoints');
  // Array.every skips holes; a sparse pair must not become undefined Canvas coordinates.
  for (const value of stroke.points) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return fail('invalid-input', 'Stroke coordinates must be finite numbers');
  }
  return { ok: true, value: {
    image: { ...input.image, layers: input.image.layers.map(item => ({ ...item })) },
    assetId: layer.assetId,
    stroke: { tool: stroke.tool, color: stroke.color, size: stroke.size,
      opacity: stroke.opacity, softness: stroke.softness, points: [...stroke.points] }
  } };
};

/** This header check is allocation admission, not a substitute for the browser PNG decoder. */
const checkPng = (bytes: Uint8Array, width: number, height: number): FlowResult<true> => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value))
    return fail('invalid-input', 'Source must be a PNG with a complete IHDR');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== width || view.getUint32(20) !== height)
    return fail('invalid-input', 'PNG IHDR dimensions must match the image and layer');
  return { ok: true, value: true };
};

const encode = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas PNG encoder returned no blob')), 'image/png');
  });

/** Canvas2D pixels only: no project publication, asset writes, history, timers or UI gestures.
 * Limits are per-call admission, not a process/GPU memory cap. Consumers must bound concurrency.
 * Invalid factory limits produce typed failures rather than creating an unbounded producer.
 */
export const createFlowPixels = (limits: FlowPixelLimits): FlowPixels => {
  const bounded = record(limits) && positiveInteger(limits.maxPixels) &&
    positiveInteger(limits.maxPngBytes) && positiveInteger(limits.maxPoints)
    ? { maxPixels: limits.maxPixels, maxPngBytes: limits.maxPngBytes, maxPoints: limits.maxPoints }
    : undefined;

  return { async blank(width, height, background = 'white') {
    if (!bounded || !['white','transparent'].includes(background) || !positiveInteger(width) || !positiveInteger(height)) return fail('invalid-input', 'Invalid blank canvas dimensions');
    if (width > bounded.maxPixels / height) return fail('resource-limit', 'Blank canvas exceeds maxPixels');
    if (typeof document === 'undefined') return fail('unavailable', 'Canvas unavailable');
    let canvas: HTMLCanvasElement | undefined;
    try {
      canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); if (!ctx) return fail('unavailable', 'Canvas unavailable');
      if (background === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
      const blob = await encode(canvas);
      if (blob.type !== 'image/png' || !blob.size) return fail('io-failure', 'Invalid blank PNG');
      if (blob.size > bounded.maxPngBytes) return fail('resource-limit', 'Blank PNG exceeds limit');
      return { ok: true, value: { png: new Uint8Array(await blob.arrayBuffer()), width, height } };
    } catch (error) { return fail('io-failure', message(error)); }
    finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
  }, async produce(input: FlowPixelInput, readAsset: AssetReaderV1): Promise<FlowResult<FlowPixelOutput>> {
    let prepared: Prepared;
    try {
      if (!bounded) return fail('invalid-input', 'Pixel limits must be positive safe integers');
      if (typeof readAsset !== 'function') return fail('invalid-input', 'An asset reader is required');
      const result = prepare(input, bounded);
      if (!result.ok) return result;
      prepared = result.value;
    } catch (error) {
      return fail('invalid-input', `Pixel input could not be captured: ${message(error)}`);
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function' ||
        typeof createImageBitmap !== 'function' || typeof Blob === 'undefined')
      return fail('unavailable', 'Canvas2D PNG decoding requires a browser document');

    let png: Uint8Array<ArrayBuffer>;
    try {
      const bytes: unknown = await readAsset(prepared.assetId);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        return fail('invalid-input', 'Asset reader must return nonempty PNG bytes');
      if (bytes.byteLength > bounded!.maxPngBytes) return fail('resource-limit', 'Source exceeds maxPngBytes');
      png = new Uint8Array(bytes);
    } catch (error) {
      return fail('missing-asset', `Source asset could not be read: ${message(error)}`);
    }
    const { width, height } = prepared.image;
    const header = checkPng(png, width, height);
    if (!header.ok) return header;

    let bitmap: ImageBitmap | undefined;
    let canvas: HTMLCanvasElement | undefined;
    try {
      try { bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' })); }
      catch (error) { return fail('invalid-input', `PNG decode failed: ${message(error)}`); }
      if (bitmap.width !== width || bitmap.height !== height)
        return fail('invalid-input', 'Decoded PNG dimensions must match the image and layer');
      // Even a no-op must decode/validate the source, and returns its own private bytes.
      if (prepared.stroke.opacity === 0) return { ok: true, value: { png, width, height } };

      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return fail('unavailable', 'Canvas2D context could not be created');
      context.drawImage(bitmap, 0, 0);
      // Coordinates already use image pixels. No renderer sketch-coordinate scaling here.
      drawStrokePathOnCanvas(context, { ...prepared.stroke, id: 'flow-pixel-stroke', points: [...prepared.stroke.points] });
      let blob: Blob;
      try { blob = await encode(canvas); }
      catch (error) { return fail('io-failure', `Canvas PNG encode failed: ${message(error)}`); }
      if (blob.type !== 'image/png' || blob.size === 0) return fail('io-failure', 'Canvas did not encode a nonempty PNG');
      if (blob.size > bounded!.maxPngBytes) return fail('resource-limit', 'Output exceeds maxPngBytes');
      let output: Uint8Array<ArrayBuffer>;
      try { output = new Uint8Array(await blob.arrayBuffer()); }
      catch (error) { return fail('io-failure', `Encoded PNG could not be read: ${message(error)}`); }
      if (output.byteLength !== blob.size) return fail('io-failure', 'Encoded PNG byte length changed');
      return { ok: true, value: { png: output, width, height } };
    } catch (error) {
      return fail('unavailable', `Canvas pixel production failed: ${message(error)}`);
    } finally {
      // Only resources created by this call; no caller canvas, URL or bitmap is adopted.
      bitmap?.close();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  } };
};

export { createPixelTools } from "./tools";
export type { PixelToolLimits, PixelToolOutput, PixelToolRequest } from "./tools";
