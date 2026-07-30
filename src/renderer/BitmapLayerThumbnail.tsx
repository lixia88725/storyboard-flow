import { memo } from "react";
import type { BitmapLayer, Shot } from "../shared/types";
import { bitmapLayerAssetSource } from "./ShotStaticMedia";

type BitmapLayerThumbnailProps = {
  layer: BitmapLayer;
  shot: Shot;
  folderPath?: string;
  revision: number;
};

export const BitmapLayerThumbnail = memo(({
  layer,
  shot,
  folderPath,
  revision
}: BitmapLayerThumbnailProps) => {
  const fallbackImageSrc =
    layer.kind === "image" && !layer.cleared
      ? window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)
      : undefined;
  const thumbnailSrc = layer.cleared
    ? undefined
    : bitmapLayerAssetSource({ folderPath, layer, revision }) ?? fallbackImageSrc;

  return (
    <div
      className={`layer-thumb ${layer.kind === "image" ? "layer-thumb-image" : ""}`}
      aria-hidden="true"
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            event.currentTarget.style.display = "";
            delete event.currentTarget.dataset.fallbackApplied;
          }}
          onError={(event) => {
            if (
              fallbackImageSrc &&
              event.currentTarget.dataset.fallbackApplied !== "true"
            ) {
              event.currentTarget.dataset.fallbackApplied = "true";
              event.currentTarget.src = fallbackImageSrc;
            } else {
              event.currentTarget.style.display = "none";
            }
          }}
        />
      ) : null}
    </div>
  );
});

BitmapLayerThumbnail.displayName = "BitmapLayerThumbnail";
