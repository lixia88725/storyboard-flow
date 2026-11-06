import type { LayerV1 } from './refactorV1.js';
/** Retained bytes live at originals/<originalId>.tif inside this project. The
 * suffix is historical; format records their actual signature, including PSD. */
export type FlowSourceReference = {
  originalId: string;
  digest: string;
  format: 'psd' | 'tiff';
  previewPixels: string;
};
export function validSourceReference(value: unknown): value is FlowSourceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as FlowSourceReference;
  return Object.keys(v).sort().join() === 'digest,format,originalId,previewPixels' &&
    typeof v.originalId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v.originalId) &&
    typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest) &&
    typeof v.previewPixels === 'string' && /^[a-f0-9]{64}$/.test(v.previewPixels) && (v.format === 'psd' || v.format === 'tiff');
}
export function validReferenceLayer(layer: unknown): boolean {
  if (!layer || typeof layer !== 'object') return false;
  const l = layer as LayerV1;
  return !Object.hasOwn(l, 'sourceReference') || (validSourceReference(l.sourceReference) && l.kind === 'image' &&
    l.locked === true && l.visible === true && l.opacity === 1 && l.blendMode === 'normal');
}
