import type { LayerIpcHandlers } from "./ipc/layerHandlers.js";
import { cleanupMergedLayerSources, type MergeCleanupPayload } from "./mergeSourceCleanup.js";
import {
  createLayerPng,
  type CreateLayerAssetPayload,
  copyLayerPng,
  deleteLayerPng,
  mergeLayerDown,
  mergeVisibleLayers,
  readLayerPng,
  writeLayerPng,
  type CopyLayerPngPayload,
  type LayerAssetPayload,
  type MergeLayerDownPayload,
  type MergeVisibleLayersPayload,
  type WriteLayerAssetPayload
} from "./layerAssetService.js";

export type LayerAppRuntimeOptions = {
  createLayerPng?: typeof createLayerPng;
  copyLayerPng?: typeof copyLayerPng;
  deleteLayerPng?: typeof deleteLayerPng;
  mergeLayerDown?: typeof mergeLayerDown;
  mergeVisibleLayers?: typeof mergeVisibleLayers;
  readLayerPng?: typeof readLayerPng;
  writeLayerPng?: typeof writeLayerPng;
};

export const createLayerAppHandlers = ({
  createLayerPng: createLayerPngDependency = createLayerPng,
  copyLayerPng: copyLayerPngDependency = copyLayerPng,
  deleteLayerPng: deleteLayerPngDependency = deleteLayerPng,
  mergeLayerDown: mergeLayerDownDependency = mergeLayerDown,
  mergeVisibleLayers: mergeVisibleLayersDependency = mergeVisibleLayers,
  readLayerPng: readLayerPngDependency = readLayerPng,
  writeLayerPng: writeLayerPngDependency = writeLayerPng
}: LayerAppRuntimeOptions = {}): LayerIpcHandlers => ({
  cleanupMergeSources: payload => cleanupMergedLayerSources(payload as MergeCleanupPayload),
  createPng: (payload) => createLayerPngDependency(payload as CreateLayerAssetPayload),
  writePng: (payload) => writeLayerPngDependency(payload as WriteLayerAssetPayload),
  readPng: (payload) => readLayerPngDependency(payload as LayerAssetPayload),
  deletePng: (payload) => deleteLayerPngDependency(payload as LayerAssetPayload),
  copyPng: (payload) => copyLayerPngDependency(payload as CopyLayerPngPayload),
  mergeDown: (payload) => mergeLayerDownDependency(payload as MergeLayerDownPayload),
  // A new-target IPC merge can be rejected after ACK by a P2 dependency
  // conflict. Retain its inputs for Undo/inspection. Existing in-place selected
  // merges and the low-level explicit deletion/drain primitive stay unchanged.
  mergeVisible: (payload) => {
    const merge = payload as MergeVisibleLayersPayload;
    const inPlace = merge.layers?.some(layer => layer.bitmapPath === merge.targetBitmapPath);
    return mergeVisibleLayersDependency(inPlace ? merge : { ...merge, deleteBitmapPaths: [] });
  }
});
