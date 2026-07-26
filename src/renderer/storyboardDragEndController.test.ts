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
  const inheritSceneMatte = vi.fn(async (baseProject: Project) => {
    projectRef.current = baseProject;
    return true;
  });
  const flushInsertionTargetsFromDragEnd = vi.fn(() => ({
    storyboardInsertionTarget,
    parkingInsertionTarget
  }));

  const controller = useStoryboardDragEndController({
    flushInsertionTargetsFromDragEnd,
    inheritSceneMatte,
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
    inheritSceneMatte,
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

  it("inherits the active scene matte when restoring an unconfigured parked storyboard", async () => {
    const activeShot = {
      ...shot("shot-a", 0),
      presentation: {
        matte: { mode: "expanded" as const, top: 75, bottom: 75, sourceHeight: 1080 }
      }
    };
    const {
      controller,
      inheritSceneMatte,
      selectedShotIdsByCall,
      statuses
    } = setupController({
      project: projectWithShots({
        shots: [activeShot, shot("shot-b", 1)],
        parkedShots: [shot("parked-a", 0)]
      }),
      storyboardInsertionTarget: { targetShotId: "shot-b", placement: "before" }
    });

    controller.handleDragEnd(
      dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" } })
    );
    await vi.waitFor(() => expect(inheritSceneMatte).toHaveBeenCalledOnce());

    expect(inheritSceneMatte).toHaveBeenCalledWith(
      expect.objectContaining({
        shots: expect.arrayContaining([expect.objectContaining({ id: "parked-a" })])
      }),
      "expanded",
      ["parked-a"],
      {
        dialogueOverlayEnabled: false,
        markFileNamesUnsynced: true,
        recordUndo: true
      }
    );
    expect(selectedShotIdsByCall).toEqual(["parked-a"]);
    expect(statuses).toEqual(["Storyboard restored from pending"]);
  });

  it("removes a parked storyboard matte when restoring it into a matte-off scene", async () => {
    const parkedShot = {
      ...shot("parked-a", 0),
      presentation: {
        matte: { mode: "embedded" as const, top: 75, bottom: 75 }
      }
    };
    const { controller, inheritSceneMatte } = setupController({
      project: projectWithShots({
        shots: [shot("shot-a", 0), shot("shot-b", 1)],
        parkedShots: [parkedShot]
      }),
      storyboardInsertionTarget: { targetShotId: "shot-b", placement: "before" }
    });

    controller.handleDragEnd(
      dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" } })
    );
    await vi.waitFor(() => expect(inheritSceneMatte).toHaveBeenCalledOnce());

    expect(inheritSceneMatte).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      ["parked-a"],
      {
        dialogueOverlayEnabled: false,
        markFileNamesUnsynced: true,
        recordUndo: true
      }
    );
  });

  it("inherits an enabled scene dialogue overlay when restoring a parked storyboard", async () => {
    const systemLayers = (shotId: string) => [
      {
        id: "layer-matte-overlay",
        kind: "paint" as const,
        name: "Matte Overlay",
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: "normal" as const,
        order: 0,
        bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-matte-overlay.png`,
        width: 1920,
        height: 1080
      },
      {
        id: "layer-dialogue-overlay",
        kind: "paint" as const,
        name: "Dialogue Overlay",
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: "normal" as const,
        order: 1,
        bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-dialogue-overlay.png`,
        width: 1920,
        height: 1080
      }
    ];
    const configuredShot = (id: string, order: number) => ({
      ...shot(id, order),
      layers: systemLayers(id),
      presentation: {
        matte: { mode: "embedded" as const, top: 75, bottom: 75 }
      }
    });
    const parkedShot = {
      ...shot("parked-a", 0),
      presentation: {
        matte: { mode: "embedded" as const, top: 75, bottom: 75 }
      }
    };
    const { controller, inheritSceneMatte } = setupController({
      project: projectWithShots({
        shots: [configuredShot("shot-a", 0), configuredShot("shot-b", 1)],
        parkedShots: [parkedShot]
      }),
      storyboardInsertionTarget: { targetShotId: "shot-b", placement: "before" }
    });

    controller.handleDragEnd(
      dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" } })
    );
    await vi.waitFor(() => expect(inheritSceneMatte).toHaveBeenCalledOnce());

    expect(inheritSceneMatte).toHaveBeenCalledWith(
      expect.any(Object),
      "embedded",
      ["parked-a"],
      expect.objectContaining({ dialogueOverlayEnabled: true })
    );
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
