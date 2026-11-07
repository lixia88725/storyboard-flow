import { createImageFrameStore, type FrameIdentity } from '../src/drawing/renderer/image-engine/frames';
import { bindImageFrameCanvas } from '../src/drawing/renderer/image-engine/canvas';
let store: ReturnType<typeof createImageFrameStore> | undefined;
let bindings: ReturnType<typeof bindImageFrameCanvas>[] = [];
const canvas = (id: string) => document.getElementById(id) as HTMLCanvasElement;
export function ready(nonce: string) {
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.kind !== 'flow-live-port' || event.data.nonce !== nonce || event.ports.length !== 1) return;
    const port = event.ports[0];
    port.onmessage = event => {
      const m = event.data, start = performance.now();
      if (m.kind === 'initialize') {
        if (store) throw Error('Live owner already initialized');
        store = createImageFrameStore(m.identity as FrameIdentity);
        bindings = ['a', 'b'].map(id => bindImageFrameCanvas(canvas(id), store!));
        port.postMessage({ id: m.id, result: { ok: true }, displayMs: performance.now() - start });
      } else if (m.kind === 'reset') {
        port.postMessage({ id: m.id, result: store!.reset(m.identity), displayMs: performance.now() - start });
      } else if (m.kind === 'frame') {
        const result = store!.accept(m.header, m.pixels);
        port.postMessage({ id: m.id, result, displayMs: performance.now() - start, byteLength: m.pixels.byteLength });
      }
    };
    port.start(); port.postMessage({ kind: 'ready', nonce });
  });
}
export function rasters() {
  return ['a', 'b'].map(id => { const c = canvas(id); return { id, width: c.width, height: c.height,
    status: c.dataset.frameStatus, seq: c.dataset.frameSeq, rgba: Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data),
    rect: { x: c.getBoundingClientRect().x, y: c.getBoundingClientRect().y, width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height } }; });
}
export function dispose() { store?.dispose(); bindings.forEach(b => b.dispose()); }
