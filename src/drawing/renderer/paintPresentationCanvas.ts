import type { PaintRaster } from './paintPresentation';
import { drawStrokePathOnCanvas } from './sketchRendering';

/** All pixels stay in Chromium's sRGB layer plane. Layer opacity/blend mode are
 * applied by the surface once, outside this raster; no full-shot flattening. */
export function paintPresentationCanvas(source: (assetId: string) => Promise<string>): PaintRaster<HTMLCanvasElement> {
  const create = (width: number, height: number) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
  const context = (c: HTMLCanvasElement) => { const ctx = c.getContext('2d'); if (!ctx) throw Error('Canvas2D unavailable'); return ctx; };
  return {
    create,
    copy(to, from) { const ctx = context(to); ctx.clearRect(0, 0, to.width, to.height); ctx.drawImage(from, 0, 0); },
    stroke(to, stroke) { drawStrokePathOnCanvas(context(to), stroke); },
    async decode(target) {
      const image = new Image(); image.src = await source(target.assetId); await image.decode();
      if (image.naturalWidth !== target.width || image.naturalHeight !== target.height) throw Error('Layer raster dimensions changed');
      const canvas = create(target.width, target.height); context(canvas).drawImage(image, 0, 0); return canvas;
    },
    release(canvas) { canvas.width = 0; canvas.height = 0; },
  };
}
