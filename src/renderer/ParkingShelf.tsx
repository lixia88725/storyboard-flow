import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Ref } from "react";
import type { Shot } from "../shared/types";
import type { DragData, ParkingInsertionIndicator } from "./storyboardDnd";

type ParkingShelfProps = {
  shots: Shot[];
  isOpen: boolean;
  insertionIndicator?: ParkingInsertionIndicator;
  listRef?: Ref<HTMLDivElement>;
};

export const ParkingShelf = ({
  shots,
  isOpen,
  insertionIndicator,
  listRef
}: ParkingShelfProps) => {
  const panelDroppable = useDroppable({
    id: "parking-zone",
    data: { type: "parking-zone" } satisfies DragData
  });
  const visible = isOpen || panelDroppable.isOver;

  return (
    <aside
      ref={panelDroppable.setNodeRef}
      className={`parking-shelf ${visible ? "is-open" : ""} ${panelDroppable.isOver ? "is-over" : ""}`}
      aria-label="Storyboard parking shelf"
    >
      <div className="parking-panel">
        <header>
          <span>Pending</span>
          <strong>{shots.length}</strong>
        </header>
        <div ref={listRef} className="parking-list">
          {insertionIndicator ? (
            <div
              className="parking-insertion-indicator"
              aria-hidden="true"
              style={{
                left: insertionIndicator.left,
                top: insertionIndicator.top,
                width: insertionIndicator.width
              }}
            />
          ) : null}
          {shots.length === 0 ? (
            <p>Drop shots here</p>
          ) : (
            shots.map((shot) => <ParkedShotCard key={shot.id} shot={shot} />)
          )}
        </div>
      </div>
    </aside>
  );
};

const ParkedShotCard = ({ shot }: { shot: Shot }) => {
  const sortable = useSortable({
    id: `parked-${shot.id}`,
    data: { type: "parked-shot", shotId: shot.id } satisfies DragData
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };

  return (
    <article
      ref={sortable.setNodeRef}
      className="parked-shot-card"
      style={style}
      data-parked-shot-id={shot.id}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <img src={window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)} alt="" draggable={false} />
      <span>{shot.fileName}</span>
    </article>
  );
};
