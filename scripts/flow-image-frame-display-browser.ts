import { createImageFrameStore, type FrameIdentity, type ImageFrameHeader, type FrameRegion } from '../src/drawing/renderer/image-engine/frames';
import { bindImageFrameCanvas } from '../src/drawing/renderer/image-engine/canvas';

let store: ReturnType<typeof createImageFrameStore>;
let bindings: Record<string, ReturnType<typeof bindImageFrameCanvas>> = {};
const report: { incoming: unknown[]; transfers: unknown[] } = { incoming: [], transfers: [] };
let port: MessagePort | undefined;
const canvas = (id: string) => document.getElementById(id) as HTMLCanvasElement;
export function initialize(identity: FrameIdentity) {
  store = createImageFrameStore(identity);
  bindings = { a: bindImageFrameCanvas(canvas('a'), store), b: bindImageFrameCanvas(canvas('b'), store) };
}
export function receivePort(nonce: string) {
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.kind !== 'flow-image-frame-port' || event.data.nonce !== nonce || event.ports.length !== 1 || port) return;
    port = event.ports[0];
    port.onmessage = event => {
      const message = event.data;
      if (message.kind === 'frame') {
        const result = store.accept(message.header, message.pixels);
        report.incoming.push({ id: message.id, result, byteLength: message.pixels.byteLength, bufferLength: message.pixels.buffer.byteLength });
        port!.postMessage({ kind: 'installed', id: message.id, result });
      }
    };
    port.start(); port.postMessage({ kind: 'ready', nonce });
  });
}
export function reset(identity: FrameIdentity) { return store.reset(identity); }
export function remount(id: string) { bindings[id]?.dispose(); bindings[id] = bindImageFrameCanvas(canvas(id), store); }
export function disposeOwner() { store.dispose(); }
export function dispose(id: string) { bindings[id]?.dispose(); }
export function refresh(id: string) { bindings[id]?.refresh(); }
export function state() {
  return ['a', 'b'].map(id => ({ id, status: canvas(id).dataset.frameStatus, seq: canvas(id).dataset.frameSeq,
    width: canvas(id).width, height: canvas(id).height, visibility: getComputedStyle(canvas(id)).visibility,
    rect: { x: canvas(id).getBoundingClientRect().x, y: canvas(id).getBoundingClientRect().y, width: canvas(id).getBoundingClientRect().width, height: canvas(id).getBoundingClientRect().height } }));
}
export function pixels(id: string, region?: FrameRegion) {
  const c = canvas(id), r = region ?? { x: 0, y: 0, w: c.width, h: c.height };
  return Array.from(c.getContext('2d')!.getImageData(r.x, r.y, r.w, r.h).data);
}
export function expected() { return Array.from(store.snapshot().frame?.pixels ?? []); }
export function results() { return report; }
export async function domTransferProbe() {
  const channel = new MessageChannel(), pixels = new Uint8Array([17, 29, 43]).buffer;
  const received = new Promise<number[]>(resolve => { channel.port2.onmessage = e => resolve(Array.from(new Uint8Array(e.data.pixels))); });
  channel.port1.postMessage({ pixels }, [pixels]);
  const output = { senderAfter: pixels.byteLength, received: await received };
  channel.port1.close(); channel.port2.close(); return output;
}
// Keep the renderer harness available only in the isolated smoke bundle, not product globals.
export type Header = ImageFrameHeader;
