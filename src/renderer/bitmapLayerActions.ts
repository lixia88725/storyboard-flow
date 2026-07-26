import type { MutableRefObject } from "react";
import {
  addBitmapLayer,
  bitmapLayersForShot,
  clearBitmapLayer,
  deleteBitmapLayer,
  mergeBitmapLayerDown,
  mergeSelectedBitmapLayers,
  mergeVisibleBitmapLayers
} from "../shared/projectOps";
import type { BitmapLayer, Project } from "../shared/types";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { canvasSizeForShot } from "./sketchRendering";
import { sketchCanvasSize } from "./sketchGeometry";

export type BitmapLayerProjectUpdate = Project | ((currentProject: Project) => Project);

export const visibleLayerBelow = (
  layers: BitmapLayer[],
  sourceLayerId: string
): BitmapLayer | undefined => {
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceLayerId);
  if (sourceIndex <= 0) {
    return undefined;
  }

  return [...layers.slice(0, sourceIndex)].reverse().find((layer) => layer.visible);
};

export type BitmapLayerActionsOptions<HistoryEntry> = {
  projectRef: MutableRefObject<Project>;
  folderPath: string | undefined;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  createTransparentLayerDataUrl: (width: number, height: number) => Promise<string>;
  createHistoryEntry: (bitmapPaths?: string[]) => Promise<HistoryEntry>;
  recordUndoEntry: (entry: HistoryEntry) => void;
  markShotsDirty: (shotIds: string[]) => void;
  updateProject: (
    projectUpdate: BitmapLayerProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
  setStatus: (status: string) => void;
};

export const useBitmapLayerActions = <HistoryEntry,>({
  projectRef,
  folderPath,
  bitmapLayerWriteQueueRef,
  createTransparentLayerDataUrl,
  createHistoryEntry,
  recordUndoEntry,
  markShotsDirty,
  updateProject,
  setStatus
}: BitmapLayerActionsOptions<HistoryEntry>) => {
  const handleClearBitmapLayer = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    await bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shotId);
      const currentLayer = currentShot ? bitmapLayersForShot(currentShot).find((item) => item.id === layerId) : undefined;
      if (!currentLayer || currentLayer.locked) {
        return;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      await window.storyboard.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl: await createTransparentLayerDataUrl(currentLayer.width, currentLayer.height)
      });
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject((currentProject) => clearBitmapLayer(currentProject, shotId, layerId), false, false);
    });
  };

  const handleRemoveBitmapLayer = async (shotId: string, layerId: string) => {
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      if (projectRef.current !== projectAtRequest) {
        setStatus("Storyboard changed before layer removal; try again");
        return;
      }
      const undoEntry = await createHistoryEntry([layer.bitmapPath]);
      await window.storyboard.deleteLayerPng({
        folderPath,
        bitmapPath: layer.bitmapPath
      });
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => deleteBitmapLayer(currentProject, shotId, layerId),
        false,
        false
      );
    });
  };

  const handleMergeBitmapLayerDown = async (shotId: string, layerId: string) => {
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const sourceLayer = layers.find((item) => item.id === layerId && item.visible);
    const targetLayer = sourceLayer ? visibleLayerBelow(layers, sourceLayer.id) : undefined;

    if (!window.storyboard || !folderPath || !shot || !sourceLayer) {
      return;
    }

    if (!targetLayer) {
      setStatus("No visible layer below to merge into");
      return;
    }

    if (sourceLayer.locked || targetLayer.locked) {
      setStatus("Unlock both layers before merging down");
      return;
    }

    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (projectRef.current !== projectAtRequest) {
          throw new Error("Storyboard changed before merge; try again");
        }
        const undoEntry = await createHistoryEntry([targetLayer.bitmapPath, sourceLayer.bitmapPath]);
        await window.storyboard.mergeLayerDown({
          folderPath,
          sourceBitmapPath: sourceLayer.bitmapPath,
          targetBitmapPath: targetLayer.bitmapPath,
          width: targetLayer.width,
          height: targetLayer.height,
          sourceOpacity: sourceLayer.opacity,
          sourceBlendMode: sourceLayer.blendMode,
          targetOpacity: targetLayer.opacity,
          targetBlendMode: targetLayer.blendMode
        });
        markShotsDirty([shotId]);
        recordUndoEntry(undoEntry);
        updateProject(
          (currentProject) =>
            mergeBitmapLayerDown(currentProject, shotId, sourceLayer.id, targetLayer.id),
          false,
          false
        );
        setStatus(`Merged "${sourceLayer.name}" down into "${targetLayer.name}"`);
      });
    } catch (error) {
      setStatus(`Merge down failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMergeBitmapLayers = async (
    shotId: string,
    layerId: string,
    selectedLayerIds: string[]
  ) => {
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const selectedLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));

    if (selectedLayers.length < 2) {
      await handleMergeBitmapLayerDown(shotId, layerId);
      return;
    }

    if (!window.storyboard || !folderPath || !shot) {
      return;
    }

    if (selectedLayers.some((layer) => layer.locked)) {
      setStatus("Unlock selected layers before merging");
      return;
    }

    if (selectedLayers.some((layer) => !layer.visible)) {
      setStatus("Show selected layers before merging");
      return;
    }

    const targetLayer = selectedLayers[0];
    const sourceLayers = selectedLayers.slice(1);

    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (projectRef.current !== projectAtRequest) {
          throw new Error("Storyboard changed before merge; try again");
        }
        const undoEntry = await createHistoryEntry(selectedLayers.map((layer) => layer.bitmapPath));
        await window.storyboard.mergeVisibleLayers({
          folderPath,
          targetBitmapPath: targetLayer.bitmapPath,
          width: targetLayer.width,
          height: targetLayer.height,
          layers: selectedLayers.map((layer) => ({
            bitmapPath: layer.bitmapPath,
            opacity: layer.opacity,
            blendMode: layer.blendMode
          })),
          deleteBitmapPaths: sourceLayers.map((layer) => layer.bitmapPath)
        });
        markShotsDirty([shotId]);
        recordUndoEntry(undoEntry);
        updateProject(
          (currentProject) =>
            mergeSelectedBitmapLayers(
              currentProject,
              shotId,
              selectedLayers.map((layer) => layer.id)
            ),
          false,
          false
        );
        setStatus(`Merged ${selectedLayers.length} selected layers`);
      });
    } catch (error) {
      setStatus(`Merge failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMergeVisibleBitmapLayers = async (shotId: string) => {
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const visibleLayers = layers.filter((layer) => layer.visible);
    const targetLayer = visibleLayers[0];

    if (!window.storyboard || !folderPath || !shot || !targetLayer) {
      return;
    }

    if (visibleLayers.length < 2) {
      setStatus("Need at least two visible layers to merge");
      return;
    }

    const nextProject = mergeVisibleBitmapLayers(projectRef.current, shotId);
    const nextShot = nextProject.shots.find((item) => item.id === shotId);
    const existingLayerIds = new Set(layers.map((layer) => layer.id));
    const mergedLayer = nextShot
      ? bitmapLayersForShot(nextShot).find((layer) => !existingLayerIds.has(layer.id))
      : undefined;

    if (!mergedLayer) {
      setStatus("Could not create merged layer");
      return;
    }

    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (projectRef.current !== projectAtRequest) {
          throw new Error("Storyboard changed before merge; try again");
        }
        const undoEntry = await createHistoryEntry([
          ...visibleLayers.map((layer) => layer.bitmapPath),
          mergedLayer.bitmapPath
        ]);
        await window.storyboard.mergeVisibleLayers({
          folderPath,
          targetBitmapPath: mergedLayer.bitmapPath,
          width: mergedLayer.width,
          height: mergedLayer.height,
          layers: visibleLayers.map((layer) => ({
            bitmapPath: layer.bitmapPath,
            opacity: layer.opacity,
            blendMode: layer.blendMode
          })),
          deleteBitmapPaths: visibleLayers
            .filter((layer) => !layer.locked)
            .map((layer) => layer.bitmapPath)
        });
        markShotsDirty([shotId]);
        recordUndoEntry(undoEntry);
        updateProject(nextProject, false, false);
        setStatus("Merged visible layers");
      });
    } catch (error) {
      setStatus(`Merge visible failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleAddBitmapLayer = async (shotId: string) => {
    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      const currentProject = projectRef.current;
      const targetShot = currentProject.shots.find((item) => item.id === shotId);
      const canvasSize = targetShot
        ? canvasSizeForShot(targetShot)
        : sketchCanvasSize;
      const existingLayerIds = new Set(
        targetShot ? bitmapLayersForShot(targetShot).map((layer) => layer.id) : []
      );
      const nextProject = addBitmapLayer(currentProject, shotId, {
        name: "Layer",
        width: canvasSize.width,
        height: canvasSize.height
      });
      const nextShot = nextProject.shots.find((item) => item.id === shotId);
      const addedLayer = nextShot
        ? bitmapLayersForShot(nextShot).find(
            (layer) => !existingLayerIds.has(layer.id)
          )
        : undefined;
      const undoEntry = await createHistoryEntry(
        addedLayer ? [addedLayer.bitmapPath] : []
      );

      recordUndoEntry(undoEntry);
      markShotsDirty([shotId]);
      updateProject(nextProject, false, false);
    });
  };

  return {
    handleAddBitmapLayer,
    handleClearBitmapLayer,
    handleMergeBitmapLayerDown,
    handleMergeBitmapLayers,
    handleMergeVisibleBitmapLayers,
    handleRemoveBitmapLayer
  };
};
