import {validPresentation} from '../../shared/flowPresentation.js';
import type {
  BlendModeV1,
  DialogueV1,
  ImageDocumentV1,
  LayerV1,
  ProjectV1,
  ShotV1
} from '../../shared/refactorV1.js';
import { ProjectStoreError } from './errors.js';
import { LIMITS } from './limits.js';
import { isPlainObject } from './canonicalJson.js';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const ASSET_ID = /^[0-9a-f]{64}$/;
export const PROJECT_SCHEMA = 'storyboard-flow.project';
const BLEND_MODES: readonly BlendModeV1[] = ['normal', 'multiply', 'screen'];

// A declared function (not an arrow constant) so TypeScript narrows after calls
// that can only throw.
function invalid(message: string): never {
  throw new ProjectStoreError('invalid-input', message);
}

/** Requires exactly these own keys: a missing field is malformed, an unknown one
 * is unsupported structure. Unknown fields are refused rather than dropped, so a
 * read/edit/save path can never lose data it did not understand. */
const exactObject = (value: unknown, keys: readonly string[], what: string): Record<string, unknown> => {
  if (!isPlainObject(value)) return invalid(`${what} must be an object`);
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!keys.includes(key)) {
      throw new ProjectStoreError('invalid-input', `${what} has unsupported field "${key}"`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) invalid(`${what} is missing field "${key}"`);
  }
  return value;
};

const identifier = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !ID.test(value)) {
    return invalid(`${what} must be a nonempty ASCII [A-Za-z0-9_-] id of at most 80 characters`);
  }
  return value;
};

const revision = (value: unknown, what: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid(`${what} must be a nonnegative safe integer`);
  }
  return value as number;
};

const dimension = (value: unknown, what: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > LIMITS.dimension) {
    return invalid(`${what} must be an integer between 1 and ${LIMITS.dimension}`);
  }
  return value as number;
};

const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string') return invalid(`${what} must be a string`);
  if (value.length > LIMITS.textLength) return invalid(`${what} exceeds ${LIMITS.textLength} characters`);
  return value;
};

const flag = (value: unknown, what: string): boolean => {
  if (typeof value !== 'boolean') return invalid(`${what} must be a boolean`);
  return value;
};

const assetId = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !ASSET_ID.test(value)) {
    return invalid(`${what} must be a lowercase 64-character SHA-256 hex asset id`);
  }
  return value;
};

const array = <T>(value: unknown, what: string, maximum: number, convert: (entry: unknown, index: number) => T): T[] => {
  if (!Array.isArray(value)) return invalid(`${what} must be an array`);
  if (value.length > maximum) return invalid(`${what} exceeds ${maximum} entries`);
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) result.push(convert(value[index], index));
  return result;
};

const unique = (ids: string[], what: string): void => {
  if (new Set(ids).size !== ids.length) invalid(`${what} must have unique ids`);
};

const validateLayer = (value: unknown, index: number, image: { id: string; width: number; height: number }): LayerV1 => {
  const what = `project.images.${image.id}.layers[${index}]`;
  const layer = exactObject(value, ['id', 'name', 'kind', 'visible', 'locked', 'opacity', 'blendMode', 'width', 'height', 'assetId'], what);
  const kind = layer.kind;
  if (kind !== 'image' && kind !== 'paint') invalid(`${what}.kind must be "image" or "paint"`);
  const opacity = layer.opacity;
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    invalid(`${what}.opacity must be a finite number between 0 and 1`);
  }
  const blendMode = layer.blendMode;
  if (typeof blendMode !== 'string' || !BLEND_MODES.includes(blendMode as BlendModeV1)) {
    invalid(`${what}.blendMode must be one of ${BLEND_MODES.join(', ')}`);
  }
  const width = dimension(layer.width, `${what}.width`);
  const height = dimension(layer.height, `${what}.height`);
  if (width !== image.width || height !== image.height) {
    invalid(`${what} is ${width}x${height} but its image is ${image.width}x${image.height}; wave-1 layers match the canvas`);
  }
  return {
    id: identifier(layer.id, `${what}.id`),
    name: text(layer.name, `${what}.name`),
    kind: kind as LayerV1['kind'],
    visible: flag(layer.visible, `${what}.visible`),
    locked: flag(layer.locked, `${what}.locked`),
    opacity: opacity as number,
    blendMode: blendMode as BlendModeV1,
    width,
    height,
    assetId: assetId(layer.assetId, `${what}.assetId`)
  };
};

