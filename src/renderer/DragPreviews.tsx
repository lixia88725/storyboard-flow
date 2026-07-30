import { useState } from "react";
import type { Dialogue, Shot } from "../shared/types";
import { canvasSizeForShot } from "./sketchRendering";
import { ShotLayerImageStack } from "./ShotStaticMedia";

export const DialoguePreview = ({ dialogue }: { dialogue: Dialogue }) => {
  return <div className="dialogue-preview">{dialogue.text || "Empty dialogue"}</div>;
};

export const shotPreviewAssetPath = ({
  previewPath,
  imagePath
}: Pick<Shot, "previewPath" | "imagePath">): string => previewPath ?? imagePath;

type ShotStackPreviewVariant = "composite" | "thumbnail";

export const ShotStackPreview = ({
  shots,
  folderPath,
  bitmapRevisionByShotId,
  variant = "composite"
}: {
  shots: Shot[];
  folderPath?: string;
  bitmapRevisionByShotId?: Readonly<Record<string, number>>;
  variant?: ShotStackPreviewVariant;
}) => {
  const visibleShots = shots.slice(0, 4);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());

  return (
    <div className="shot-stack-preview">
      {visibleShots.map((shot, index) => {
        const assetPath = shotPreviewAssetPath(shot);
        const didFail = failedImageIds.has(shot.id);
        const onFail = () =>
          setFailedImageIds((current) => {
            const next = new Set(current);
            next.add(shot.id);
            return next;
          });

        return (
          <div
            key={shot.id}
            className="shot-stack-card"
            style={{
              transform: `translate(${index * 10}px, ${index * 8}px) rotate(${index * 1.5 - 2}deg)`,
              zIndex: visibleShots.length - index
            }}
          >
            {variant === "thumbnail" ? (
              <ShotThumbnailPreview fallbackAssetPath={assetPath} didFail={didFail} onFail={onFail} />
            ) : (
              <ShotCompositePreview
                shot={shot}
                folderPath={folderPath}
                revision={bitmapRevisionByShotId?.[shot.id] ?? 0}
                didFail={didFail}
              />
            )}
            <span>{shot.fileName}</span>
          </div>
        );
      })}
      {shots.length > 1 ? <strong>{shots.length}</strong> : null}
    </div>
  );
};

const ShotThumbnailPreview = ({
  fallbackAssetPath,
  didFail,
  onFail
}: {
  fallbackAssetPath: string;
  didFail: boolean;
  onFail: () => void;
}) => {
  if (didFail) {
    return <div className="shot-stack-card-placeholder" aria-hidden="true" />;
  }

  return <img src={window.storyboard.assetUrl(fallbackAssetPath)} alt="" draggable={false} onError={onFail} />;
};

const ShotCompositePreview = ({
  shot,
  folderPath,
  revision,
  didFail
}: {
  shot: Shot;
  folderPath?: string;
  revision: number;
  didFail: boolean;
}) => {
  const canvasSize = canvasSizeForShot(shot);

  if (didFail) {
    return <div className="shot-stack-card-placeholder" aria-hidden="true" />;
  }

  return (
    <div
      className="shot-stack-card-composite"
      style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      aria-hidden="true"
    >
      <ShotLayerImageStack shot={shot} folderPath={folderPath} revision={revision} />
    </div>
  );
};
