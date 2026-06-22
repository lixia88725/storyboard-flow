import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { bitmapLayersForShot } from "../shared/projectOps";
import type { Shot } from "../shared/types";
import { canvasSizeForShot, cssBlendMode } from "./sketchRendering";
import { timelineScrollTarget } from "./timelineScroll";

type TimelineProps = {
  folderPath?: string;
  thumbnailRevision: number;
  shots: Shot[];
  selectedShotIds: string[];
  onSelect: (shotId: string) => void;
};

type TimelineLayerPreviewItem = {
  id: string;
  src: string;
  opacity: number;
  mixBlendMode: CSSProperties["mixBlendMode"];
};

export const timelineLayerPreviewItems = (
  shot: Shot,
  {
    fallbackSrc,
    layerDataUrls
  }: {
    fallbackSrc: string;
    layerDataUrls: Record<string, string>;
  }
): TimelineLayerPreviewItem[] =>
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

export const Timeline = ({
  folderPath,
  thumbnailRevision,
  shots,
  selectedShotIds,
  onSelect
}: TimelineProps) => {
  const timelineRef = useRef<HTMLElement | null>(null);
  const shotElementRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedShotId = selectedShotIds[0];

  useEffect(() => {
    if (!selectedShotId) {
      return;
    }

    const timeline = timelineRef.current;
    const selectedShot = shotElementRefs.current.get(selectedShotId);
    if (!timeline || !selectedShot) {
      return;
    }

    const targetScrollLeft = timelineScrollTarget({
      containerRect: timeline.getBoundingClientRect(),
      itemRect: selectedShot.getBoundingClientRect(),
      scrollLeft: timeline.scrollLeft,
      maxScrollLeft: timeline.scrollWidth - timeline.clientWidth
    });

    if (targetScrollLeft === undefined) {
      return;
    }

    timeline.scrollTo({ left: targetScrollLeft, behavior: "smooth" });
  }, [selectedShotId]);

  return (
    <aside ref={timelineRef} className="timeline" aria-label="Timeline">
      {shots.map((shot, index) => (
        <button
          type="button"
          key={shot.id}
          ref={(element) => {
            if (element) {
              shotElementRefs.current.set(shot.id, element);
            } else {
              shotElementRefs.current.delete(shot.id);
            }
          }}
          className={`timeline-shot ${selectedShotIds.includes(shot.id) ? "is-selected" : ""}`}
          onClick={() => onSelect(shot.id)}
          title={shot.fileName}
        >
          <TimelineThumbnail
            shot={shot}
            folderPath={folderPath}
            revision={thumbnailRevision}
          />
          <span>{String(index + 1).padStart(3, "0")}</span>
        </button>
      ))}
    </aside>
  );
};

const TimelineThumbnail = ({
  shot,
  folderPath,
  revision
}: {
  shot: Shot;
  folderPath?: string;
  revision: number;
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
  }, [bitmapLayers, fallbackSrc, folderPath, revision]);

  if (bitmapLayers.length === 0) {
    return <img src={fallbackSrc} alt="" draggable={false} />;
  }

  return (
    <div
      className="timeline-shot-composite"
      style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      aria-hidden="true"
    >
      {timelineLayerPreviewItems(shot, { fallbackSrc, layerDataUrls }).map((layer) => (
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
