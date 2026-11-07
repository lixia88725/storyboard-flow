import { createImageFrameStore, type FrameIdentity, type ImageFrameHeader } from '../src/drawing/renderer/image-engine/frames';
import { bindImageFrameCanvas } from '../src/drawing/renderer/image-engine/canvas';
let store: ReturnType<typeof createImageFrameStore> | undefined;
let bindings: ReturnType<typeof bindImageFrameCanvas>[] = [];
let reference: Uint8Array | undefined, width = 0, height = 0, channelsChecked = 0, framesChecked = 0;
const canvas = (id: string) => document.getElementById(id) as HTMLCanvasElement;
function verify(h: ImageFrameHeader, payload: Uint8Array) {
  if (h.baseFrameSeq === null) { width = h.width; height = h.height; reference = new Uint8Array(width * height * 4); }
  if (!reference || width !== h.width || height !== h.height) throw Error('Reference baseline missing');
  // Independent flat native reference; production FrameStore uses copy-on-write tiles.
  for (const t of h.tiles) for (let y = 0; y < t.h; y++) reference.set(payload.subarray(t.offset + y * t.w * 4, t.offset + (y + 1) * t.w * 4), ((t.y + y) * width + t.x) * 4);
  for (const id of ['a', 'b']) {
    const c = canvas(id); if (c.dataset.frameStatus !== 'ready' || c.width !== width || c.height !== height) throw Error('Canvas not installed ' + id);
    for (const t of h.tiles) {
      const actual = c.getContext('2d')!.getImageData(t.x, t.y, t.w, t.h).data;
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) for (let channel = 0; channel < 4; channel++) {
        const got = actual[(y * t.w + x) * 4 + channel], expected = reference[((t.y + y) * width + t.x + x) * 4 + channel];
        if (got !== expected) throw Error(`Native/Canvas mismatch ${id} frame ${h.frameSeq} at ${t.x+x},${t.y+y}/${channel}: ${got}/${expected}`);
      }
      channelsChecked += actual.length;
    }
  }
  framesChecked++;
}
export function ready(nonce: string) {
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.kind !== 'flow-pipeline-port' || event.data.nonce !== nonce || event.ports.length !== 1) return;
    const port = event.ports[0];
    port.onmessage = event => {
      const m = event.data, receivedAt = performance.now();
      try {
        if (m.kind === 'initialize') {
          if (store) throw Error('Owner already initialized'); store = createImageFrameStore(m.identity as FrameIdentity);
          bindings = ['a', 'b'].map(id => bindImageFrameCanvas(canvas(id), store!));
          port.postMessage({ id: m.id, result: { ok: true } });
        } else if (m.kind === 'reset') port.postMessage({ id: m.id, result: store!.reset(m.identity) });
        else if (m.kind === 'frame') {
          const result = store!.accept(m.header, m.pixels), installedAt = performance.now();
          if (result.ok) verify(m.header, m.pixels);
          port.postMessage({ id: m.id, result, rendererFrameReceivedUnixMs: performance.timeOrigin + receivedAt,
            rendererCanvasInstalledUnixMs: performance.timeOrigin + installedAt, displayMs: installedAt - receivedAt,
            verificationMs: performance.now() - installedAt, framesChecked, channelsChecked });
        }
      } catch (error) { port.postMessage({ id: m.id, result: { ok: false, message: String(error) } }); }
    };
    port.start(); port.postMessage({ kind: 'ready' });
  });
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join('');
export async function summary(points: { x: number; y: number }[] = []) {
  if (!reference || !store) throw Error('No frame');
  const rasters = [];
  for (const id of ['a', 'b']) {
    const c = canvas(id), pixels = c.getContext('2d')!.getImageData(0, 0, width, height).data, r = c.getBoundingClientRect();
    rasters.push({ id, width, height, hash: hex(await crypto.subtle.digest('SHA-256', pixels)), rect: { x:r.x, y:r.y, width:r.width, height:r.height } });
  }
  return { referenceHash: hex(await crypto.subtle.digest('SHA-256', new Uint8Array(reference))), rasters, framesChecked, channelsChecked,
    probes: points.map(p => ({ ...p, rgba: Array.from(reference!.subarray((p.y*width+p.x)*4,(p.y*width+p.x)*4+4)) })), header: store.view().header };
}
export function probes(points: {x:number;y:number}[]) {
  if (!reference) throw Error('No reference');
  return points.map(p => ({...p,rgba:Array.from(reference!.subarray((p.y*width+p.x)*4,(p.y*width+p.x)*4+4))}));
}
export function swatch(rgba: number[]) {
  document.getElementById('reference')!.style.backgroundColor = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]/255})`;
}
export function dispose() { store?.dispose(); bindings.forEach(b => b.dispose()); }
