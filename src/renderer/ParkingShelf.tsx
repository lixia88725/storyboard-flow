import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Ref } from "react";
import type { Shot } from "../shared/types";
import type { AiPendingCandidate } from "./ai/useAiPendingCandidates";
import type { DragData, ParkingInsertionIndicator } from "./storyboardDnd";

type ParkingShelfProps = {
  shots: Shot[];
  aiCandidates: AiPendingCandidate[];
  aiCandidateSourceNames: Record<string, string>;
  isOpen: boolean;
  insertionIndicator?: ParkingInsertionIndicator;
  listRef?: Ref<HTMLDivElement>;
  onDiscardAiCandidate: (candidateId: string) => void;
};

export const ParkingShelf = ({
  shots,
  aiCandidates,
  aiCandidateSourceNames,
  isOpen,
  insertionIndicator,
  listRef,
  onDiscardAiCandidate
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
          <strong>{shots.length + aiCandidates.length}</strong>
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
          {shots.length === 0 && aiCandidates.length === 0 ? (
            <p>Drop shots here</p>
          ) : null}
          {aiCandidates.length > 0 ? (
            <section className="pending-section">
              <h3>AI Generated</h3>
              {aiCandidates.map((candidate) => (
                <AiPendingCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  sourceName={aiCandidateSourceNames[candidate.shotId]}
                  onDiscard={onDiscardAiCandidate}
                />
              ))}
            </section>
          ) : null}
          {shots.length > 0 ? (
            <section className="pending-section">
              {aiCandidates.length > 0 ? <h3>Storyboards</h3> : null}
              {shots.map((shot) => <ParkedShotCard key={shot.id} shot={shot} />)}
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  );
};

const AiPendingCandidateCard = ({
  candidate,
  sourceName,
  onDiscard
}: {
  candidate: AiPendingCandidate;
  sourceName?: string;
  onDiscard: (candidateId: string) => void;
}) => {
  const sortable = useSortable({
    id: `ai-candidate-${candidate.id}`,
    data: { type: "ai-candidate", candidateId: candidate.id } satisfies DragData
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };

  return (
    <article
      ref={sortable.setNodeRef}
      className="parked-shot-card ai-pending-candidate-card"
      style={style}
      data-ai-candidate-id={candidate.id}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <img src={window.storyboard.assetUrl(candidate.filePath)} alt="" draggable={false} />
      <div className="ai-pending-candidate-copy">
        <span>AI · {sourceName ?? "Source unavailable"}</span>
        <small>{new Date(candidate.createdAt).toLocaleString()}</small>
      </div>
      <button
        type="button"
        aria-label="Discard AI candidate"
        title="Discard AI candidate"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDiscard(candidate.id);
        }}
      >
        ×
      </button>
    </article>
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
