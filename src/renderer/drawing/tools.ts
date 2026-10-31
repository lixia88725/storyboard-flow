import { validSelection, validTransform, type FlowSelection, type FlowTransform } from '../../../electron/shared/flowSelection';
import type { FlowFailure, FlowResult } from '../../../electron/shared/flowWave2';
import type { AssetReaderV1, ImageDocumentV1 } from '../../../electron/shared/refactorV1';
import { applyImageEdit } from '../../core/drawing';

import type { FlowPixelToolRequest, FlowPixelToolOutput } from '../../../electron/shared/flowWave2';
export type PixelToolRequest = FlowPixelToolRequest;
export type PixelToolOutput = FlowPixelToolOutput;
export type PixelToolLimits = { maxPixels: number; maxPngBytes: number; maxLayers: number };
const fail = (code: FlowFailure['code'], message: string): FlowResult<never> => ({ ok: false, error: { code, message, effect: 'none' } });
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const validRgba = (value: unknown): value is [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4) return false;
  for (let index = 0; index < 4; index++) {
    if (!Object.hasOwn(value, index)) return false;
    const channel: unknown = value[index];
    if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255) return false;
  }
  return true;
};

/** Produces private pixels and a proposed plan, never writes assets or publishes state.
 * maxPixels bounds the canvas and flood-fill queue; maxLayers bounds merge reads. */
