import { bitmapLayersForShot } from "../shared/projectOps";
import type { BitmapLayer, Shot } from "../shared/types";

export const primaryShotFromSelection = (
  shots: Shot[],
  selectedShotIds: string[]
): Shot | undefined => {
  const selectedShotId = selectedShotIds[0];
  return selectedShotId ? shots.find((shot) => shot.id === selectedShotId) : undefined;
};

export const primaryShotOrFirst = (shots: Shot[], selectedShotIds: string[]): Shot | undefined => {
  return primaryShotFromSelection(shots, selectedShotIds) ?? shots[0];
};

export const activeVisibleBitmapLayerForShot = (shot: Shot): BitmapLayer | undefined => {
  const layers = bitmapLayersForShot(shot);
  const activeLayer = layers.find((layer) => layer.id === shot.activeLayerId && layer.visible);
  return activeLayer ?? [...layers].reverse().find((layer) => layer.visible);
};

export const editableBitmapLayerForShot = (shot: Shot): BitmapLayer | undefined => {
  const layers = bitmapLayersForShot(shot);
  const activeLayer = layers.find(
    (layer) => layer.id === shot.activeLayerId && layer.visible && !layer.locked
  );
  return activeLayer ?? [...layers].reverse().find((layer) => layer.visible && !layer.locked);
};

export const canFillBitmapLayer = (layer: BitmapLayer | undefined): layer is BitmapLayer =>
  Boolean(layer && layer.visible && !layer.locked && (layer.kind === "paint" || layer.kind === "image"));
