import type { ImageDocumentV1, LayerV1 } from '../../platform/contracts/refactorV1.js';

export type ImageReconciliation =
  | { kind: 'unchanged' }
  | { kind: 'replace'; image: ImageDocumentV1 }
  | { kind: 'conflict'; reason: 'identity' | 'canvas' | 'layer' | 'order' };
const layerValue = (l: LayerV1 | undefined) => l && [l.id, l.name, l.kind, l.visible,
  l.locked, l.opacity, l.blendMode, l.width, l.height, l.assetId, l.sourceReference];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameLayer = (a: LayerV1 | undefined, b: LayerV1 | undefined) => same(layerValue(a), layerValue(b));
const imageValue = (image: ImageDocumentV1) => [image.width, image.height, image.layers.map(layerValue)];

/** Pure policy for already validated/admitted image documents. `identified` means
 * the format adapter proved correspondence; matching names/array positions do not.
 * Project text, filesystem ownership and revision counters are not pixel changes. */
export function reconcileExternalImage(baseline: ImageDocumentV1, local: ImageDocumentV1,
  external: ImageDocumentV1, identified: boolean): ImageReconciliation {
  if (!identified || baseline.id !== local.id || [baseline, local, external].some(image =>
    new Set(image.layers.map(layer => layer.id)).size !== image.layers.length)) return { kind: 'conflict', reason: 'identity' };
  if (same(imageValue(local), imageValue(external)) || same(imageValue(baseline), imageValue(external))) return { kind: 'unchanged' };
  const references = local.layers.filter(layer => layer.sourceReference);
  if (references.length && (external.width !== local.width || external.height !== local.height ||
      references.some(layer => !sameLayer(layer, external.layers.find(other => other.id === layer.id))))) return {kind:'conflict',reason:'layer'};
  const localChanged = !same(imageValue(baseline), imageValue(local));
  const externalCanvas = external.width !== baseline.width || external.height !== baseline.height;
  const localCanvas = local.width !== baseline.width || local.height !== baseline.height;
  if (localChanged && (externalCanvas || localCanvas)) return { kind: 'conflict', reason: 'canvas' };
  const b = new Map(baseline.layers.map(l => [l.id, l])), l = new Map(local.layers.map(l => [l.id, l])), e = new Map(external.layers.map(l => [l.id, l]));
  const merged = new Map<string, LayerV1>();
  for (const id of new Set([...b.keys(), ...l.keys(), ...e.keys()])) {
    const before = b.get(id), here = l.get(id), there = e.get(id);
    const localChange = !sameLayer(before, here), externalChange = !sameLayer(before, there);
    if (localChange && externalChange && !sameLayer(here, there)) return { kind: 'conflict', reason: 'layer' };
    const chosen = externalChange ? there : here;
    if (chosen) merged.set(id, chosen);
  }
  const order = (image: ImageDocumentV1) => image.layers.map(l => l.id);
  const baseOrder = order(baseline), localOrder = order(local), externalOrder = order(external);
  let selected: string[];
  if (same(localOrder, externalOrder) || same(baseOrder, externalOrder)) selected = localOrder;
  else if (same(baseOrder, localOrder)) selected = externalOrder;
  else return { kind: 'conflict', reason: 'order' };
  const layers = selected.filter(id => merged.has(id)).map(id => merged.get(id)!);
  if (layers.length !== merged.size || !layers.length) return { kind: 'conflict', reason: 'order' };
  if (!Number.isSafeInteger(local.revision + 1)) throw Error('Image revision overflow');
  return { kind: 'replace', image: structuredClone({ id: local.id, revision: local.revision + 1,
    width: externalCanvas ? external.width : local.width, height: externalCanvas ? external.height : local.height, layers }) };
}
