import { useEffect, useState } from "react";
import type { BitmapLayer, Shot } from "../shared/types";

type BitmapLayerThumbnailProps = {
  layer: BitmapLayer;
  shot: Shot;
  folderPath?: string;
  revision: number;
};

export const BitmapLayerThumbnail = ({
  layer,
  shot,
  folderPath,
  revision
}: BitmapLayerThumbnailProps) => {
  const fallbackImageSrc =
    layer.kind === "image" && !layer.cleared
      ? window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)
      : undefined;
  const [thumbnailSrc, setThumbnailSrc] = useState<string | undefined>(fallbackImageSrc);

  useEffect(() => {
    let cancelled = false;

    const loadThumbnail = async () => {
      if (layer.cleared) {
        setThumbnailSrc(undefined);
        return;
      }

      const layerDataUrl = folderPath
        ? await window.storyboard
            .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
            .catch(() => undefined)
        : undefined;

      if (!cancelled) {
        setThumbnailSrc(layerDataUrl ?? fallbackImageSrc);
      }
    };

    void loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [fallbackImageSrc, folderPath, layer.bitmapPath, layer.cleared, revision]);

  return (
    <div
      className={`layer-thumb ${layer.kind === "image" ? "layer-thumb-image" : ""}`}
      aria-hidden="true"
    >
      {thumbnailSrc ? <img src={thumbnailSrc} alt="" draggable={false} /> : null}
    </div>
  );
};
