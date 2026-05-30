import type { Shot } from "../shared/types";

type TimelineProps = {
  shots: Shot[];
  selectedShotIds: string[];
  onSelect: (shotId: string) => void;
};

export const Timeline = ({ shots, selectedShotIds, onSelect }: TimelineProps) => {
  return (
    <aside className="timeline" aria-label="Timeline">
      {shots.map((shot, index) => (
        <button
          type="button"
          key={shot.id}
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
