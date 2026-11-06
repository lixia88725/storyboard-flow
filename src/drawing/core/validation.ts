import { validReferenceLayer } from '../../platform/contracts/flowSourceReference';
/**
 * Runtime validation for the image-document edit Interface.
 *
 * CONTRACTS.md requires validating runtime values, not only TypeScript types: `applyImageEdit`
 * is reachable from IPC, scripted checks and tests, where a cast can smuggle any value past the
 * compiler. Every helper here returns a `CoreFailureV1` (or `undefined` when the value is valid)
 * so the caller can report one deterministic, field-named failure instead of throwing.
 *
 * These helpers are private to `src/core/drawing`. Callers use `applyImageEdit` only.
 */
import type {
  AssetIdV1,
  BlendModeV1,
  CoreErrorCodeV1,
  CoreFailureV1,
  ImageDocumentV1,
  LayerV1
} from "../../platform/contracts/refactorV1";

/** CONTRACTS.md: all IDs are nonempty ASCII `[A-Za-z0-9_-]{1,80}`, asset IDs are lowercase SHA-256 hex. */
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const assetIdPattern = /^[0-9a-f]{64}$/;

const layerKinds: readonly LayerV1["kind"][] = ["image", "paint"];
/** Mirrors projectOps.bitmapBlendModes and the shared `BlendModeV1` union. */
const blendModes: readonly BlendModeV1[] = ["normal", "multiply", "screen"];

const layerKeys: readonly string[] = [
  "id",
  "name",
  "kind",
  "visible",
  "locked",
  "opacity",
  "blendMode",
  "width",
  "height",
  "assetId",
  "sourceReference"
];
const documentKeys: readonly string[] = ["id", "revision", "width", "height", "layers"];
const patchKeys: readonly string[] = ["name", "visible", "locked", "opacity", "blendMode"];

const editKeys: Readonly<Record<string, readonly string[]>> = {
  insertLayer: ["kind", "layer", "index"],
  removeLayer: ["kind", "layerId"],
  setLayerOpacities: ["kind", "changes"],
  moveLayer: ["kind", "layerId", "index"],
  moveLayers: ["kind", "layerIds", "targetLayerId", "placement"],
  setLayer: ["kind", "layerId", "patch"],
  replacePixels: ["kind", "layerId", "assetId"]
};

