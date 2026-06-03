import { bitmapLayersForShot } from "../shared/projectOps";
import type { Project } from "../shared/types";

export type DeleteTarget =
  | { type: "shot" }
  | { type: "layer"; shotId: string; layerId: string };

export type ResolvedDeleteTarget =
  | { type: "shot" }
  | { type: "layer"; shotId: string; layerId: string }
  | { type: "locked-layer"; shotId: string; layerId: string };

export const resolveDeleteTarget = (
  project: Project,
  target: DeleteTarget
): ResolvedDeleteTarget => {
  if (target.type === "shot") {
    return { type: "shot" };
  }

  const shot = project.shots.find((item) => item.id === target.shotId);
  const layer = shot
    ? bitmapLayersForShot(shot).find((item) => item.id === target.layerId)
    : undefined;

  if (!shot || !layer) {
    return { type: "shot" };
  }

  if (layer.locked) {
    return { type: "locked-layer", shotId: shot.id, layerId: layer.id };
  }

  return { type: "layer", shotId: shot.id, layerId: layer.id };
};
