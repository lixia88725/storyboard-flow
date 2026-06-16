import type { LayerIpcHandlers } from "./ipc/layerHandlers.js";
import {
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
  copyLayerPng?: typeof copyLayerPng;
  deleteLayerPng?: typeof deleteLayerPng;
  mergeLayerDown?: typeof mergeLayerDown;
  mergeVisibleLayers?: typeof mergeVisibleLayers;
  readLayerPng?: typeof readLayerPng;
  writeLayerPng?: typeof writeLayerPng;
};

export const createLayerAppHandlers = ({
  copyLayerPng: copyLayerPngDependency = copyLayerPng,
  deleteLayerPng: deleteLayerPngDependency = deleteLayerPng,
  mergeLayerDown: mergeLayerDownDependency = mergeLayerDown,
  mergeVisibleLayers: mergeVisibleLayersDependency = mergeVisibleLayers,
  readLayerPng: readLayerPngDependency = readLayerPng,
  writeLayerPng: writeLayerPngDependency = writeLayerPng
}: LayerAppRuntimeOptions = {}): LayerIpcHandlers => ({
  writePng: (payload) => writeLayerPngDependency(payload as WriteLayerAssetPayload),
  readPng: (payload) => readLayerPngDependency(payload as LayerAssetPayload),
  deletePng: (payload) => deleteLayerPngDependency(payload as LayerAssetPayload),
  copyPng: (payload) => copyLayerPngDependency(payload as CopyLayerPngPayload),
  mergeDown: (payload) => mergeLayerDownDependency(payload as MergeLayerDownPayload),
  mergeVisible: (payload) => mergeVisibleLayersDependency(payload as MergeVisibleLayersPayload)
});