export const fail = (code: CoreErrorCodeV1, message: string): CoreFailureV1 => ({ code, message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isLayerId = (value: unknown): value is string =>
  typeof value === "string" && idPattern.test(value);

export const isAssetId = (value: unknown): value is AssetIdV1 =>
  typeof value === "string" && assetIdPattern.test(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isOpacity = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isBlendMode = (value: unknown): value is BlendModeV1 =>
  typeof value === "string" && (blendModes as readonly string[]).includes(value);

const unexpectedKeys = (value: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(value).filter((key) => !allowed.includes(key));

/**
 * CONTRACTS.md: unsupported fields must not be silently lost. Inserting a layer whose object
 * carries unknown fields would drop them on the cloned result, so the structure is rejected
 * rather than normalized.
 */
const checkKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string
): CoreFailureV1 | undefined => {
  const extra = unexpectedKeys(value, allowed);
  if (extra.length === 0) {
    return undefined;
  }

  return fail("invalid-input", `${where} has unsupported field(s): ${extra.join(", ")}`);
};

const checkLayerFields = (
  value: Record<string, unknown>,
  where: string
): CoreFailureV1 | undefined => {
  if (!validReferenceLayer(value)) return fail("invalid-input", `${where}: invalid protected source reference`);
  const keyFailure = checkKeys(value, layerKeys, where);
  if (keyFailure) {
    return keyFailure;
  }

  if (!isLayerId(value.id)) {
    return fail("invalid-input", `${where}.id must match [A-Za-z0-9_-]{1,80}`);
  }

  if (typeof value.name !== "string") {
    return fail("invalid-input", `${where}.name must be a string`);
  }

  if (!layerKinds.includes(value.kind as LayerV1["kind"])) {
    return fail("invalid-input", `${where}.kind must be "image" or "paint"`);
  }

  if (!isBoolean(value.visible)) {
    return fail("invalid-input", `${where}.visible must be a boolean`);
  }

  if (!isBoolean(value.locked)) {
    return fail("invalid-input", `${where}.locked must be a boolean`);
  }

  if (!isOpacity(value.opacity)) {
    return fail("invalid-input", `${where}.opacity must be a finite number within [0,1]`);
  }

  if (!isBlendMode(value.blendMode)) {
    return fail("invalid-input", `${where}.blendMode must be normal, multiply or screen`);
  }

  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    return fail("invalid-input", `${where} width/height must be positive integers`);
  }

  if (!isAssetId(value.assetId)) {
    return fail("invalid-input", `${where}.assetId must be 64 lowercase hex characters`);
  }

  return undefined;
};

/**
 * Validates a whole `ImageDocumentV1`. Waves 1 layers match the canvas size, layers are unique by
 * id, ordered bottom-to-top, and at least one layer remains.
 */
export const validateImageDocument = (value: unknown): CoreFailureV1 | undefined => {
  if (!isRecord(value)) {
    return fail("invalid-input", "image must be an object");
  }

  const keyFailure = checkKeys(value, documentKeys, "image");
  if (keyFailure) {
    return keyFailure;
  }

  if (!isLayerId(value.id)) {
    return fail("invalid-input", "image.id must match [A-Za-z0-9_-]{1,80}");
  }

  if (!isNonNegativeInteger(value.revision)) {
    return fail("invalid-input", "image.revision must be a nonnegative safe integer");
  }

  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    return fail("invalid-input", "image width/height must be positive integers");
  }

  if (!Array.isArray(value.layers)) {
    return fail("invalid-input", "image.layers must be an array");
  }

  if (value.layers.length === 0) {
    return fail("invalid-input", "image.layers must contain at least one layer");
  }

  const seen = new Set<string>();
  for (let index = 0; index < value.layers.length; index += 1) {
    const where = `image.layers[${index}]`;
    const layer: unknown = value.layers[index];
    if (!isRecord(layer)) {
      return fail("invalid-input", `${where} must be an object`);
    }

    const layerFailure = checkLayerFields(layer, where);
    if (layerFailure) {
      return layerFailure;
    }

    const id = layer.id as string;
    if (seen.has(id)) {
      return fail("invalid-input", `${where}.id duplicates layer id "${id}"`);
    }

    seen.add(id);

    // Wave 1: layer dimensions match the canvas size.
    if (layer.width !== value.width || layer.height !== value.height) {
      return fail(
        "invalid-input",
        `${where} must match the image size ${String(value.width)}x${String(value.height)}`
      );
    }
  }

  return undefined;
};

/** Validates the property patch of a `setLayer` edit (values only; lock policy lives in index.ts). */
export const validateLayerPatch = (value: unknown): CoreFailureV1 | undefined => {
  if (!isRecord(value)) {
    return fail("invalid-input", "setLayer.patch must be an object");
  }

  const keyFailure = checkKeys(value, patchKeys, "setLayer.patch");
  if (keyFailure) {
    return keyFailure;
  }

  if ("name" in value && typeof value.name !== "string") {
    return fail("invalid-input", "setLayer.patch.name must be a string");
  }

  if ("visible" in value && !isBoolean(value.visible)) {
    return fail("invalid-input", "setLayer.patch.visible must be a boolean");
  }

  if ("locked" in value && !isBoolean(value.locked)) {
    return fail("invalid-input", "setLayer.patch.locked must be a boolean");
  }

  if ("opacity" in value && !isOpacity(value.opacity)) {
    return fail("invalid-input", "setLayer.patch.opacity must be a finite number within [0,1]");
  }

  if ("blendMode" in value && !isBlendMode(value.blendMode)) {
    return fail("invalid-input", "setLayer.patch.blendMode must be normal, multiply or screen");
  }

  return undefined;
};

/**
 * Shape validation for an `ImageEditV1`: known kind, known fields, usable value types.
 * Target existence, ordering bounds, lock policy and no-op detection belong to index.ts because
 * they depend on the supplied image.
 */
export const validateEdit = (value: unknown): CoreFailureV1 | undefined => {
  if (!isRecord(value)) {
    return fail("invalid-input", "edit must be an object");
  }

  const kind = value.kind;
  // Own keys only: `kind in editKeys` would also accept inherited names such as "constructor",
  // "toString" or "__proto__", whose values are not key lists. Those must be invalid-input.
  if (typeof kind !== "string" || !Object.hasOwn(editKeys, kind)) {
    return fail("invalid-input", "edit.kind must be insertLayer, removeLayer, moveLayer, moveLayers, setLayerOpacities, setLayer or replacePixels");
  }

  const keyFailure = checkKeys(value, editKeys[kind]!, `edit(${kind})`);
  if (keyFailure) {
    return keyFailure;
  }

  switch (kind) {
    case "setLayerOpacities": {
      const changes=value.changes;
      return Array.isArray(changes) && changes.length>0 && Array.from(changes).every(c =>
        isRecord(c) && !checkKeys(c,['layerId','before','opacity'],'opacity change') && isLayerId(c.layerId) &&
        typeof c.before==='number' && Number.isFinite(c.before) && c.before>=0 && c.before<=1 &&
        typeof c.opacity==='number' && Number.isFinite(c.opacity) && c.opacity>=0 && c.opacity<=1) &&
        new Set(changes.map(c=>c.layerId)).size===changes.length
        ? undefined : fail('invalid-input','Invalid layer opacity changes');
    }
    case "insertLayer": {
      const layer: unknown = value.layer;
      if (!isRecord(layer)) {
        return fail("invalid-input", "insertLayer.layer must be an object");
      }

      const layerFailure = checkLayerFields(layer, "insertLayer.layer");
      if (layerFailure) {
        return layerFailure;
      }

      return isNonNegativeInteger(value.index)
        ? undefined
        : fail("invalid-input", "insertLayer.index must be a nonnegative integer");
    }
    case "removeLayer": {
      return isLayerId(value.layerId)
        ? undefined
        : fail("invalid-input", "removeLayer.layerId must match [A-Za-z0-9_-]{1,80}");
    }
    case "moveLayers": {
      return Array.isArray(value.layerIds) && value.layerIds.length > 0 &&
        Array.from(value.layerIds).every(isLayerId) && new Set(value.layerIds).size === value.layerIds.length &&
        isLayerId(value.targetLayerId) && ['before','after'].includes(value.placement as string)
        ? undefined : fail('invalid-input', 'Invalid layer group move');
    }
    case "moveLayer": {
      if (!isLayerId(value.layerId)) {
        return fail("invalid-input", "moveLayer.layerId must match [A-Za-z0-9_-]{1,80}");
      }

      return isNonNegativeInteger(value.index)
        ? undefined
        : fail("invalid-input", "moveLayer.index must be a nonnegative integer");
    }
    case "setLayer": {
      if (!isLayerId(value.layerId)) {
        return fail("invalid-input", "setLayer.layerId must match [A-Za-z0-9_-]{1,80}");
      }

      return validateLayerPatch(value.patch);
    }
    default: {
      // replacePixels
      if (!isLayerId(value.layerId)) {
        return fail("invalid-input", "replacePixels.layerId must match [A-Za-z0-9_-]{1,80}");
      }

      return isAssetId(value.assetId)
        ? undefined
        : fail("invalid-input", "replacePixels.assetId must be 64 lowercase hex characters");
    }
  }
};

/** Wave-1 layer dimensions must match the canvas; returns the mismatch as invalid-input. */
export const checkInsertLayerSize = (
  document: ImageDocumentV1,
  layer: LayerV1
): CoreFailureV1 | undefined =>
  layer.width === document.width && layer.height === document.height
    ? undefined
    : fail(
        "invalid-input",
        `insertLayer.layer must match the image size ${String(document.width)}x${String(document.height)}`
      );
