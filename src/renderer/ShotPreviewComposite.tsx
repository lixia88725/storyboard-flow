import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { bitmapLayersForShot } from "../shared/projectOps";
import type { Shot } from "../shared/types";
import { canvasSizeForShot, cssBlendMode } from "./sketchRendering";

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

export const ShotPreviewComposite = ({
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
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadLayers = async () => {
      setLayerDataUrls({});

      const visibleLayers = bitmapLayers.filter((layer) => layer.visible);
      if (!folderPath || visibleLayers.length === 0) {
        return;
      }

      const entries = await Promise.all(
        visibleLayers.map(async (layer) => {
          if (layer.cleared) {
            return [layer.id, undefined] as const;
          }

          const dataUrl = await window.storyboard
            .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
            .catch(() => undefined);
          return [layer.id, dataUrl] as const;
        })
      );

      if (!cancelled) {
        setLayerDataUrls(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
        );
      }
    };

    void loadLayers();

    return () => {
      cancelled = true;
    };
  }, [bitmapLayers, folderPath, revision]);

  if (bitmapLayers.length === 0) {
    return <img className={className} src={fallbackSrc} alt="" draggable={false} />;
  }

  return (
    <div
      className={className}
      style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      aria-hidden="true"
    >
      {shotPreviewLayerItems(shot, { fallbackSrc, layerDataUrls }).map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          draggable={false}
          style={{
            opacity: layer.opacity,
            mixBlendMode: layer.mixBlendMode
          }}
        />
      ))}
    </div>
  );
};
