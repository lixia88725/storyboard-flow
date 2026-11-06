import { validReferenceLayer } from '../../platform/contracts/flowSourceReference';
import {validPresentation} from '../../platform/contracts/flowPresentation';
import type { ChangeSetV1, ImageDocumentV1, ProjectEditResultV1, ProjectV1, ResultV1, ShotV1 } from '../../platform/contracts/refactorV1';

export const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
export const assetPattern = /^[a-f0-9]{64}$/;
export const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const shape = (v: unknown, keys: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> =>
  record(v) && Object.keys(v).every(k => keys.includes(k) || optional.includes(k)) && keys.every(k => own(v, k));
export const id = (v: unknown): v is string => typeof v === 'string' && idPattern.test(v);
export const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export const dimension = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
export const text = (v: unknown): v is string => typeof v === 'string';
export const fail = <T>(code: 'invalid-input' | 'not-found' | 'conflict' | 'unsupported-version', message: string): ResultV1<T> =>
  ({ ok: false, error: { code, message } });
export const ok = <T>(value: T): ResultV1<T> => ({ ok: true, value });
export const copy = <T>(v: T): T => structuredClone(v);
// JSON-shaped domain values only. Key order is not part of image identity.
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && same(a[k], b[k]));
};
export const validImage = (image: unknown): image is ImageDocumentV1 => {
  if (!shape(image, ['id', 'revision', 'width', 'height', 'layers']) || !id(image.id) || !revision(image.revision) ||
      !dimension(image.width) || !dimension(image.height) || !Array.isArray(image.layers) || image.layers.length === 0) return false;
  const ids = new Set<string>();
  return Array.from(image.layers).every(layer => {
    if (!shape(layer, ['id', 'name', 'kind', 'visible', 'locked', 'opacity', 'blendMode', 'width', 'height', 'assetId'], ['sourceReference']) || !validReferenceLayer(layer) ||
        !id(layer.id) || ids.has(layer.id) || !text(layer.name) || !['image', 'paint'].includes(layer.kind as string) ||
        typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
        typeof layer.opacity !== 'number' || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 ||
        !['normal', 'multiply', 'screen'].includes(layer.blendMode as string) ||
        layer.width !== image.width || layer.height !== image.height ||
        typeof layer.assetId !== 'string' || !assetPattern.test(layer.assetId)) return false;
    ids.add(layer.id);
    return true;
  });
};
export const validProject = (project: unknown): project is ProjectV1 => {
  if (!shape(project, ['schema', 'version', 'id', 'revision', 'name', 'shots', 'parkedShots', 'dialogues', 'images'], ['naming','presentation']) ||
      project.schema !== 'storyboard-flow.project' || project.version !== 1 || !id(project.id) ||
      !revision(project.revision) || !text(project.name) || !Array.isArray(project.shots) ||
      !Array.isArray(project.parkedShots) || !Array.isArray(project.dialogues) || !record(project.images)) return false;
  if (own(project, 'naming') && (!shape(project.naming, ['sceneCode', 'artistName', 'version']) || !Object.values(project.naming).every(text))) return false;
  if (own(project,'presentation') && !validPresentation(project.presentation)) return false;
  const shotIds = new Set<string>();
  const imageIds = new Set<string>();
  for (const shot of [...project.shots, ...project.parkedShots]) {
    if (!shape(shot, ['id', 'imageId', 'name', 'scriptText'], ['presentation']) || (own(shot,'presentation') && !validPresentation(shot.presentation)) || !id(shot.id) || shotIds.has(shot.id) ||
        !id(shot.imageId) || imageIds.has(shot.imageId) || !text(shot.name) || !text(shot.scriptText)) return false;
    shotIds.add(shot.id);
    imageIds.add(shot.imageId);
  }
  for (const [key, image] of Object.entries(project.images)) {
    if (!id(key) || !validImage(image) || image.id !== key) return false;
  }
  if ([...imageIds].some(imageId => !own(project.images as Record<string, unknown>, imageId))) return false;
  const dialogueIds = new Set<string>();
  for (const dialogue of project.dialogues) {
    if (!shape(dialogue, ['id', 'shotId', 'text']) || !id(dialogue.id) || dialogueIds.has(dialogue.id) ||
        !id(dialogue.shotId) || !shotIds.has(dialogue.shotId) || !text(dialogue.text)) return false;
    dialogueIds.add(dialogue.id);
  }
  return true;
};
// Affected order means the shot's (active|pending, index) changed. Enumerate the
// resulting active order then Pending order, followed by removed IDs in old order.
export const positionChanges = (before: ProjectV1, after: ProjectV1): string[] => {
  const positions = (project: ProjectV1): Map<string, string> => new Map([
    ...project.shots.map((shot, index) => [shot.id, `active:${index}`] as const),
    ...project.parkedShots.map((shot, index) => [shot.id, `pending:${index}`] as const)
  ]);
  const old = positions(before), next = positions(after);
  return [...new Set([...next.keys(), ...old.keys()])].filter(shotId => old.get(shotId) !== next.get(shotId));
};