const validateImage = (value: unknown, key: string): ImageDocumentV1 => {
  const image = exactObject(value, ['id', 'revision', 'width', 'height', 'layers'], `project.images.${key}`);
  const id = identifier(image.id, `project.images.${key}.id`);
  if (id !== key) invalid(`project.images key "${key}" does not match image id "${id}"`);
  const width = dimension(image.width, `project.images.${key}.width`);
  const height = dimension(image.height, `project.images.${key}.height`);
  if (!Array.isArray(image.layers)) invalid(`project.images.${key}.layers must be an array`);
  if (image.layers.length < 1) invalid(`project.images.${key}.layers must contain at least one layer`);
  if (image.layers.length > LIMITS.layersPerImage) {
    invalid(`project.images.${key}.layers exceeds ${LIMITS.layersPerImage} entries`);
  }
  const layers = image.layers.map((entry, index) => validateLayer(entry, index, { id, width, height }));
  unique(layers.map((layer) => layer.id), `project.images.${key}.layers`);
  return { id, revision: revision(image.revision, `project.images.${key}.revision`), width, height, layers };
};

const validateShot = (value: unknown, what: string): ShotV1 => {
  const shot = exactObject(value, ['id', 'imageId', 'name', 'scriptText', ...(isPlainObject(value)&&Object.hasOwn(value,'presentation')?['presentation']:[])], what);
  if(Object.hasOwn(shot,'presentation')&&!validPresentation(shot.presentation))invalid('Invalid shot presentation');
  return {
    id: identifier(shot.id, `${what}.id`),
    imageId: identifier(shot.imageId, `${what}.imageId`),
    name: text(shot.name, `${what}.name`),
    ...(shot.presentation?{presentation:shot.presentation as ShotV1['presentation']} : {}),
    scriptText: text(shot.scriptText, `${what}.scriptText`)
  };
};

const validateDialogue = (value: unknown, index: number): DialogueV1 => {
  const what = `project.dialogues[${index}]`;
  const dialogue = exactObject(value, ['id', 'shotId', 'text'], what);
  return {
    id: identifier(dialogue.id, `${what}.id`),
    shotId: identifier(dialogue.shotId, `${what}.shotId`),
    text: text(dialogue.text, `${what}.text`)
  };
};

/**
 * Validate an untrusted value as ProjectV1 and return it unchanged.
 *
 * Throws ProjectStoreError with `invalid-input` for malformed structure or values
 * and `unsupported-version` for a recognisable document of another schema or
 * version. Nothing is normalized, defaulted or repaired: text keeps its exact
 * Unicode code units and unknown fields are refused instead of dropped.
 */
