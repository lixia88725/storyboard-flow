import type { DragEndEvent } from "@dnd-kit/core";
import {
  bitmapLayersForShot,
  dialogueOverlayBitmapLayerId,
  moveDialogueToShot,
  parkShotGroup,
  reorderShotGroup,
  reorderShots,
  restoreParkedShotGroup,
  sceneDialogueOverlayEnabledForProject,
  sceneMatteModeForProject,
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
  capturePendingScope: () => (() => boolean);
  pendingVersion: () => number;
  pendingTransition: (kind: "park" | "restore", update: (project: Project) => Project, shotIds: string[]) => Promise<boolean>;
  flushInsertionTargetsFromDragEnd: (event: DragEndEvent) => {
    storyboardInsertionTarget: StoryboardInsertionTarget | undefined;
    parkingInsertionTarget: StoryboardInsertionTarget | undefined;
  };
  isDragEndInsideParkingShelf: (event: DragEndEvent) => boolean;
  isDragEndInsideStoryboard: (event: DragEndEvent) => boolean;
  isDragEndPointerInsideStoryboard: (event: DragEndEvent) => boolean;
  inheritSceneMatte: (
    baseProject: Project,
    mode: "expanded" | "embedded" | undefined,
    shotIds: readonly string[],
    options?: {
      dialogueOverlayEnabled?: boolean;
      markFileNamesUnsynced?: boolean;
      recordUndo?: boolean;
      isWorkspaceCurrent?: () => boolean;
      expectedProject?: Project;
      isCurrent?: () => boolean;
    }
  ) => Promise<boolean>;
  projectRef: { current: Project };
  queuePasteAnimation: (kind: "shot" | "layer", sourceId: string, pastedId: string) => void;
  resetActiveDragState: () => void;
  selectedShotIdsRef: { current: string[] };
  selectSingleShot: (shotId: string | undefined) => void;
  setDeleteTarget: (target: DeleteTarget) => void;
  setStatus: (status: string) => void;
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
};

