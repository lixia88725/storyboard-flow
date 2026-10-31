import type { FlowPixelTool, FlowPixelToolOutput, FlowResult } from '../../../electron/shared/flowWave2';
import type { ImageDocumentV1, ImageEditResultV1 } from '../../../electron/shared/refactorV1';
import { applyImageEdit } from '../drawing';
import { failure } from './validation';

/** Session computes the allowed plan; a pixel producer cannot choose unrelated edits. */
export function toolPlan(image: ImageDocumentV1, tool: FlowPixelTool): FlowResult<FlowPixelToolOutput['plan']> {
  const ids = tool.kind === 'merge' ? tool.layerIds : [tool.layerId];
  const selected = image.layers.filter(layer => ids.includes(layer.id));
  if (selected.length !== ids.length) return failure('not-found', 'Layer not found');
  if (selected.some(layer => layer.locked || !layer.visible)) return failure('locked', 'Tools require visible unlocked layers');
  if (tool.kind === 'transform' && selected[0].assetId !== tool.expectedAssetId) return failure('conflict', 'Selection source changed; select again');
  if (tool.kind !== 'merge') return { ok: true, value: { kind: 'replace', layerId: tool.layerId } };
  const start = image.layers.indexOf(selected[0]);
  if (selected.some((layer, i) => image.layers[start + i] !== layer)) return failure('invalid-input', 'Merge layers must be contiguous');
  if (start !== 0 && selected.some(layer => layer.blendMode !== 'normal')) return failure('invalid-input', 'Blended merge requires the bottom of the stack');
  return { ok: true, value: { kind: 'merge', targetId: selected[0].id, removeIds: selected.slice(1).map(layer => layer.id), targetProperties: { opacity: 1, blendMode: 'normal' } } };
}

/** Compose privately, then publish one image revision and one project history entry. */
export function adoptTool(image: ImageDocumentV1, plan: FlowPixelToolOutput['plan'], assetId: string): FlowResult<ImageEditResultV1> {
  const first = applyImageEdit(image, { kind: 'replacePixels', layerId: plan.kind === 'replace' ? plan.layerId : plan.targetId, assetId });
  if (!first.ok) return { ok: false, error: { ...first.error, effect: 'retained' } };
  if (plan.kind === 'replace') return first;
  // Every intermediate edit is private and starts at the captured revision, so a
  // compound operation consumes one revision even near the safe-integer limit.
  let after = first.value.after;
  for (const layerId of plan.removeIds) {
    const result = applyImageEdit({ ...after, revision: image.revision }, { kind: 'removeLayer', layerId });
    if (!result.ok) return { ok: false, error: { ...result.error, effect: 'retained' } };
    after = result.value.after;
  }
  const properties = applyImageEdit({ ...after, revision: image.revision }, { kind: 'setLayer', layerId: plan.targetId, patch: plan.targetProperties });
  if (!properties.ok) return { ok: false, error: { ...properties.error, effect: 'retained' } };
  return { ok: true, value: { before: image, after: { ...properties.value.after, revision: image.revision + 1 }, changed: true, visualChanged: true } };
}
