import { memo, type CSSProperties, type SyntheticEvent } from "react";
import { bitmapLayersForShot } from "../shared/projectOps";
import type { BitmapLayer, Shot } from "../shared/types";
import { canvasSizeForShot, cssBlendMode } from "./sketchRendering";

export const bitmapLayerAssetSource = ({
  folderPath,
  layer,
  revision
}: {
  folderPath: string | undefined;
  layer: BitmapLayer;
  revision: number;
}): string | undefined =>
  folderPath
    ? window.storyboard.layerAssetUrl({
        folderPath,
        bitmapPath: layer.bitmapPath,
        revision
      })
    : undefined;

export const staticLayerLoadingMode = (
  preloadBase: boolean,
  layerIndex: number,
  baseLayerIndex: number
): "eager" | "lazy" =>
  preloadBase && layerIndex === baseLayerIndex ? "eager" : "lazy";

const handleLayerImageError = (
  event: SyntheticEvent<HTMLImageElement>,
  fallbackSrc: string | undefined
) => {
  const image = event.currentTarget;
  if (fallbackSrc && image.dataset.fallbackApplied !== "true") {
    image.dataset.fallbackApplied = "true";
    image.src = fallbackSrc;
    return;
  }
  image.style.display = "none";
};

export const ShotLayerImageStack = memo(
  ({
    shot,
    folderPath,
    revision,
    className,
    preloadBase = false
  }: {
    shot: Shot;
    folderPath?: string;
    revision: number;
    className?: string;
    preloadBase?: boolean;
  }) => {
    const fallbackSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
    const layers = bitmapLayersForShot(shot).filter((layer) => layer.visible);

    if (layers.length === 0) {
      return (
        <img
          className={className}
          src={fallbackSrc}
          alt=""
          draggable={false}
          loading={preloadBase ? "eager" : "lazy"}
          decoding="async"
        />
      );
    }

    const imageLayerIndex = layers.findIndex(
      (layer) => layer.kind === "image" && !layer.cleared
    );
    const baseLayerIndex = imageLayerIndex >= 0 ? imageLayerIndex : 0;

    return layers.map((layer, index) => {
      const source = bitmapLayerAssetSource({ folderPath, layer, revision });
      if (!source && (layer.kind !== "image" || layer.cleared)) {
        return null;
      }

      const style: CSSProperties = {
        opacity: layer.opacity,
        mixBlendMode: cssBlendMode(layer.blendMode)
      };
      const layerFallback = layer.kind === "image" && !layer.cleared ? fallbackSrc : undefined;

      return (
        <img
          key={layer.id}
          className={className}
          src={source ?? layerFallback}
          alt=""
          draggable={false}
          loading={staticLayerLoadingMode(preloadBase, index, baseLayerIndex)}
          decoding="async"
          style={style}
          onLoad={(event) => {
            event.currentTarget.style.display = "";
            delete event.currentTarget.dataset.fallbackApplied;
          }}
          onError={(event) => handleLayerImageError(event, layerFallback)}
        />
      );
    });
  }
);

ShotLayerImageStack.displayName = "ShotLayerImageStack";

export const ShotStaticMedia = memo(
  ({
    shot,
    folderPath,
    revision,
    preload = false
  }: {
    shot: Shot;
    folderPath?: string;
    revision: number;
    preload?: boolean;
  }) => {
    const canvasSize = canvasSizeForShot(shot);

    return (
      <div
        className="sketch-panel is-static-shot-media"
        data-media-preload={preload ? "warm" : "cold"}
        aria-hidden="true"
      >
        <div
          className="image-stage"
          style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
        >
          <ShotLayerImageStack
            shot={shot}
            folderPath={folderPath}
            revision={revision}
            preloadBase={preload}
          />
        </div>
      </div>
    );
  }
);

ShotStaticMedia.displayName = "ShotStaticMedia";
