import type { DragEndEvent } from "@dnd-kit/core";
import {
  moveDialogueToShot,
  parkShotGroup,
  reorderShotGroup,
  reorderShots,
  restoreParkedShotGroup,
  sortedShots
} from "../shared/projectOps";
import type { Project } from "../shared/types";
import type { DeleteTarget } from "./deleteTarget";
import {
  inferDropPlacementFromDragEnd,
  inferShotPlacement,
  type DragData,
  type StoryboardInsertionTarget
} from "./storyboardDnd";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

export type StoryboardDragEndControllerOptions = {
  flushInsertionTargetsFromDragEnd: (event: DragEndEvent) => {
    storyboardInsertionTarget: StoryboardInsertionTarget | undefined;
    parkingInsertionTarget: StoryboardInsertionTarget | undefined;
  };
  isDragEndInsideParkingShelf: (event: DragEndEvent) => boolean;
  projectRef: { current: Project };
  queuePasteAnimation: (kind: "shot" | "layer", sourceId: string, pastedId: string) => void;
  resetActiveDragState: () => void;
  selectedShotIdsRef: { current: string[] };
  selectSingleShot: (shotId: string | undefined) => void;
  setDeleteTarget: (target: DeleteTarget) => void;
  setStatus: (status: string) => void;
  updateProject: (projectUpdate: ProjectUpdate) => void;
};

export const useStoryboardDragEndController = ({
  flushInsertionTargetsFromDragEnd,
  isDragEndInsideParkingShelf,
  projectRef,
  queuePasteAnimation,
  resetActiveDragState,
  selectedShotIdsRef,
  selectSingleShot,
  setDeleteTarget,
  setStatus,
  updateProject
}: StoryboardDragEndControllerOptions) => {
  const movingShotIdsForDrag = (shotId: string) =>
    selectedShotIdsRef.current.includes(shotId) ? selectedShotIdsRef.current : [shotId];

  const moveStoryboardsToPending = (
    activeShotId: string,
    parkingInsertionTarget: StoryboardInsertionTarget | undefined
  ) => {
    const movingShotIds = movingShotIdsForDrag(activeShotId);
    const nextProject = parkShotGroup(
      projectRef.current,
      movingShotIds,
      parkingInsertionTarget
        ? {
            targetParkedShotId: parkingInsertionTarget.targetShotId,
            placement: parkingInsertionTarget.placement
          }
        : undefined
    );
    updateProject(nextProject);
    const nextSelectedShot = sortedShots(nextProject.shots)[0];
    selectSingleShot(nextSelectedShot?.id);
    setDeleteTarget({ type: "shot" });
    setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to pending`);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const {
      storyboardInsertionTarget: dragEndStoryboardInsertionTarget,
      parkingInsertionTarget: dragEndParkingInsertionTarget
    } = flushInsertionTargetsFromDragEnd(event);
    resetActiveDragState();

    const activeData = event.active.data.current as DragData | undefined;
    const overData = event.over?.data.current as DragData | undefined;

    if (!activeData) {
      return;
    }

    if (activeData.type === "shot" && isDragEndInsideParkingShelf(event)) {
      moveStoryboardsToPending(activeData.shotId, dragEndParkingInsertionTarget);
      return;
    }

    if (!overData && !dragEndStoryboardInsertionTarget) {
      return;
    }

    if (
      activeData.type === "shot" &&
      (overData?.type === "parking-zone" || overData?.type === "parked-shot")
    ) {
      moveStoryboardsToPending(activeData.shotId, dragEndParkingInsertionTarget);
      return;
    }

    if (
      activeData.type === "shot" &&
      (dragEndStoryboardInsertionTarget || overData?.type === "shot")
    ) {
      const movingShotIds = movingShotIdsForDrag(activeData.shotId);
      const fallbackTargetShotId = overData?.type === "shot" ? overData.shotId : undefined;
      const targetShotId = dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId) {
        return;
      }
      const currentProject = projectRef.current;
      const placement =
        dragEndStoryboardInsertionTarget?.placement ??
        inferShotPlacement(currentProject, movingShotIds, targetShotId, activeData.shotId);
      const nextProject =
        movingShotIds.length > 1
          ? reorderShotGroup(currentProject, movingShotIds, targetShotId, placement)
          : reorderShots(currentProject, activeData.shotId, targetShotId, placement);
      if (nextProject === currentProject) {
        return;
      }

      queuePasteAnimation("shot", "", "");
      updateProject(nextProject);
    }

    if (
      activeData.type === "parked-shot" &&
      (dragEndStoryboardInsertionTarget || overData?.type === "shot" || overData?.type === "drop-zone")
    ) {
      const fallbackTargetShotId =
        overData?.type === "shot" || overData?.type === "drop-zone" ? overData.shotId : undefined;
      const targetShotId = dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId) {
        return;
      }
      const placement = dragEndStoryboardInsertionTarget?.placement ?? inferDropPlacementFromDragEnd(event);
      const nextProject = restoreParkedShotGroup(projectRef.current, [activeData.shotId], targetShotId, placement);
      updateProject(nextProject);
      selectSingleShot(activeData.shotId);
      setDeleteTarget({ type: "shot" });
      setStatus("Storyboard restored from pending");
    }

    if (activeData.type === "dialogue" && (overData?.type === "shot" || overData?.type === "drop-zone")) {
      const targetShotId = overData.type === "drop-zone" ? overData.shotId : overData.shotId;

      if (targetShotId && targetShotId !== activeData.shotId) {
        updateProject((currentProject) =>
          moveDialogueToShot(currentProject, activeData.dialogueId, targetShotId)
        );
      }
    }
  };

  return { handleDragEnd };
};
