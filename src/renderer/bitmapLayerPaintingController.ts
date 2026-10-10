import type { MutableRefObject } from "react";
import { bitmapLayersForShot, markBitmapLayerPainted } from "../shared/projectOps";
import type { BitmapLayer, Project, Shot, SketchStroke } from "../shared/types";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { LayerAssetSnapshot } from "./bitmapLayerHistory";
import type { CompletedEffect } from "./normalSaveProjectOwner";
import {
  createTransparentLayerDataUrl,
  drawStrokeOnBitmapLayer,
  fillBitmapLayerAtPoint,
  gaussianBlurBitmapLayer,
  normalizeGaussianBlurRadius,
  type BitmapBlurPoint
} from "./bitmapLayerCanvas";
import { canFillBitmapLayer } from "./activeTargets";

type StoryboardApi = Window["storyboard"];
type ProjectUpdate = Project | ((currentProject: Project) => Project);

export type BitmapLayerPaintingControllerOptions<HistoryEntry> = {
  api: StoryboardApi | undefined;
  captureWorkspace: () => () => boolean;
  projectRef: MutableRefObject<Project>;
  folderPath: string | undefined;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  createHistoryEntryFromLayerAssets: (layerAssets?: LayerAssetSnapshot[]) => HistoryEntry;
  // Original workspace/source bound while admitted, not a late callback reading current paths.
  captureEffectCompletion: () => CompletedEffect;
  recordUndoEntry: (entry: HistoryEntry) => void;
  markShotsDirty: (shotIds: string[]) => void;
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
  blurBitmapLayer?: typeof gaussianBlurBitmapLayer;
};

export const sourceDataUrlForBitmapLayer = async ({
  api,
  folderPath,
  shot,
  layer,
  createBlankLayerDataUrl = createTransparentLayerDataUrl,
  preloadedLayer
}: {
  api: StoryboardApi;
  folderPath: string;
  shot: Shot;
  layer: BitmapLayer;
  createBlankLayerDataUrl?: (width: number, height: number) => Promise<string>;
  preloadedLayer?: { loaded: true; dataUrl?: string };
}): Promise<string> => {
  const layerDataUrl = preloadedLayer
    ? preloadedLayer.dataUrl
    : await api.readLayerPng({ folderPath, bitmapPath: layer.bitmapPath });

  if (layerDataUrl) {
    return layerDataUrl;
  }

  if (layer.cleared || layer.kind !== "image") {
    return createBlankLayerDataUrl(layer.width, layer.height);
  }

  return api.assetUrl(shot.previewPath ?? shot.imagePath);
};

