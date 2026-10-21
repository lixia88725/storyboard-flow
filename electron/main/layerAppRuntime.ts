import type { LayerIpcHandlers } from "./ipc/layerHandlers.js";
import { withLayerFileOperation, layerFileOperationCommitted } from "./layerFileOperationQueue.js";
import { withControlledMemory, type ControlledMemoryBudget } from "./controlledMemory.js";

const runLayerOperation = <T>(operation: () => Promise<T>): Promise<T> => withLayerFileOperation(async () => {
  try { return await operation(); }
  catch (error) {
    if (layerFileOperationCommitted()) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[PNG_COMMITTED] Layer files changed before this operation failed: ${message}`, { cause: error });
    }
    throw error;
  }
});
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
  prepareLayerPngWrite,
  type CopyLayerPngPayload,
  type LayerAssetPayload,
  type MergeLayerDownPayload,
  type MergeVisibleLayersPayload,
  type WriteLayerAssetPayload
} from "./layerAssetService.js";

export type LayerAppRuntimeOptions = {
  memoryBudget?: ControlledMemoryBudget;
  createLayerPng?: typeof createLayerPng;
  copyLayerPng?: typeof copyLayerPng;
  deleteLayerPng?: typeof deleteLayerPng;
  mergeLayerDown?: typeof mergeLayerDown;
  mergeVisibleLayers?: typeof mergeVisibleLayers;
  readLayerPng?: typeof readLayerPng;
  writeLayerPng?: typeof writeLayerPng;
};

export const createLayerAppHandlers = ({
  memoryBudget,
  createLayerPng: createLayerPngDependency = createLayerPng,
  copyLayerPng: copyLayerPngDependency = copyLayerPng,
  deleteLayerPng: deleteLayerPngDependency = deleteLayerPng,
  mergeLayerDown: mergeLayerDownDependency = mergeLayerDown,
  mergeVisibleLayers: mergeVisibleLayersDependency = mergeVisibleLayers,
  readLayerPng: readLayerPngDependency = readLayerPng,
  writeLayerPng: writeLayerPngDependency = writeLayerPng
}: LayerAppRuntimeOptions = {}): LayerIpcHandlers => {
  // Refuse before any layer-file effect when Main cannot fund the operation or the
  // live system is already near its measured limit. Once admitted, the original
  // closure and the single layer-file queue run unchanged.
  const governed = <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return withControlledMemory(memoryBudget, () => {
        memoryBudget?.checkPressure();
        return operation();
      });
    } catch (error) {
      // A synchronous admission refusal still reaches IPC as a rejected promise,
      // exactly like the asynchronous refusals below.
      return Promise.reject(error);
    }
  };
  return {
    cleanupMergeSources: payload => governed(() => runLayerOperation(() => cleanupMergedLayerSources(payload as MergeCleanupPayload))),
    createPng: payload => governed(() => runLayerOperation(() => createLayerPngDependency(payload as CreateLayerAssetPayload))),
    writePng: payload => governed(() => {
      // Production parses once, before starting a layer operation. The closure
      // still executes in the original queue and protected native writer.
      // Explicitly injected implementations keep their own interface semantics.
      const operation = writeLayerPngDependency === writeLayerPng
        ? prepareLayerPngWrite(payload as WriteLayerAssetPayload)
        : () => writeLayerPngDependency(payload as WriteLayerAssetPayload);
      return runLayerOperation(operation);
    }),
    readPng: payload => governed(() => runLayerOperation(() => readLayerPngDependency(payload as LayerAssetPayload))),
    deletePng: payload => governed(() => runLayerOperation(() => deleteLayerPngDependency(payload as LayerAssetPayload))),
    copyPng: payload => governed(() => runLayerOperation(() => copyLayerPngDependency(payload as CopyLayerPngPayload))),
    mergeDown: payload => governed(() => runLayerOperation(() => mergeLayerDownDependency(payload as MergeLayerDownPayload))),
    // A new-target IPC merge can be rejected after ACK by a P2 dependency
    // conflict. Retain its inputs for Undo/inspection. Existing in-place selected
    // merges and the low-level explicit deletion/drain primitive stay unchanged.
    mergeVisible: payload => governed(() => runLayerOperation(async () => {
      const merge = payload as MergeVisibleLayersPayload;
      const inPlace = merge.layers?.some(layer => layer.bitmapPath === merge.targetBitmapPath);
      return mergeVisibleLayersDependency(inPlace ? merge : { ...merge, deleteBitmapPaths: [] });
    }))
  };
};
