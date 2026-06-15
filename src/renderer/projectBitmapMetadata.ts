import { ensureBitmapLayerMetadata } from "../shared/projectOps";
import type { Project } from "../shared/types";

export const ensureProjectBitmapMetadata = (project: Project): Project => ({
  ...project,
  shots: project.shots.map((shot) => ensureBitmapLayerMetadata(shot)),
  parkedShots: project.parkedShots?.map((shot) => ensureBitmapLayerMetadata(shot))
});
