import { useEffect, useRef } from "react";
import type { Shot } from "../shared/types";
import { timelineScrollTarget } from "./timelineScroll";

type TimelineProps = {
  shots: Shot[];
  selectedShotIds: string[];
  onSelect: (shotId: string) => void;
};

export const Timeline = ({ shots, selectedShotIds, onSelect }: TimelineProps) => {
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
          <img
            src={window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)}
            alt=""
            draggable={false}
          />
          <span>{String(index + 1).padStart(3, "0")}</span>
        </button>
      ))}
    </aside>
  );
};
