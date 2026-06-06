import { bitmapLayersForShot } from "./projectOps";
import type { Shot } from "./types";

export type GeneratedShotTransparentLayerAsset = {
  bitmapPath: string;
  width: number;
  height: number;
};

export const generatedShotTransparentLayerAssets = (
  shot: Shot
): GeneratedShotTransparentLayerAsset[] =>
  bitmapLayersForShot(shot)
    .filter((layer) => layer.kind === "paint")
    .map((layer) => ({
      bitmapPath: layer.bitmapPath,
      width: layer.width,
      height: layer.height
    }));
