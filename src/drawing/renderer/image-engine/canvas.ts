import type { FrameView, InstalledFrameHeader } from './frames';

export type FrameCanvasStatus = 'preparing' | 'ready' | 'error' | 'disposed';
export type FrameViewSource = { view(): FrameView; subscribe(listener: (view: FrameView) => void): () => void };
const sameGeneration = (a: InstalledFrameHeader, b: InstalledFrameHeader) => a.sessionId === b.sessionId &&
  a.incarnation === b.incarnation && a.documentId === b.documentId && a.workerEpoch === b.workerEpoch && a.epoch === b.epoch;

/** Display Adapter only. Canvas pixels are a disposable projection of FrameStore.
 * The caller owns CSS geometry/zoom. Intrinsic size stays in document pixels;
 * pointer coordinates and all image edits remain outside this Module.
 * Initial mount/refresh catches up from the complete view; updates read damage.
 */
export function bindImageFrameCanvas(canvas: HTMLCanvasElement, source: FrameViewSource, options: {
  onStatus?(status: FrameCanvasStatus, error?: string): void;
} = {}) {
  let disposed = false, last: InstalledFrameHeader | null = null;
  const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
  const status = (value: FrameCanvasStatus, error?: string) => {
    canvas.dataset.frameStatus = value;
    canvas.style.visibility = value === 'ready' ? 'visible' : 'hidden';
    if (value !== 'ready') delete canvas.dataset.frameSeq;
    try { options.onStatus?.(value, error); } catch { /* A status observer cannot undo display installation. */ }
  };
  const conceal = (value: FrameCanvasStatus, error?: string) => {
    last = null;
    // Retain intrinsic geometry while preparing. Hidden pixels must not flash on a reset.
    context?.clearRect(0, 0, canvas.width, canvas.height);
    status(value, error);
  };
  const paint = (view: FrameView, forceFull = false) => {
    if (disposed) return;
    if (view.needsKeyframe || !view.header) { conceal('preparing'); return; }
    const header = view.header;
    try {
      if (!context) throw Error('Canvas2D sRGB display unavailable');
      const resized = canvas.width !== header.width || canvas.height !== header.height;
      const full = forceFull || resized || !last || !sameGeneration(last, header) || header.frameSeq !== last.frameSeq + 1;
      // Hide before resizing; neither dimension assignment can expose the prior backing.
      if (full) status('preparing');
      if (resized) { canvas.width = header.width; canvas.height = header.height; }
      const regions = full ? [{ x: 0, y: 0, w: header.width, h: header.height }] : view.damage;
      for (const region of regions) {
        const bytes = view.readRegion(region);
        if (!bytes || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength !== region.w * region.h * 4) throw Error('Frame view returned incomplete display pixels');
        const clamped = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        // Absolute replacement is essential: source-over would retain pixels erased to alpha=0.
        context.putImageData(new ImageData(clamped, region.w, region.h, { colorSpace: 'srgb' }), region.x, region.y);
      }
      last = { ...header }; canvas.dataset.frameSeq = String(header.frameSeq); status('ready');
    } catch (error) { conceal('error', error instanceof Error ? error.message : String(error)); }
  };
  status('preparing');
  const unsubscribe = source.subscribe(view => paint(view));
  paint(source.view(), true);
  return {
    /** Explicitly repair an externally reset bitmap, or catch up a reattached surface. */
    refresh() { paint(source.view(), true); },
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); last = null;
      canvas.width = 0; canvas.height = 0; status('disposed');
    },
  };
}
