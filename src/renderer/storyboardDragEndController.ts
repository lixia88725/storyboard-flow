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
  sortedShots,
  type ShotPlacement
} from "../shared/projectOps";
import type { Project } from "../shared/types";
import type { DeleteTarget } from "./deleteTarget";
import { projectWithShotFileReferences } from "./pendingShotFileController";
import {
  inferDropPlacementFromDragEnd,
  inferShotPlacement,
  type DragData,
  type StoryboardInsertionTarget
} from "./storyboardDnd";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

export type StoryboardDragEndControllerOptions = {
  clearShotsDirty: (shotIds: string[]) => void;
  flushInsertionTargetsFromDragEnd: (event: DragEndEvent) => {
    storyboardInsertionTarget: StoryboardInsertionTarget | undefined;
    parkingInsertionTarget: StoryboardInsertionTarget | undefined;
  };
  isDragEndInsideParkingShelf: (event: DragEndEvent) => boolean;
  isDragEndInsideStoryboard: (event: DragEndEvent) => boolean;
  inheritSceneMatte: (
    baseProject: Project,
    mode: "expanded" | "embedded" | undefined,
    shotIds: readonly string[],
    options?: {
      dialogueOverlayEnabled?: boolean;
      markFileNamesUnsynced?: boolean;
      recordUndo?: boolean;
    }
  ) => Promise<boolean>;
  projectRef: { current: Project };
  moveShotFilesToPending: (project: Project, shotIds: string[]) => Promise<Project>;
  promoteAiCandidateToStoryboard: (
    candidateId: string,
    targetShotId: string | undefined,
    placement: ShotPlacement
  ) => Promise<void>;
  queuePasteAnimation: (kind: "shot" | "layer", sourceId: string, pastedId: string) => void;
  resetHistoryStacks: () => void;
  restoreShotFilesFromPending: (project: Project, shotIds: string[]) => Promise<Project>;
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
  clearShotsDirty,
  flushInsertionTargetsFromDragEnd,
  inheritSceneMatte,
  isDragEndInsideParkingShelf,
  isDragEndInsideStoryboard,
  moveShotFilesToPending,
  projectRef,
  promoteAiCandidateToStoryboard,
  queuePasteAnimation,
  resetActiveDragState,
  resetHistoryStacks,
  restoreShotFilesFromPending,
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
    const initialProject = projectRef.current;
    setStatus("Moving storyboards to Pending...");
    try {
      const parkedProject = parkShotGroup(
        initialProject,
        movingShotIds,
        parkingInsertionTarget
          ? {
              targetParkedShotId: parkingInsertionTarget.targetShotId,
              placement: parkingInsertionTarget.placement
            }
          : undefined
      );
      const projectWithPendingFiles = await moveShotFilesToPending(parkedProject, movingShotIds);
      if (projectRef.current !== initialProject) {
        await restoreShotFilesFromPending(
          projectWithShotFileReferences(projectRef.current, projectWithPendingFiles, movingShotIds),
          movingShotIds
        );
        throw new Error("the storyboard changed while Pending was being prepared");
      }
      updateProject(projectWithPendingFiles, true, false);
      clearShotsDirty(movingShotIds);
      resetHistoryStacks();
      const nextSelectedShot = sortedShots(projectWithPendingFiles.shots)[0];
      selectSingleShot(nextSelectedShot?.id);
      setDeleteTarget({ type: "shot" });
      setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to Pending`);
    } catch (error) {
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

    if (activeData.type === "ai-candidate") {
      const fallbackTargetShotId =
        overData?.type === "shot" || overData?.type === "drop-zone"
          ? overData.shotId
          : undefined;
      const targetShotId =
        dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId && !isDragEndInsideStoryboard(event)) {
        return;
      }
      const placement =
        dragEndStoryboardInsertionTarget?.placement ??
        (targetShotId ? inferDropPlacementFromDragEnd(event) : "after");
      void promoteAiCandidateToStoryboard(activeData.candidateId, targetShotId, placement);
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
      (dragEndStoryboardInsertionTarget || overData?.type === "shot" || overData?.type === "drop-zone")
    ) {
      const fallbackTargetShotId =
        overData?.type === "shot" || overData?.type === "drop-zone" ? overData.shotId : undefined;
      const targetShotId = dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId) {
        return;
      }
      const placement = dragEndStoryboardInsertionTarget?.placement ?? inferDropPlacementFromDragEnd(event);
      const currentProject = projectRef.current;
      const inheritedMatteMode = sceneMatteModeForProject(currentProject);
      const inheritedDialogueOverlayEnabled =
        sceneDialogueOverlayEnabledForProject(currentProject);
      const restorePendingStoryboard = async () => {
        setStatus("Restoring storyboard from Pending...");
        try {
          const restoredProject = restoreParkedShotGroup(
            currentProject,
            [activeData.shotId],
            targetShotId,
            placement
          );
          const projectWithRestoredFile = await restoreShotFilesFromPending(
            restoredProject,
            [activeData.shotId]
          );
          if (projectRef.current !== currentProject) {
            await moveShotFilesToPending(
              projectWithShotFileReferences(
                projectRef.current,
                projectWithRestoredFile,
                [activeData.shotId]
              ),
              [activeData.shotId]
            );
            throw new Error("the storyboard changed while Pending was being restored");
          }
          updateProject(projectWithRestoredFile, true, false);
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
            resetHistoryStacks();
            selectSingleShot(activeData.shotId);
            setDeleteTarget({ type: "shot" });
            setStatus(status);
          };
          if (
            restoredShot &&
            ((inheritedMatteMode && !restoredShot.presentation?.matte) ||
              (!inheritedMatteMode && restoredShot.presentation?.matte) ||
              (Boolean(inheritedMatteMode) &&
                inheritedDialogueOverlayEnabled !== restoredShotHasDialogueOverlay))
          ) {
            const inherited = await inheritSceneMatte(
              projectWithRestoredFile,
              inheritedMatteMode,
              [activeData.shotId],
              {
                dialogueOverlayEnabled: inheritedDialogueOverlayEnabled,
                markFileNamesUnsynced: true,
                recordUndo: false
              }
            );
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