export function createPixelTools(limits: PixelToolLimits) {
  const bounded = limits && integer(limits.maxPixels) && integer(limits.maxPngBytes) && integer(limits.maxLayers)
    ? { ...limits } : undefined;
  return { async produce(request: PixelToolRequest, read: AssetReaderV1): Promise<FlowResult<PixelToolOutput>> {
    let image: ImageDocumentV1, ids: string[], plan: PixelToolOutput['plan'], kind: PixelToolRequest['kind'];
    let selection: FlowSelection | undefined, matrix: FlowTransform | undefined;
    let blurRadius: number | undefined;
    let fill: { x: number; y: number; color: number[]; tolerance: number } | undefined;
    try {
      if (!bounded || typeof read !== 'function' || !request || !['fill', 'clear', 'merge', 'blur', 'transform'].includes(request.kind)) return fail('invalid-input', 'Invalid limits, request or reader');
      kind = request.kind;
      const firstId = request.kind === 'merge' ? request.layerIds?.[0] : request.layerId;
      const checked = applyImageEdit(request.image, { kind: 'setLayer', layerId: firstId, patch: {} });
      if (!checked.ok) return { ok: false, error: { ...checked.error, effect: 'none' } };
      image = { ...request.image, layers: request.image.layers.map(layer => ({ ...layer })) };
      if (image.width > bounded.maxPixels / image.height || image.width * image.height > 0xffffffff) return fail('resource-limit', 'Image exceeds pixel allocation limit');
      if (request.kind === 'merge') {
        if (!Array.isArray(request.layerIds) || request.layerIds.length < 2 || request.layerIds.length > bounded.maxLayers || new Set(request.layerIds).size !== request.layerIds.length) return fail('invalid-input', 'Merge requires distinct layers within the limit');
        const selected = new Set(request.layerIds);
        const indices = image.layers.flatMap((layer, i) => selected.has(layer.id) ? [i] : []);
        if (indices.length !== selected.size) return fail('not-found', 'Merge layer not found');
        if (indices.some((n, i) => n !== indices[0] + i)) return fail('invalid-input', 'Merge layers must be contiguous');
        const layers = indices.map(i => image.layers[i]);
        if (layers.some(l => l.locked)) return fail('locked', 'Merge layer is locked');
        if (layers.some(l => !l.visible)) return fail('invalid-input', 'Merge layers must be visible');
        // Blending against an unselected backdrop cannot in general be represented by a flattened normal layer.
        if (indices[0] !== 0 && layers.some(l => l.blendMode !== 'normal')) return fail('invalid-input', 'Blended merge requires the bottom of the stack');
        ids = layers.map(l => l.id);
        plan = { kind: 'merge', targetId: ids[0], removeIds: ids.slice(1), targetProperties: { opacity: 1, blendMode: 'normal' } };
      } else {
        const layer = image.layers.find(l => l.id === request.layerId)!;
        if (layer.locked) return fail('locked', 'Target is locked');
        if (!layer.visible) return fail('invalid-input', 'Target must be visible');
        ids = [layer.id]; plan = { kind: 'replace', layerId: layer.id };
        if ((request.kind === 'blur' && Object.hasOwn(request, 'selection')) || request.kind === 'transform') {
          if (!validSelection(request.selection)) return fail('invalid-input', 'Invalid selection');
          selection = request.selection.map(p => ({...p}));
        }
        if (request.kind === 'transform') {
          if (!validTransform(request.matrix)) return fail('invalid-input', 'Invalid transform');
          if (layer.assetId !== request.expectedAssetId) return fail('conflict', 'Selection source changed');
          matrix = [...request.matrix];
        }
        if(request.kind==='blur'){if(typeof request.radius!=='number'||!Number.isFinite(request.radius)||request.radius<1||request.radius>50)return fail('invalid-input','Blur radius must be 1–50 pixels');blurRadius=request.radius;}
        if (request.kind === 'fill') {
          if (!Number.isFinite(request.x) || !Number.isFinite(request.y) || !Number.isInteger(request.tolerance) || request.tolerance < 0 || request.tolerance > 255 || !validRgba(request.color)) return fail('invalid-input', 'Invalid fill coordinates, RGBA or tolerance');
          fill = { x: Math.min(image.width - 1, Math.max(0, Math.floor(request.x))), y: Math.min(image.height - 1, Math.max(0, Math.floor(request.y))), color: [...request.color], tolerance: request.tolerance };
        }
      }
    } catch (e) { return fail('invalid-input', `Could not capture input: ${errorText(e)}`); }
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function' || typeof Blob === 'undefined') return fail('unavailable', 'Canvas unavailable');
    let canvas: HTMLCanvasElement | undefined;
    let blurred: HTMLCanvasElement | undefined;
    let bitmap: ImageBitmap | undefined;
    try {
      canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); if (!ctx) return fail('unavailable', 'Canvas context unavailable');
      for (const id of ids) {
        const layer = image.layers.find(l => l.id === id)!;
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          const source = await read(layer.assetId);
          if (!(source instanceof Uint8Array) || !source.byteLength) return fail('invalid-input', 'Asset must be PNG bytes');
          if (source.byteLength > bounded!.maxPngBytes) return fail('resource-limit', 'Source PNG exceeds limit');
          bytes = new Uint8Array(source);
        } catch (e) { return fail('missing-asset', `Asset read failed: ${errorText(e)}`); }
        if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return fail('invalid-input', 'Invalid PNG header');
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 || header.getUint32(16) !== image.width || header.getUint32(20) !== image.height) return fail('invalid-input', 'PNG dimensions mismatch');
        try { bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); } catch (e) { return fail('invalid-input', `PNG decode failed: ${errorText(e)}`); }
        if (bitmap.width !== image.width || bitmap.height !== image.height) return fail('invalid-input', 'Decoded dimensions mismatch');
        ctx.globalAlpha = kind === 'merge' ? layer.opacity : 1;
        ctx.globalCompositeOperation = kind === 'merge' && layer.blendMode !== 'normal' ? layer.blendMode : 'source-over';
        ctx.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = undefined;
      }
      if (kind === 'clear') ctx.clearRect(0, 0, image.width, image.height);
      const mask = (context: CanvasRenderingContext2D) => {
        context.beginPath(); selection!.forEach((p,i) => i ? context.lineTo(p.x,p.y) : context.moveTo(p.x,p.y)); context.closePath();
      };
      if (matrix) {
        blurred=document.createElement('canvas'); blurred.width=image.width; blurred.height=image.height;
        const patch=blurred.getContext('2d'); if(!patch)return fail('unavailable','Canvas context unavailable');
        mask(patch); patch.clip(); patch.drawImage(canvas,0,0);
        ctx.save(); ctx.globalCompositeOperation='destination-out'; mask(ctx); ctx.fill(); ctx.restore();
        ctx.save(); ctx.transform(...matrix); ctx.drawImage(blurred,0,0); ctx.restore();
      }
      if(blurRadius!==undefined){
        blurred=document.createElement('canvas');blurred.width=image.width;blurred.height=image.height;
        const filtered=blurred.getContext('2d');if(!filtered||!('filter' in filtered))return fail('unavailable','Canvas blur unavailable');
        filtered.filter=`blur(${blurRadius}px)`;
        if(filtered.filter!==`blur(${blurRadius}px)`)return fail('unavailable','Canvas blur filter refused');
        filtered.drawImage(canvas,0,0);
        // Replace the original pixels; overlaying leaves a sharp opaque core.
        ctx.save(); if(selection){mask(ctx);ctx.clip();}
        ctx.clearRect(0,0,image.width,image.height);ctx.drawImage(blurred,0,0);ctx.restore();
      }
      if (fill) {
        const pixels = ctx.getImageData(0, 0, image.width, image.height), data = pixels.data;
        const start = fill.y * image.width + fill.x, target = Array.from(data.slice(start * 4, start * 4 + 4));
        const queue = new Uint32Array(image.width * image.height), visited = new Uint8Array(queue.length);
        let head = 0, tail = 0; queue[tail++] = start; visited[start] = 1;
        while (head < tail) {
          const pos = queue[head++], offset = pos * 4;
          if (target.some((v, i) => Math.abs(data[offset + i] - v) > fill!.tolerance)) continue;
          data.set(fill.color, offset);
          const x = pos % image.width, y = Math.floor(pos / image.width);
          const add = (next: number) => { if (!visited[next]) { visited[next] = 1; queue[tail++] = next; } };
          if (x) add(pos - 1); if (x + 1 < image.width) add(pos + 1); if (y) add(pos - image.width); if (y + 1 < image.height) add(pos + image.width);
        }
        ctx.putImageData(pixels, 0, 0);
      }
      let blob: Blob;
      try { blob = await new Promise<Blob>((resolve, reject) => canvas!.toBlob(b => b ? resolve(b) : reject(Error('PNG encoder returned null')), 'image/png')); }
      catch (e) { return fail('io-failure', `PNG encode failed: ${errorText(e)}`); }
      if (blob.type !== 'image/png' || !blob.size) return fail('io-failure', 'PNG encoder returned invalid output');
      if (blob.size > bounded!.maxPngBytes) return fail('resource-limit', 'Output PNG exceeds limit');
      const png = new Uint8Array(await blob.arrayBuffer());
      if (png.length !== blob.size) return fail('io-failure', 'PNG byte length changed');
      return { ok: true, value: { png, width: image.width, height: image.height, baseline: image, plan } };
    } catch (e) { return fail('unavailable', `Canvas operation failed: ${errorText(e)}`); }
    finally { bitmap?.close(); if(blurred){blurred.width=0;blurred.height=0;} if (canvas) { canvas.width = 0; canvas.height = 0; } }
  } };
}
