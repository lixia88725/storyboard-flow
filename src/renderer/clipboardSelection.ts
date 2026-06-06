import {
  bitmapLayerPath,
  bitmapLayersForShot,
  sortedShots
} from "../shared/projectOps";
import type { Project, Shot } from "../shared/types";
import { primaryShotOrFirst } from "./activeTargets";
import { resolveDeleteTarget, type DeleteTarget } from "./deleteTarget";

export type ClipboardSelection =
  | { type: "shot"; shotId: string }
  | { type: "layer"; shotId: string; layerId: string };

export type CopySelectionResult =
  | { ok: true; clipboard: ClipboardSelection; status: string }
  | { ok: false; status: string };

export type ShotAssetCopyPlan = {
  pastedShotId: string;
  layerCopies: Array<{
    sourceBitmapPath: string;
    targetBitmapPath: string;
  }>;
};

export type LayerPasteTarget =
  | {
      ok: true;
      sourceLayer: ReturnType<typeof bitmapLayersForShot>[number];
      targetShot: Shot;
      targetLayer: ReturnType<typeof bitmapLayersForShot>[number];
    }
  | { ok: false; status: string };

export const copySelectionFromProject = (
  project: Project,
  deleteTarget: DeleteTarget,
  selectedShotIds: string[]
): CopySelectionResult => {
  const resolvedTarget = resolveDeleteTarget(project, deleteTarget);

  if (resolvedTarget.type === "layer" || resolvedTarget.type === "locked-layer") {
    const shot = project.shots.find((item) => item.id === resolvedTarget.shotId);
    const layer = shot
      ? bitmapLayersForShot(shot).find((item) => item.id === resolvedTarget.layerId)
      : undefined;

    if (!shot || !layer) {
      return { ok: false, status: "No layer selected to copy" };
    }

    return {
      ok: true,
      clipboard: { type: "layer", shotId: shot.id, layerId: layer.id },
      status: `Layer "${layer.name}" copied`
    };
  }

  const shot = primaryShotOrFirst(sortedShots(project.shots), selectedShotIds);
  if (!shot) {
    return { ok: false, status: "No storyboard selected to copy" };
  }

  return {
    ok: true,
    clipboard: { type: "shot", shotId: shot.id },
    status: "Storyboard copied"
  };
};

export const shotAssetCopyPlan = (
  sourceShot: Shot,
  pastedShotId: string
): ShotAssetCopyPlan => ({
  pastedShotId,
  layerCopies: bitmapLayersForShot(sourceShot).map((layer) => ({
    sourceBitmapPath: layer.bitmapPath,
    targetBitmapPath: bitmapLayerPath(pastedShotId, layer.id)
  }))
});

export const layerPasteTargetFromProject = (
  project: Project,
  deleteTarget: DeleteTarget,
  sourceShotId: string,
  sourceLayerId: string
): LayerPasteTarget => {
  const sourceShot = project.shots.find((shot) => shot.id === sourceShotId);
  const sourceLayer = sourceShot
    ? bitmapLayersForShot(sourceShot).find((layer) => layer.id === sourceLayerId)
    : undefined;
  const resolvedTarget = resolveDeleteTarget(project, deleteTarget);

  if (resolvedTarget.type !== "layer" && resolvedTarget.type !== "locked-layer") {
    return { ok: false, status: "Select a layer before pasting a layer" };
  }

  const targetShot = project.shots.find((shot) => shot.id === resolvedTarget.shotId);
  const targetLayer = targetShot
    ? bitmapLayersForShot(targetShot).find((layer) => layer.id === resolvedTarget.layerId)
    : undefined;

  if (!sourceLayer || !targetShot || !targetLayer) {
    return { ok: false, status: "Cannot paste layer: copied or target layer is missing" };
  }

  return { ok: true, sourceLayer, targetShot, targetLayer };
};
