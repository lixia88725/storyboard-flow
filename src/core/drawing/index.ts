/**
 * Drawing wave 1 — the standalone image-document editing Interface.
 *
 * `applyImageEdit(image, edit)` is the single public entry point. It is pure: no React, Electron,
 * DOM, filesystem, sharp, IPC or storyboard-project access, so the same code can run in the
 * renderer, the main process or a plain node test. Pixel behavior is NOT implemented here; a
 * `replacePixels` edit adopts an immutable asset reference chosen by the caller (see
 * docs/refactor/CONTRACTS.md and EXTRACTION.md).
 *
 * Ownership contract (documented for callers, enforced by tests):
 * - the supplied `image` is never mutated; the returned `before` is that exact object;
 * - an actual edit returns a fully cloned document (document, layer array and every layer object),
 *   so mutating the result can never corrupt the caller's document;
 * - a no-op or failure returns the supplied document as `after`/`before` and adds no revision.
 */
import type {
  ImageDocumentV1,
  ImageEditResultV1,
  ImageEditV1,
  LayerV1,
  ResultV1
} from "../../../electron/shared/refactorV1";
import {
  checkInsertLayerSize,
  fail,
  validateEdit,
  validateImageDocument
} from "./validation";

const changedResult = (
  before: ImageDocumentV1,
  layers: LayerV1[],
  visualChanged: boolean
): ImageEditResultV1 => ({
  before,
  after: {
    id: before.id,
    // A changed image edit increments the image revision exactly once.
    revision: before.revision + 1,
    width: before.width,
    height: before.height,
    layers: layers.map((layer) => ({ ...layer }))
  },
  changed: true,
  visualChanged
});

/**
 * Publishes an actual change. The revision-overflow refusal lives here, not before the edit is
 * analysed: at Number.MAX_SAFE_INTEGER a no-op still needs no increment, while a real change cannot
 * advance into an unsafe integer (CONTRACTS.md: revisions are nonnegative safe integers).
 */
const commitEdit = (
  before: ImageDocumentV1,
  layers: LayerV1[],
  visualChanged: boolean
): ResultV1<ImageEditResultV1> =>
  before.revision >= Number.MAX_SAFE_INTEGER
    ? {
        ok: false,
        error: fail(
          "invalid-input",
          "image.revision cannot advance beyond Number.MAX_SAFE_INTEGER"
        )
      }
    : { ok: true, value: changedResult(before, layers, visualChanged) };

const noOpResult = (image: ImageDocumentV1): ImageEditResultV1 => ({
  before: image,
  after: image,
  changed: false,
  visualChanged: false
});

const layerIndexOrNotFound = (
  image: ImageDocumentV1,
  layerId: string
): ResultV1<number> => {
  const index = image.layers.findIndex((layer) => layer.id === layerId);
  return index === -1
    ? { ok: false, error: fail("not-found", `image has no layer with id "${layerId}"`) }
    : { ok: true, value: index };
};

const lockedFailure = (layerId: string, action: string) => ({
  ok: false as const,
  error: fail("locked", `layer "${layerId}" is locked; unlock it before ${action}`)
});

/**
 * Applies one structural, property or pixel-reference edit to an image document.
 * Invalid runtime input returns `invalid-input`, unknown layer targets `not-found`, and a locked
 * layer refuses pixel replacement, removal and reordering (`locked`). See CONTRACTS.md.
 */
