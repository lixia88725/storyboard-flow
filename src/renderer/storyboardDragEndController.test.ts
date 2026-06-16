import { describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Project, Shot } from "../shared/types";
import { useStoryboardDragEndController } from "./storyboardDragEndController";
import type { DeleteTarget } from "./deleteTarget";
import type { DragData, StoryboardInsertionTarget } from "./storyboardDnd";

const shot = (id: string, order: number): Shot =>
  ({
    id,
    imagePath: `/scene/${id}.tiff`,
    fileName: `${id}.tiff`,
    order
  }) as Shot;

const projectWithShots = ({
  parkedShots = [],
  shots
}: {
  parkedShots?: Shot[];
  shots: Shot[];
}): Project =>
  ({
    id: "project",
    name: "Project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    shots,
    parkedShots,
    dialogues: [
      { id: "dialogue-a", shotId: "shot-a", text: "Hello", order: 0 }
    ]
  }) as Project;

const dragEndEvent = ({
  activeData,
  overData
}: {
  activeData?: DragData;
  overData?: DragData;
}): DragEndEvent =>
  ({
    active: { data: { current: activeData } },
    over: overData ? { data: { current: overData } } : undefined
  }) as unknown as DragEndEvent;

const setupController = ({
  isInsideParkingShelf = false,
  parkingInsertionTarget,
  project,
  selectedShotIds = [],
  storyboardInsertionTarget
}: {
  isInsideParkingShelf?: boolean;
  parkingInsertionTarget?: StoryboardInsertionTarget;
  project: Project;
  selectedShotIds?: string[];
  storyboardInsertionTarget?: StoryboardInsertionTarget;
}) => {
  const projectRef = { current: project };
  const selectedShotIdsRef = { current: selectedShotIds };
  const deleteTargets: DeleteTarget[] = [];
  const pasteAnimations: Array<{ kind: "shot" | "layer"; sourceId: string; pastedId: string }> = [];
  const selectedShotIdsByCall: Array<string | undefined> = [];
  const statuses: string[] = [];
  const resetActiveDragState = vi.fn();
  const flushInsertionTargetsFromDragEnd = vi.fn(() => ({
    storyboardInsertionTarget,
    parkingInsertionTarget
  }));

  const controller = useStoryboardDragEndController({
    flushInsertionTargetsFromDragEnd,
    isDragEndInsideParkingShelf: () => isInsideParkingShelf,
    projectRef,
    queuePasteAnimation: (kind, sourceId, pastedId) => {
      pasteAnimations.push({ kind, sourceId, pastedId });
    },
    resetActiveDragState,
    selectedShotIdsRef,
    selectSingleShot: (shotId) => selectedShotIdsByCall.push(shotId),
    setDeleteTarget: (target) => deleteTargets.push(target),
    setStatus: (status) => statuses.push(status),
    updateProject: (projectUpdate) => {
      projectRef.current =
        typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;
    }
  });

  return {
    controller,
    deleteTargets,
    flushInsertionTargetsFromDragEnd,
    pasteAnimations,
    projectRef,
    resetActiveDragState,
    selectedShotIdsByCall,
    statuses
  };
};

describe("useStoryboardDragEndController", () => {
  it("moves selected storyboards into pending when dropped inside the pending shelf", () => {
    const {
      controller,
      deleteTargets,
      projectRef,
      resetActiveDragState,
      selectedShotIdsByCall,
      statuses
    } = setupController({
      isInsideParkingShelf: true,
      project: projectWithShots({ shots: [shot("shot-a", 0), shot("shot-b", 1), shot("shot-c", 2)] }),
      selectedShotIds: ["shot-b", "shot-c"]
    });

    controller.handleDragEnd(dragEndEvent({ activeData: { type: "shot", shotId: "shot-b" } }));

    expect(resetActiveDragState).toHaveBeenCalledTimes(1);
    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(projectRef.current.parkedShots?.map((item) => item.id)).toEqual(["shot-b", "shot-c"]);
    expect(selectedShotIdsByCall).toEqual(["shot-a"]);
    expect(deleteTargets).toEqual([{ type: "shot" }]);
    expect(statuses).toEqual(["2 storyboards moved to pending"]);
  });

  it("reorders selected storyboards using the flushed insertion target", () => {
    const { controller, pasteAnimations, projectRef, statuses } = setupController({
      project: projectWithShots({ shots: [shot("shot-a", 0), shot("shot-b", 1), shot("shot-c", 2)] }),
      selectedShotIds: ["shot-c"],
      storyboardInsertionTarget: { targetShotId: "shot-b", placement: "before" }
    });

    controller.handleDragEnd(dragEndEvent({ activeData: { type: "shot", shotId: "shot-c" } }));

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a", "shot-c", "shot-b"]);
    expect(pasteAnimations).toEqual([{ kind: "shot", sourceId: "", pastedId: "" }]);
    expect(statuses).toEqual([]);
  });

  it("restores a parked storyboard before the target storyboard", () => {
    const { controller, deleteTargets, projectRef, selectedShotIdsByCall, statuses } = setupController({
      project: projectWithShots({
        shots: [shot("shot-a", 0), shot("shot-b", 1)],
        parkedShots: [shot("parked-a", 0)]
      }),
      storyboardInsertionTarget: { targetShotId: "shot-b", placement: "before" }
    });

    controller.handleDragEnd(dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" } }));

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a", "parked-a", "shot-b"]);
    expect(projectRef.current.parkedShots).toBeUndefined();
    expect(selectedShotIdsByCall).toEqual(["parked-a"]);
    expect(deleteTargets).toEqual([{ type: "shot" }]);
    expect(statuses).toEqual(["Storyboard restored from pending"]);
  });

  it("moves dialogue to the drop target storyboard", () => {
    const { controller, projectRef } = setupController({
      project: projectWithShots({ shots: [shot("shot-a", 0), shot("shot-b", 1)] })
    });

    controller.handleDragEnd(
      dragEndEvent({
        activeData: { type: "dialogue", dialogueId: "dialogue-a", shotId: "shot-a" },
        overData: { type: "shot", shotId: "shot-b" }
      })
    );

    expect(projectRef.current.dialogues[0]).toMatchObject({ id: "dialogue-a", shotId: "shot-b" });
  });

  it("only clears drag state when the active drag data is missing", () => {
    const { controller, projectRef, resetActiveDragState } = setupController({
      project: projectWithShots({ shots: [shot("shot-a", 0)] })
    });

    controller.handleDragEnd(dragEndEvent({}));

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(resetActiveDragState).toHaveBeenCalledTimes(1);
  });
});