export const validateProject = (value: unknown): ProjectV1 => {
  if (!isPlainObject(value)) {
    if (Array.isArray(value) || typeof value !== 'object' || value === null) return invalid('project must be a JSON object');
  }
  const project = value as Record<string, unknown>;
  if (Object.hasOwn(project, 'schema') && typeof project.schema === 'string' && project.schema !== PROJECT_SCHEMA) {
    throw new ProjectStoreError('unsupported-version', `Unsupported project schema "${project.schema}"`);
  }
  if (Object.hasOwn(project, 'version') && typeof project.version === 'number' && project.version !== 1) {
    throw new ProjectStoreError('unsupported-version', `Unsupported project version ${project.version}`);
  }
  exactObject(project, ['schema', 'version', 'id', 'revision', 'name', 'shots', 'parkedShots', 'dialogues', 'images', ...(Object.hasOwn(project, 'naming') ? ['naming'] : []), ...(Object.hasOwn(project,'presentation')?['presentation']:[])], 'project');
  if (project.schema !== PROJECT_SCHEMA) invalid('project.schema must be "storyboard-flow.project"');
  if (project.version !== 1) invalid('project.version must be the number 1');

  const id = identifier(project.id, 'project.id');
  const projectRevision = revision(project.revision, 'project.revision');
  const name = text(project.name, 'project.name');
  let naming: ProjectV1['naming'];
  if (Object.hasOwn(project, 'naming')) {
    const fields = exactObject(project.naming, ['sceneCode', 'artistName', 'version'], 'project.naming');
    naming = { sceneCode: text(fields.sceneCode, 'sceneCode'), artistName: text(fields.artistName, 'artistName'), version: text(fields.version, 'version') };
  }

  if(Object.hasOwn(project,'presentation')&&!validPresentation(project.presentation))invalid('Invalid project presentation');
  const shots = array(project.shots, 'project.shots', LIMITS.shots, (entry, index) => validateShot(entry, `project.shots[${index}]`));
  const parkedShots = array(project.parkedShots, 'project.parkedShots', LIMITS.shots, (entry, index) =>
    validateShot(entry, `project.parkedShots[${index}]`));
  if (shots.length + parkedShots.length > LIMITS.shots) invalid(`project has more than ${LIMITS.shots} shots`);
  unique([...shots, ...parkedShots].map((shot) => shot.id), 'project shots and parkedShots');

  if (!isPlainObject(project.images)) invalid('project.images must be an object');
  const imageRecord: Record<string, unknown> = project.images;
  const imageKeys = Object.keys(imageRecord);
  if (imageKeys.length > LIMITS.images) invalid(`project.images exceeds ${LIMITS.images} entries`);
  // Object.fromEntries defines own data properties, so an id like `__proto__`
  // stays an ordinary image entry instead of replacing the record's prototype.
  const images: Record<string, ImageDocumentV1> = Object.fromEntries(
    imageKeys.map((key) => [key, validateImage(imageRecord[key], key)])
  );

  // Each shot references exactly one existing image, and wave 1 does not let two
  // shots share one editable image; an image no shot owns is a retained image and
  // stays legal.
  const owners = new Map<string, string>();
  for (const shot of [...shots, ...parkedShots]) {
    if (!Object.hasOwn(images, shot.imageId)) invalid(`shot "${shot.id}" references unknown image "${shot.imageId}"`);
    const owner = owners.get(shot.imageId);
    if (owner !== undefined) {
      invalid(`shots "${owner}" and "${shot.id}" share editable image "${shot.imageId}"; wave 1 does not share one image between shots`);
    }
    owners.set(shot.imageId, shot.id);
  }

  const dialogues = array(project.dialogues, 'project.dialogues', LIMITS.dialogues, (entry, index) => validateDialogue(entry, index));
  unique(dialogues.map((dialogue) => dialogue.id), 'project.dialogues');
  const shotIds = new Set([...shots, ...parkedShots].map((shot) => shot.id));
  for (const dialogue of dialogues) {
    if (!shotIds.has(dialogue.shotId)) invalid(`dialogue "${dialogue.id}" references unknown shot "${dialogue.shotId}"`);
  }

  return { schema: PROJECT_SCHEMA, version: 1, id, revision: projectRevision, name, ...(naming ? { naming } : {}), ...(project.presentation?{presentation:project.presentation as ProjectV1['presentation']} : {}), shots, parkedShots, dialogues, images };
};

/** Copy a caller-owned project so later mutation cannot change what a save
 * acknowledges. Runs before the first await in saveCheckpoint. */
export const snapshotProject = (value: unknown): ProjectV1 => {
  let copy: unknown;
  try {
    copy = structuredClone(value);
  } catch (error) {
    throw new ProjectStoreError('invalid-input', `Project could not be copied: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateProject(copy);
};