export const applyImageEdit = (
  image: ImageDocumentV1,
  edit: ImageEditV1
): ResultV1<ImageEditResultV1> => {
  const inputFailure = validateImageDocument(image) ?? validateEdit(edit);
  if (inputFailure) {
    return { ok: false, error: inputFailure };
  }

  switch (edit.kind) {
    case "setLayerOpacities": {
      const changes=new Map(edit.changes.map(change=>[change.layerId,change]));
      for(const change of edit.changes){
        const layer=image.layers.find(layer=>layer.id===change.layerId);
        if(!layer)return {ok:false,error:fail('not-found','Opacity layer no longer exists')};
        if(layer.opacity!==change.before)return {ok:false,error:fail('conflict','Opacity changed during gesture')};
        if(layer.locked && layer.opacity!==change.opacity)return lockedFailure(layer.id,'changing its opacity');
      }
      if(edit.changes.every(change=>change.before===change.opacity))return {ok:true,value:noOpResult(image)};
      return commitEdit(image,image.layers.map(layer=>changes.has(layer.id)?{...layer,opacity:changes.get(layer.id)!.opacity}:layer),true);
    }
    case "insertLayer": {
      const sizeFailure = checkInsertLayerSize(image, edit.layer);
      if (sizeFailure) {
        return { ok: false, error: sizeFailure };
      }

      if (image.layers.some((layer) => layer.id === edit.layer.id)) {
        return {
          ok: false,
          error: fail("invalid-input", `image already has a layer with id "${edit.layer.id}"`)
        };
      }

      const insertIndex = edit.index;
      if (insertIndex > image.layers.length) {
        return {
          ok: false,
          error: fail(
            "invalid-input",
            `insertLayer.index ${String(insertIndex)} is outside 0..${String(image.layers.length)}`
          )
        };
      }

      const layers = [
        ...image.layers.slice(0, insertIndex),
        edit.layer,
        ...image.layers.slice(insertIndex)
      ];
      // Insertion changes the stack, so the rendered composition is invalidated even for a
      // hidden layer (CONTRACTS.md: insertion is a visual change).
      return commitEdit(image, layers, true);
    }

    case "removeLayer": {
      const indexResult = layerIndexOrNotFound(image, edit.layerId);
      if (!indexResult.ok) {
        return indexResult;
      }

      // Structural refusal first: no unlock can make removing the final layer valid.
      if (image.layers.length <= 1) {
        return {
          ok: false,
          error: fail("invalid-input", "image must keep at least one layer")
        };
      }

      const target = image.layers[indexResult.value]!;
      if (target.locked) {
        return lockedFailure(target.id, "removing it");
      }

      const layers = image.layers.filter((_, index) => index !== indexResult.value);
      return commitEdit(image, layers, true);
    }

    case "moveLayers": {
      const selected = new Set(edit.layerIds);
      if (edit.layerIds.some(id => !image.layers.some(layer => layer.id === id)) || !image.layers.some(layer => layer.id === edit.targetLayerId))
        return { ok: false, error: fail('not-found', 'Layer move target no longer exists') };
      const moving = image.layers.filter(layer => selected.has(layer.id));
      if (selected.has(edit.targetLayerId)) return { ok: true, value: noOpResult(image) };
      const locked = moving.find(layer => layer.locked);
      if (locked) return lockedFailure(locked.id, 'reordering it');
      const remaining = image.layers.filter(layer => !selected.has(layer.id));
      const index = remaining.findIndex(layer => layer.id === edit.targetLayerId) + (edit.placement === 'after' ? 1 : 0);
      const layers = [...remaining.slice(0,index), ...moving, ...remaining.slice(index)];
      return layers.every((layer,index) => layer.id === image.layers[index].id)
        ? { ok: true, value: noOpResult(image) } : commitEdit(image,layers,true);
    }
    case "moveLayer": {
      const indexResult = layerIndexOrNotFound(image, edit.layerId);
      if (!indexResult.ok) {
        return indexResult;
      }

      const currentIndex = indexResult.value;
      const target = image.layers[currentIndex]!;
      // Index is the final array index after removal, so the highest valid value is length - 1.
      const highestIndex = image.layers.length - 1;
      if (edit.index > highestIndex) {
        return {
          ok: false,
          error: fail(
            "invalid-input",
            `moveLayer.index ${String(edit.index)} is outside 0..${String(highestIndex)}`
          )
        };
      }

      const remaining = image.layers.filter((_, index) => index !== currentIndex);
      const layers = [
        ...remaining.slice(0, edit.index),
        target,
        ...remaining.slice(edit.index)
      ];

      if (layers.every((layer, index) => layer.id === image.layers[index]!.id)) {
        // Moving a layer to its current position is a no-op.
        return { ok: true, value: noOpResult(image) };
      }

      // Preserved legacy policy (LayerPanel drag gesture, projectOps.moveBitmapLayerGroup):
      // locked layers cannot be reordered by the user.
      if (target.locked) {
        return lockedFailure(target.id, "reordering it");
      }

      return commitEdit(image, layers, true);
    }

    case "setLayer": {
      const indexResult = layerIndexOrNotFound(image, edit.layerId);
      if (!indexResult.ok) {
        return indexResult;
      }

      const layer = image.layers[indexResult.value]!;
      const patch = edit.patch;
      const nameChanged = patch.name !== undefined && patch.name !== layer.name;
      const visibleChanged = patch.visible !== undefined && patch.visible !== layer.visible;
      const lockedChanged = patch.locked !== undefined && patch.locked !== layer.locked;
      const opacityChanged = patch.opacity !== undefined && patch.opacity !== layer.opacity;
      const blendModeChanged =
        patch.blendMode !== undefined && patch.blendMode !== layer.blendMode;

      if (
        !nameChanged &&
        !visibleChanged &&
        !lockedChanged &&
        !opacityChanged &&
        !blendModeChanged
      ) {
        // Values equal to the current ones are no-ops.
        return { ok: true, value: noOpResult(image) };
      }

      // Preserved legacy policy (projectOps.updateBitmapLayer): a locked layer rejects name,
      // opacity and blend-mode changes; visibility and the lock toggle stay editable. Lock state is
      // read from the input layer, so unlocking and renaming in one edit is refused: unlock first.
      if (layer.locked && (nameChanged || opacityChanged || blendModeChanged)) {
        return lockedFailure(layer.id, "changing its name, opacity or blend mode");
      }

      const layers = image.layers.map((current, index) =>
        index === indexResult.value
          ? {
              ...current,
              name: nameChanged ? (patch.name as string) : current.name,
              visible: visibleChanged ? (patch.visible as boolean) : current.visible,
              locked: lockedChanged ? (patch.locked as boolean) : current.locked,
              opacity: opacityChanged ? (patch.opacity as number) : current.opacity,
              blendMode: blendModeChanged ? (patch.blendMode as LayerV1["blendMode"]) : current.blendMode
            }
          : current
      );

      // Only compositing properties invalidate the rendered image; name/lock edits are metadata.
      return commitEdit(image, layers, visibleChanged || opacityChanged || blendModeChanged);
    }

    default: {
      // replacePixels
      const indexResult = layerIndexOrNotFound(image, edit.layerId);
      if (!indexResult.ok) {
        return indexResult;
      }

      const layer = image.layers[indexResult.value]!;
      if (layer.assetId === edit.assetId) {
        return { ok: true, value: noOpResult(image) };
      }

      if (layer.locked) {
        return lockedFailure(layer.id, "replacing its pixels");
      }

      const layers = image.layers.map((current, index) =>
        index === indexResult.value ? { ...current, assetId: edit.assetId } : current
      );
      return commitEdit(image, layers, true);
    }
  }
};
