import { useEffect, useMemo, useState } from "react";
import { bitmapLayersForShot } from "../shared/projectOps";
import type { Dialogue, Shot } from "../shared/types";
import { canvasSizeForShot, cssBlendMode } from "./sketchRendering";

export const DialoguePreview = ({ dialogue }: { dialogue: Dialogue }) => {
  return <div className="dialogue-preview">{dialogue.text || "Empty dialogue"}</div>;
};

export const ShotStackPreview = ({
  shots,
  folderPath,
  variant = "move"
}: {
  shots: Shot[];
  folderPath?: string;
  variant?: "move" | "copy";
}) => {
  const visibleShots = shots.slice(0, 4);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());

  return (
    <div className={`shot-stack-preview ${variant === "copy" ? "is-copy-preview" : ""}`}>
      {visibleShots.map((shot, index) => {
        const assetPath = shot.previewPath ?? shot.imagePath;
        const didFail = failedImageIds.has(shot.id);

        return (
          <div
            key={shot.id}
            className="shot-stack-card"
            style={{
              transform: `translate(${index * 10}px, ${index * 8}px) rotate(${index * 1.5 - 2}deg)`,
              zIndex: visibleShots.length - index
            }}
          >
            <ShotCompositePreview
              shot={shot}
              folderPath={folderPath}
              fallbackAssetPath={assetPath}
              didFail={didFail}
              onFail={() =>
                setFailedImageIds((current) => {
                  const next = new Set(current);
                  next.add(shot.id);
                  return next;
                })
              }
            />
            <span>{shot.fileName}</span>
          </div>
        );
      })}
      {shots.length > 1 ? <strong>{shots.length}</strong> : null}
    </div>
  );
};

const ShotCompositePreview = ({
  shot,
  folderPath,
  fallbackAssetPath,
  didFail,
  onFail
}: {
  shot: Shot;
  folderPath?: string;
  fallbackAssetPath: string;
  didFail: boolean;
  onFail: () => void;
}) => {
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const canvasSize = useMemo(() => canvasSizeForShot(shot), [shot]);
  const fallbackSrc = window.storyboard.assetUrl(fallbackAssetPath);
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadLayers = async () => {
      setLayerDataUrls({});

      if (!folderPath || bitmapLayers.length === 0) {
        return;
      }

      const entries = await Promise.all(
        bitmapLayers.map(async (layer) => {
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
  }, [bitmapLayers, folderPath]);

  if (didFail) {
    return <div className="shot-stack-card-placeholder" aria-hidden="true" />;
  }

  if (bitmapLayers.length === 0) {
    return <img src={fallbackSrc} alt="" draggable={false} onError={onFail} />;
  }

  return (
    <div
      className="shot-stack-card-composite"
      style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      aria-hidden="true"
    >
      {bitmapLayers
        .filter((layer) => layer.visible)
        .map((layer) => {
          const layerSrc =
            layerDataUrls[layer.id] ?? (layer.kind === "image" && !layer.cleared ? fallbackSrc : undefined);

          return layerSrc ? (
            <img
              key={layer.id}
              src={layerSrc}
              alt=""
              draggable={false}
              onError={onFail}
              style={{
                opacity: layer.opacity,
                mixBlendMode: cssBlendMode(layer.blendMode)
              }}
            />
          ) : null;
        })}
    </div>
  );
};