export const useStoryboardDragEndController = ({
  pendingTransition,
  capturePendingScope,
  pendingVersion,
  flushInsertionTargetsFromDragEnd,
  inheritSceneMatte,
  isDragEndInsideParkingShelf,
  isDragEndInsideStoryboard,
  isDragEndPointerInsideStoryboard,
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

  const moveStoryboardsToPending = async (
    activeShotId: string,
    parkingInsertionTarget: StoryboardInsertionTarget | undefined
  ) => {
    const movingShotIds = movingShotIdsForDrag(activeShotId);
    const isCurrent = capturePendingScope();
    setStatus("Moving storyboards to Pending...");
    try {
      const accepted = await pendingTransition(
        "park",
        latest => parkShotGroup(latest, movingShotIds, parkingInsertionTarget ? {
          targetParkedShotId: parkingInsertionTarget.targetShotId,
          placement: parkingInsertionTarget.placement
        } : undefined),
        movingShotIds
      );
      if (!accepted) throw new Error("Pending incomplete; output or persistence was not accepted");
      if (!isCurrent()) return;
      const projectWithPendingFiles = projectRef.current;
      const nextSelectedShot = sortedShots(projectWithPendingFiles.shots)[0];
      selectSingleShot(nextSelectedShot?.id);
      setDeleteTarget({ type: "shot" });
      setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to Pending`);
    } catch (error) {
      if (!isCurrent()) return;
      setStatus(
        `Could not move storyboards to Pending: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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
      void moveStoryboardsToPending(activeData.shotId, dragEndParkingInsertionTarget);
      return;
    }

    if (!overData && !dragEndStoryboardInsertionTarget) {
      return;
    }

    if (
      activeData.type === "shot" &&
      (overData?.type === "parking-zone" || overData?.type === "parked-shot")
    ) {
      void moveStoryboardsToPending(activeData.shotId, dragEndParkingInsertionTarget);
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
      (dragEndStoryboardInsertionTarget || overData?.type === "shot" || overData?.type === "drop-zone" || overData?.type === "empty-board")
    ) {
      const fallbackTargetShotId =
        overData?.type === "shot" || overData?.type === "drop-zone" ? overData.shotId : undefined;
      const emptyBoardDrop = overData?.type === "empty-board";
      // The explicit empty target never inherits a stale nonempty insertion id.
      // Unlike existing shot drops, it requires the actual pointer, not rect overlap.
      if (emptyBoardDrop && !isDragEndPointerInsideStoryboard(event)) {
        return;
      }
      const targetShotId = emptyBoardDrop
        ? undefined
        : dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId && !emptyBoardDrop) {
        return;
      }
      const placement = emptyBoardDrop
        ? "after"
        : dragEndStoryboardInsertionTarget?.placement ?? inferDropPlacementFromDragEnd(event);
      const currentProject = projectRef.current;
      const isCurrent = capturePendingScope();
      const restorePendingStoryboard = async () => {
        try {
          const restoredProject = restoreParkedShotGroup(
            currentProject,
            [activeData.shotId],
            targetShotId ?? { type: "empty-board" },
            placement
          );
          if (restoredProject === currentProject) {
            return;
          }
          setStatus("Restoring storyboard from Pending...");
          const accepted = await pendingTransition(
            "restore",
            latest => restoreParkedShotGroup(latest, [activeData.shotId], targetShotId ?? { type: "empty-board" }, placement),
            [activeData.shotId]
          );
          if (!accepted) throw new Error("Pending restore incomplete; output or persistence was not accepted");
          if (!isCurrent()) return;
          const projectWithRestoredFile = projectRef.current;
          // Read the latest destination scene, excluding the newly restored
          // shot: its old presentation must not decide what it inherits.
          const destinationScene = {
            ...projectWithRestoredFile,
            shots: projectWithRestoredFile.shots.filter(shot => shot.id !== activeData.shotId)
          };
          const inheritedMatteMode = sceneMatteModeForProject(destinationScene);
          const inheritedDialogueOverlayEnabled = sceneDialogueOverlayEnabledForProject(destinationScene);
          const restoredShot = projectWithRestoredFile.shots.find(
            (shot) => shot.id === activeData.shotId
          );
          const restoredShotHasDialogueOverlay = Boolean(
            restoredShot &&
              bitmapLayersForShot(restoredShot).some(
                (layer) => layer.id === dialogueOverlayBitmapLayerId
              )
          );
          const finishRestore = (status = "Storyboard restored from Pending") => {
            if (!isCurrent()) return;
            selectSingleShot(activeData.shotId);
            setDeleteTarget({ type: "shot" });
            setStatus(status);
          };
          if (
            destinationScene.shots.length > 0 &&
            restoredShot &&
            ((inheritedMatteMode && !restoredShot.presentation?.matte) ||
              (!inheritedMatteMode && restoredShot.presentation?.matte) ||
              (Boolean(inheritedMatteMode) &&
                inheritedDialogueOverlayEnabled !== restoredShotHasDialogueOverlay))
          ) {
            const version = pendingVersion();
            const inheritanceProject = projectRef.current;
            const inherited = await inheritSceneMatte(
              projectWithRestoredFile,
              inheritedMatteMode,
              [activeData.shotId],
              {
                dialogueOverlayEnabled: inheritedDialogueOverlayEnabled,
                markFileNamesUnsynced: true,
                recordUndo: false,
                expectedProject: inheritanceProject,
                isWorkspaceCurrent: isCurrent,
                isCurrent: () => isCurrent() && projectRef.current === inheritanceProject
              }
            );
            if (!isCurrent() || pendingVersion() !== version + (inherited ? 1 : 0)) return;
            if (inherited) {
              finishRestore();
            } else {
              finishRestore(
                "Storyboard restored, but scene presentation could not be inherited"
              );
            }
          } else {
            finishRestore();
          }
        } catch (error) {
          if (!isCurrent()) return;
          setStatus(
            `Could not restore storyboard from Pending: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      };
      void restorePendingStoryboard();
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