export const useBitmapLayerPaintingController = <HistoryEntry,>({
  api,
  captureWorkspace,
  projectRef,
  folderPath,
  bitmapLayerWriteQueueRef,
  createHistoryEntryFromLayerAssets,
  captureEffectCompletion,
  recordUndoEntry,
  markShotsDirty,
  updateProject,
  blurBitmapLayer = gaussianBlurBitmapLayer
}: BitmapLayerPaintingControllerOptions<HistoryEntry>) => {
  const enqueuePainting = (bitmapPath: string, effect: (scopedApi: StoryboardApi) => Promise<string | undefined>) => {
    const isCurrent = captureWorkspace();
    return bitmapLayerWriteQueueRef.current.enqueue(bitmapPath, async () => {
      if (!api || !isCurrent()) return;
      const scopedApi = { ...api, writeLayerPng: async (...args: Parameters<StoryboardApi["writeLayerPng"]>) => {
        if (!isCurrent()) throw new Error("Painting workspace changed before PNG write");
        const source = projectRef.current.shots.find(s => s.layers?.some(l => l.bitmapPath === args[0].bitmapPath));
        const layer = source?.layers?.find(l => l.bitmapPath === args[0].bitmapPath);
        const completion = captureEffectCompletion();
        if (!source || !layer) throw new Error("Painting effect source is not current");
        const { folderPath: writeFolder, bitmapPath: writePath } = args[0];
        const sourceId = source?.id, layerId = layer?.id;
        completion.prepareSinglePng?.({ ...args[0], shotId: sourceId!, layerId: layerId!,
          read: () => api.readLayerPng({ folderPath: writeFolder, bitmapPath: writePath }),
          update: p => markBitmapLayerPainted(p, sourceId!, layerId!) });
        let result;
        try { result = await api.writeLayerPng(...args); }
        catch (error) { completion.failed(error, [source!.id]); throw error; }
        if (!isCurrent()) {
          await completion(p => markBitmapLayerPainted(p, source!.id, layer!.id), [source!.id]);
          throw new Error("Painting workspace changed; PNG retained without stale publication");
        }
        return result;
      } };
      return effect(scopedApi);
    });
  };
  const handleBitmapBlur = async (
    shot: Shot,
    layerId: string,
    radius: number,
    selectionPoints?: readonly BitmapBlurPoint[]
  ) => {
    if (!api || !folderPath || normalizeGaussianBlurRadius(radius) === 0) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!canFillBitmapLayer(layer)) {
      return;
    }

    return enqueuePainting(layer.bitmapPath, async (api) => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!canFillBitmapLayer(currentLayer)) {
        return undefined;
      }

      const normalizedRadius = normalizeGaussianBlurRadius(radius);
      const previousDataUrl = await api.readLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath
      });
      const undoEntry = createHistoryEntryFromLayerAssets([
        { bitmapPath: currentLayer.bitmapPath, dataUrl: previousDataUrl }
      ]);
      const dataUrl = await blurBitmapLayer(
        await sourceDataUrlForBitmapLayer({
          api,
          folderPath,
          shot: currentShot,
          layer: currentLayer,
          preloadedLayer: { loaded: true, dataUrl: previousDataUrl }
        }),
        currentLayer,
        normalizedRadius,
        selectionPoints
      );

      await api.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  const handleBitmapStroke = async (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    _pendingStrokes: SketchStroke[] = []
  ) => {
    if (!api || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    return enqueuePainting(layer.bitmapPath, async (api) => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked) {
        return undefined;
      }

      const previousDataUrl = await api.readLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath
      });
      const undoEntry = createHistoryEntryFromLayerAssets([
        { bitmapPath: currentLayer.bitmapPath, dataUrl: previousDataUrl }
      ]);
      const dataUrl =
        renderedDataUrl ??
        (await drawStrokeOnBitmapLayer(
          await sourceDataUrlForBitmapLayer({
            api,
            folderPath,
            shot: currentShot,
            layer: currentLayer,
            preloadedLayer: { loaded: true, dataUrl: previousDataUrl }
          }),
          currentLayer,
          // The queue has already persisted earlier strokes into this source.
          // Pending strokes belong to the UI preview, not this incremental write.
          stroke
        ));

      await api.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  const handleBitmapSelectionTransform = async (shot: Shot, layerId: string, dataUrl: string) => {
    if (!api || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    return enqueuePainting(layer.bitmapPath, async (api) => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked) {
        return undefined;
      }

      const previousDataUrl = await api.readLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath
      });
      const undoEntry = createHistoryEntryFromLayerAssets([
        { bitmapPath: currentLayer.bitmapPath, dataUrl: previousDataUrl }
      ]);
      await api.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  const handleBitmapFill = async (
    shot: Shot,
    layerId: string,
    point: { x: number; y: number },
    color: string
  ) => {
    if (!api || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!canFillBitmapLayer(layer)) {
      return;
    }

    return enqueuePainting(layer.bitmapPath, async (api) => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!canFillBitmapLayer(currentLayer)) {
        return undefined;
      }

      const previousDataUrl = await api.readLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath
      });
      const undoEntry = createHistoryEntryFromLayerAssets([
        { bitmapPath: currentLayer.bitmapPath, dataUrl: previousDataUrl }
      ]);
      const dataUrl = await fillBitmapLayerAtPoint(
        await sourceDataUrlForBitmapLayer({
          api,
          folderPath,
          shot: currentShot,
          layer: currentLayer,
          preloadedLayer: { loaded: true, dataUrl: previousDataUrl }
        }),
        currentLayer,
        point,
        color
      );

      await api.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  return {
    handleBitmapBlur,
    handleBitmapFill,
    handleBitmapSelectionTransform,
    handleBitmapStroke
  };
};
