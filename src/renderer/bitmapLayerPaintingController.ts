import type { MutableRefObject } from "react";
import { bitmapLayersForShot, markBitmapLayerPainted } from "../shared/projectOps";
import type { BitmapLayer, Project, Shot, SketchStroke } from "../shared/types";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  createTransparentLayerDataUrl,
  drawStrokeOnBitmapLayer,
  fillBitmapLayerAtPoint
} from "./bitmapLayerCanvas";
import { canFillBitmapLayer } from "./activeTargets";

type StoryboardApi = Window["storyboard"];
type ProjectUpdate = Project | ((currentProject: Project) => Project);

export type BitmapLayerPaintingControllerOptions<HistoryEntry> = {
  api: StoryboardApi | undefined;
  projectRef: MutableRefObject<Project>;
  folderPath: string | undefined;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  createHistoryEntry: (bitmapPaths?: string[]) => Promise<HistoryEntry>;
  recordUndoEntry: (entry: HistoryEntry) => void;
  markShotsDirty: (shotIds: string[]) => void;
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
};

export const sourceDataUrlForBitmapLayer = async ({
  api,
  folderPath,
  shot,
  layer,
  createBlankLayerDataUrl = createTransparentLayerDataUrl
}: {
  api: StoryboardApi;
  folderPath: string;
  shot: Shot;
  layer: BitmapLayer;
  createBlankLayerDataUrl?: (width: number, height: number) => Promise<string>;
}): Promise<string> => {
  const blankDataUrl = await createBlankLayerDataUrl(layer.width, layer.height);
  const layerDataUrl = await api
    .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
    .catch(() => undefined);

  if (layerDataUrl) {
    return layerDataUrl;
  }

  if (layer.cleared || layer.kind !== "image") {
    return blankDataUrl;
  }

  return api.assetUrl(shot.previewPath ?? shot.imagePath);
};

export const useBitmapLayerPaintingController = <HistoryEntry,>({
  api,
  projectRef,
  folderPath,
  bitmapLayerWriteQueueRef,
  createHistoryEntry,
  recordUndoEntry,
  markShotsDirty,
  updateProject
}: BitmapLayerPaintingControllerOptions<HistoryEntry>) => {
  const handleBitmapStroke = async (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    pendingStrokes: SketchStroke[] = []
  ) => {
    if (!api || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    return bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked) {
        return undefined;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      const dataUrl =
        renderedDataUrl ??
        (await drawStrokeOnBitmapLayer(
          await sourceDataUrlForBitmapLayer({ api, folderPath, shot: currentShot, layer: currentLayer }),
          currentLayer,
          stroke,
          pendingStrokes
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

    return bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked) {
        return undefined;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
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

    return bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!canFillBitmapLayer(currentLayer)) {
        return undefined;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      const dataUrl = await fillBitmapLayerAtPoint(
        await sourceDataUrlForBitmapLayer({ api, folderPath, shot: currentShot, layer: currentLayer }),
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
    handleBitmapFill,
    handleBitmapSelectionTransform,
    handleBitmapStroke
  };
};
