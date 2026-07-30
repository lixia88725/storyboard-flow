import { memo, useMemo, type CSSProperties } from "react";
import { bitmapLayersForShot } from "../shared/projectOps";
import type { Shot } from "../shared/types";
import { canvasSizeForShot, cssBlendMode } from "./sketchRendering";
import { bitmapLayerAssetSource } from "./ShotStaticMedia";

type ShotPreviewLayerItem = {
  id: string;
  src: string;
  opacity: number;
  mixBlendMode: CSSProperties["mixBlendMode"];
};

export const shotPreviewLayerItems = (
  shot: Shot,
  {
    fallbackSrc,
    layerDataUrls
  }: {
    fallbackSrc: string;
    layerDataUrls: Record<string, string>;
  }
): ShotPreviewLayerItem[] =>
  bitmapLayersForShot(shot)
    .filter((layer) => layer.visible)
    .flatMap((layer) => {
      const src =
        layerDataUrls[layer.id] ?? (layer.kind === "image" && !layer.cleared ? fallbackSrc : undefined);

      return src
        ? [
            {
              id: layer.id,
              src,
              opacity: layer.opacity,
              mixBlendMode: cssBlendMode(layer.blendMode)
            }
          ]
        : [];
    });

export const ShotPreviewComposite = memo(({
  shot,
  folderPath,
  revision,
  className = "shot-preview-composite"
}: {
  shot: Shot;
  folderPath?: string;
  revision: number;
  className?: string;
}) => {
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const canvasSize = useMemo(() => canvasSizeForShot(shot), [shot]);
  const fallbackSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const layerDataUrls = useMemo(
    () =>
      Object.fromEntries(
        bitmapLayers.flatMap((layer) => {
          if (layer.cleared) {
            return [];
          }
          const source = bitmapLayerAssetSource({ folderPath, layer, revision });
          return source ? [[layer.id, source]] : [];
        })
      ),
    [bitmapLayers, folderPath, revision]
  );

  if (bitmapLayers.length === 0) {
    return (
      <img
        className={className}
        src={fallbackSrc}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <div
      className={className}
      style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      aria-hidden="true"
    >
      {shotPreviewLayerItems(shot, { fallbackSrc, layerDataUrls }).map((layer) => {
        const bitmapLayer = bitmapLayers.find((item) => item.id === layer.id);
        const layerFallback =
          bitmapLayer?.kind === "image" && !bitmapLayer.cleared ? fallbackSrc : undefined;
        return (
          <img
            key={layer.id}
            src={layer.src}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{
              opacity: layer.opacity,
              mixBlendMode: layer.mixBlendMode
            }}
            onLoad={(event) => {
              event.currentTarget.style.display = "";
              delete event.currentTarget.dataset.fallbackApplied;
            }}
            onError={(event) => {
              if (
                layerFallback &&
                event.currentTarget.dataset.fallbackApplied !== "true"
              ) {
                event.currentTarget.dataset.fallbackApplied = "true";
                event.currentTarget.src = layerFallback;
              } else {
                event.currentTarget.style.display = "none";
              }
            }}
          />
        );
      })}
    </div>
  );
});

ShotPreviewComposite.displayName = "ShotPreviewComposite";
