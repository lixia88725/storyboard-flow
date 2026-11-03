import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import type { Shot } from "../shared/types";
import {
  ShotPreviewComposite,
  shotPreviewLayerItems as timelineLayerPreviewItems
} from "./ShotPreviewComposite";
import { timelineScrollTarget } from "./timelineScroll";

type TimelineProps = {
  folderPath?: string;
  thumbnailRevisionByShotId: Readonly<Record<string, number>>;
  shots: Shot[];
  selectedShotIds: string[];
  onSelect: (shotId: string) => void;
};

export { timelineLayerPreviewItems };

export const Timeline = ({
  folderPath,
  thumbnailRevisionByShotId,
  shots,
  selectedShotIds,
  onSelect
}: TimelineProps) => {
  const timelineRef = useRef<HTMLElement | null>(null);
  const shotElementRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedShotId = selectedShotIds[0];
  const selectedShotIdSet = useMemo(() => new Set(selectedShotIds), [selectedShotIds]);

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
        <TimelineShot
          key={shot.id}
          shot={shot}
          index={index}
          folderPath={folderPath}
          revision={thumbnailRevisionByShotId[shot.id] ?? 0}
          isSelected={selectedShotIdSet.has(shot.id)}
          onSelect={onSelect}
          shotElementRefs={shotElementRefs}
        />
      ))}
    </aside>
  );
};

const TimelineShot = memo(({
  shot,
  index,
  folderPath,
  revision,
  isSelected,
  onSelect,
  shotElementRefs
}: {
  shot: Shot;
  index: number;
  folderPath?: string;
  revision: number;
  isSelected: boolean;
  onSelect: (shotId: string) => void;
  shotElementRefs: RefObject<Map<string, HTMLButtonElement>>;
}) => {
  return (
    <button
      type="button"
      ref={(element) => {
        if (element) {
          shotElementRefs.current.set(shot.id, element);
        } else {
          shotElementRefs.current.delete(shot.id);
        }
      }}
      className={`timeline-shot ${isSelected ? "is-selected" : ""}`}
      onClick={() => onSelect(shot.id)}
      title={shot.fileName}
    >
      <ShotPreviewComposite
        shot={shot}
        folderPath={folderPath}
        revision={revision}
        className="timeline-shot-composite"
      />
      <span>{String(index + 1).padStart(3, "0")}</span>
    </button>
  );
});

TimelineShot.displayName = "TimelineShot";
