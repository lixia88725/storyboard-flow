import type {
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent
} from "@dnd-kit/core";
import type { Dialogue, Project } from "../shared/types";
import {
  dragPreviewShotIds as chooseDragPreviewShotIds,
  type DragData
} from "./storyboardDnd";

type StoryboardDragSessionControllerOptions = {
  openPendingShelf: () => void;
  orderedShotIds: string[];
  projectRef: { current: Project };
  queueInsertionTargetsFromDrag: (event: DragMoveEvent | DragOverEvent | DragEndEvent) => void;
  resetInsertionDragState: () => void;
  selectedShotIdsRef: { current: string[] };
  selectSingleShot: (shotId: string | undefined) => void;
  setActiveDialogue: (dialogue: Dialogue | undefined) => void;
  setActiveDragType: (dragType: DragData["type"] | undefined) => void;
  setActiveParkedShotIds: (shotIds: string[]) => void;
  setActiveShotIds: (shotIds: string[]) => void;
  setDragPreviewShotIds: (shotIds: string[]) => void;
};

export const useStoryboardDragSessionController = ({
  openPendingShelf,
  orderedShotIds,
  projectRef,
  queueInsertionTargetsFromDrag,
  resetInsertionDragState,
  selectedShotIdsRef,
  selectSingleShot,
  setActiveDialogue,
  setActiveDragType,
  setActiveParkedShotIds,
  setActiveShotIds,
  setDragPreviewShotIds
}: StoryboardDragSessionControllerOptions) => {
  const resetActiveDragState = () => {
    setActiveDragType(undefined);
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setActiveParkedShotIds([]);
    resetInsertionDragState();
  };

  const handleDragStart = (event: DragStartEvent) => {
    resetInsertionDragState();
    const data = event.active.data.current as DragData | undefined;
    setActiveDragType(data?.type);

    if (data?.type === "shot") {
      const movingShotIds = selectedShotIdsRef.current.includes(data.shotId)
        ? selectedShotIdsRef.current
        : [data.shotId];
      setActiveShotIds(movingShotIds);
      setDragPreviewShotIds(
        chooseDragPreviewShotIds({
          activeShotId: data.shotId,
          selectedShotIds: selectedShotIdsRef.current,
          orderedShotIds
        })
      );

      if (!selectedShotIdsRef.current.includes(data.shotId)) {
        selectSingleShot(data.shotId);
      }
    }

    if (data?.type === "parked-shot") {
      setActiveParkedShotIds([data.shotId]);
      openPendingShelf();
    }

    if (data?.type === "dialogue") {
      setActiveDialogue(projectRef.current.dialogues.find((dialogue) => dialogue.id === data.dialogueId));
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    queueInsertionTargetsFromDrag(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    queueInsertionTargetsFromDrag(event);
  };

  const handleDragCancel = () => {
    resetActiveDragState();
  };

  return {
    handleDragCancel,
    handleDragMove,
    handleDragOver,
    handleDragStart,
    resetActiveDragState
  };
};
