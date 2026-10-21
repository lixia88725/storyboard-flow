import { describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Project, Shot } from "../shared/types";
import { useStoryboardDragEndController } from "./storyboardDragEndController";
import type { DeleteTarget } from "./deleteTarget";
import type { DragData, StoryboardInsertionTarget } from "./storyboardDnd";
import { dragEndInsideSelector, isPointerInsideElement } from "./dragHitTesting";
import { createShotPresentationController } from "./shotPresentationController";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";

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
    active: { data: { current: activeData }, rect: { current: { translated: null, initial: null } } },
    over: overData ? { data: { current: overData } } : undefined
  }) as unknown as DragEndEvent;

const setupController = ({
  isInsideParkingShelf = false,
  isInsideStoryboard = true,
  pointerHitTest,
  transitionResult = "accepted",
  parkingInsertionTarget,
  project,
  selectedShotIds = [],
  storyboardInsertionTarget
}: {
  isInsideParkingShelf?: boolean;
  isInsideStoryboard?: boolean;
  pointerHitTest?: (event: DragEndEvent) => boolean;
  transitionResult?: "accepted" | "incomplete" | "rejected";
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
  let version = 0;
  const inheritSceneMatte = vi.fn(async (baseProject: Project) => {
    version++;
    projectRef.current = baseProject;
    return true;
  });
  const flushInsertionTargetsFromDragEnd = vi.fn(() => ({
    storyboardInsertionTarget,
    parkingInsertionTarget
  }));

  // This boundary stands in for the domain operation, not its IO/ACK policy.
  // normalSavePending* and Electron smoke exercise the real adapter/runtime.
  const pendingTransition = vi.fn(async (_kind: "park" | "restore", update: (p: Project) => Project, _ids: string[]) => {
    if (transitionResult === "rejected") throw new Error("required persistence failed");
    if (transitionResult === "incomplete") return false;
    projectRef.current = update(projectRef.current);
    version++;
    return true;
  });
  const controller = useStoryboardDragEndController({
    pendingTransition,
    capturePendingScope: () => () => true,
    pendingVersion: () => version,
    flushInsertionTargetsFromDragEnd,
    inheritSceneMatte,
    isDragEndInsideParkingShelf: () => isInsideParkingShelf,
    isDragEndInsideStoryboard: () => isInsideStoryboard,
    ...{ isDragEndPointerInsideStoryboard: pointerHitTest ?? (() => isInsideStoryboard) },
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
    pendingTransition,
    selectedShotIdsByCall,
    statuses
  };
};

describe("useStoryboardDragEndController", () => {
  it.each([
    { mode: "embedded" as const, dialogue: false },
    { mode: "embedded" as const, dialogue: true },
    { mode: "expanded" as const, dialogue: false },
    { mode: "expanded" as const, dialogue: true }
  ])("preserves $mode presentation with dialogue=$dialogue when restoring into no scene", async ({ mode, dialogue }) => {
    const parked: Shot = {
      ...shot("parked-a", 0),
      presentation: { matte: { mode, top: 75, bottom: 75, ...(mode === "expanded" ? { sourceHeight: 1080 } : {}) } },
      layers: dialogue ? [{ id: "layer-dialogue-overlay", kind: "paint", name: "Dialogue", visible: true,
        locked: true, opacity: 1, blendMode: "normal", order: 0,
        bitmapPath: ".storyboard-workbench/layers/parked-a/layer-dialogue-overlay.png", width: 1920, height: 1080 }] : []
    };
    const f = setupController({ project: projectWithShots({ shots: [], parkedShots: [parked] }) });
    f.controller.handleDragEnd(dragEndEvent({ activeData: { type: "parked-shot", shotId: parked.id }, overData: { type: "empty-board" } }));
    await vi.waitFor(() => expect(f.pendingTransition).toHaveBeenCalledOnce());
    expect(f.inheritSceneMatte).not.toHaveBeenCalled();
    expect(f.projectRef.current.shots[0].presentation).toEqual(parked.presentation);
    expect(f.projectRef.current.shots[0].layers).toEqual(parked.layers);
    expect(f.selectedShotIdsByCall).toEqual([parked.id]);
    expect(f.deleteTargets).toEqual([{ type: "shot" }]);
    expect(f.statuses.at(-1)).toBe("Storyboard restored from Pending");
  });

  it("does not enter real presentation asset deletion when restoring a matted shot into an empty board", async () => {
    const parked: Shot = {
      ...shot("parked-a", 0),
      presentation: { matte: { mode: "embedded", top: 75, bottom: 75 } },
      layers: ["layer-matte-overlay", "layer-dialogue-overlay"].map((id, order) => ({
        id, kind: "paint", name: id, visible: true, locked: true, opacity: 1,
        blendMode: "normal", order, bitmapPath: `.storyboard-workbench/layers/parked-a/${id}.png`, width: 1920, height: 1080
      }))
    };
    const f = setupController({ project: projectWithShots({ shots: [], parkedShots: [parked] }) });
    const writeLayerPng = vi.fn(), deleteLayerPng = vi.fn(), updateProject = vi.fn();
    const presentation = createShotPresentationController({
      api: { writeLayerPng, deleteLayerPng } as unknown as Window["storyboard"],
      bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
      createHistoryEntry: async () => ({ project: f.projectRef.current, selectedShotIds: [], fileNameSyncState: "synced" }),
      folderPath: "/scene", metadataPath: "/scene/p.json", projectRef: f.projectRef,
      markShotsDirty: vi.fn(), recordUndoEntry: vi.fn(), setStatus: vi.fn(),
      shotPresentationActionRef: { current: undefined }, updateProject
    });
    f.inheritSceneMatte.mockImplementation(p => presentation.handleInheritSceneMatte(p, undefined, [parked.id], { recordUndo: false }));
    f.controller.handleDragEnd(dragEndEvent({ activeData: { type: "parked-shot", shotId: parked.id }, overData: { type: "empty-board" } }));
    await vi.waitFor(() => expect(f.pendingTransition).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(f.inheritSceneMatte).not.toHaveBeenCalled();
    expect(writeLayerPng).not.toHaveBeenCalled();
    expect(deleteLayerPng).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
    expect(f.projectRef.current.shots[0].presentation).toEqual(parked.presentation);
    expect(f.selectedShotIdsByCall).toEqual([parked.id]);
  });

  it.each(["park", "restore"] as const)("keeps %s failure out of success UI for false and rejected domain results", async kind => {
    for (const transitionResult of ["incomplete", "rejected"] as const) {
      const project = projectWithShots({
        shots: kind === "park" ? [shot("shot-a", 0)] : [],
        parkedShots: kind === "restore" ? [shot("parked-a", 0)] : []
      });
      const f = setupController({ project, transitionResult, isInsideParkingShelf: kind === "park" });
      f.controller.handleDragEnd(dragEndEvent({
        activeData: { type: kind === "park" ? "shot" : "parked-shot", shotId: kind === "park" ? "shot-a" : "parked-a" },
        overData: { type: kind === "park" ? "parking-zone" : "empty-board" }
      }));
      await vi.waitFor(() => expect(f.statuses.at(-1)).toContain("Could not"));
      expect(f.projectRef.current).toBe(project);
      expect(f.selectedShotIdsByCall).toEqual([]);
      expect(f.deleteTargets).toEqual([]);
      expect(f.inheritSceneMatte).not.toHaveBeenCalled();
      expect(f.pendingTransition).toHaveBeenCalledOnce();
    }
  });

  it("moves selected storyboards into pending when dropped inside the pending shelf", async () => {
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
    await vi.waitFor(() => expect(projectRef.current.shots).toHaveLength(1));

    expect(resetActiveDragState).toHaveBeenCalledTimes(1);
    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(projectRef.current.parkedShots?.map((item) => item.id)).toEqual(["shot-b", "shot-c"]);
    expect(selectedShotIdsByCall).toEqual(["shot-a"]);
    expect(deleteTargets).toEqual([{ type: "shot" }]);
    expect(statuses).toEqual([
      "Moving storyboards to Pending...",
      "2 storyboards moved to Pending"
    ]);
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

  it("rejects an outside pointer even when the dragged rect overlaps the empty board", async () => {
    const board = { getBoundingClientRect: () => ({ left: 80, right: 1300, top: 70, bottom: 900 }) } as HTMLElement;
    const pointer = { x: 35, y: 50 };
    const event = dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" }, overData: { type: "empty-board" } });
    event.active.rect.current.translated = { left: 20, right: 220, top: 30, bottom: 150, width: 200, height: 120 } as typeof event.active.rect.current.translated;
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("document", { querySelector: () => board, elementFromPoint: () => null });
    try {
      expect(dragEndInsideSelector(event, ".workspace-board-scroll", pointer)).toBe(true);
      expect(isPointerInsideElement(board, pointer)).toBe(false);
      const project = projectWithShots({ shots: [], parkedShots: [shot("parked-a", 0)] });
      const setup = setupController({ project, pointerHitTest: () => isPointerInsideElement(board, pointer) });
      setup.controller.handleDragEnd(event);
      await Promise.resolve();
      expect(setup.pendingTransition).not.toHaveBeenCalled();
      expect(setup.projectRef.current).toBe(project);
      expect(setup.statuses).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    { pointer: undefined, restore: false, name: "missing point" },
    { pointer: { x: NaN, y: 100 }, restore: false, name: "nonfinite point" },
    { pointer: { x: 35, y: 50 }, restore: false, name: "outside point with stale target" },
    { pointer: { x: 400, y: 300 }, restore: true, name: "inside point with stale target" }
  ])("uses strict empty geometry for $name", async ({ pointer, restore }) => {
    const board = { getBoundingClientRect: () => ({ left: 80, right: 1300, top: 70, bottom: 900 }) } as HTMLElement;
    const project = projectWithShots({ shots: [], parkedShots: [shot("parked-a", 0)] });
    const setup = setupController({
      project,
      storyboardInsertionTarget: { targetShotId: "stale-shot", placement: "before" },
      pointerHitTest: () => pointer ? isPointerInsideElement(board, pointer) : false
    });
    setup.controller.handleDragEnd(dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" }, overData: { type: "empty-board" } }));
    if (restore) {
      await vi.waitFor(() => expect(setup.projectRef.current.shots.map(s => s.id)).toEqual(["parked-a"]));
      expect(setup.pendingTransition).toHaveBeenCalledOnce();
    } else {
      await Promise.resolve();
      expect(setup.pendingTransition).not.toHaveBeenCalled();
      expect(setup.projectRef.current).toBe(project);
      expect(setup.statuses).toEqual([]);
    }
  });

  it("preserves nonempty drop-zone restoration even when the strict pointer check rejects", async () => {
    const setup = setupController({ project: projectWithShots({ shots: [shot("shot-a", 0)], parkedShots: [shot("parked-a", 0)] }), pointerHitTest: () => false });
    setup.controller.handleDragEnd(dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" }, overData: { type: "drop-zone", shotId: "shot-a" } }));
    await vi.waitFor(() => expect(setup.pendingTransition).toHaveBeenCalledOnce());
  });

  it("restores from Pending into the explicit empty-board drop through the Pending domain", async () => {
    const original = projectWithShots({ shots: [shot("shot-a", 0)] });
    const parked = setupController({ project: original, isInsideParkingShelf: true });
    parked.controller.handleDragEnd(dragEndEvent({ activeData: { type: "shot", shotId: "shot-a" } }));
    await vi.waitFor(() => expect(parked.projectRef.current.shots).toEqual([]));
    const restored = setupController({ project: parked.projectRef.current });
    restored.controller.handleDragEnd(dragEndEvent({
      activeData: { type: "parked-shot", shotId: "shot-a" },
      overData: { type: "empty-board" }
    }));
    await vi.waitFor(() => expect(restored.projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]));
    expect(restored.projectRef.current.parkedShots).toBeUndefined();
    expect(restored.projectRef.current.dialogues).toEqual(original.dialogues);
    expect(restored.pendingTransition).toHaveBeenCalledWith("restore", expect.any(Function), ["shot-a"]);
    expect(restored.selectedShotIdsByCall).toEqual(["shot-a"]);
    expect(restored.statuses.at(-1)).toBe("Storyboard restored from Pending");
  });

  it.each([
    { name: "outside board", shots: [], overData: { type: "empty-board" }, inside: false },
    { name: "no explicit empty target", shots: [], overData: undefined, inside: true },
    { name: "nonempty board", shots: [shot("shot-a", 0)], overData: { type: "empty-board" }, inside: true },
    { name: "missing nonempty target", shots: [shot("shot-a", 0)], overData: { type: "shot", shotId: "missing" }, inside: true }
  ])("rejects $name without file movement or a misleading restoring status", async ({ shots, overData, inside }) => {
    const project = projectWithShots({ shots, parkedShots: [shot("parked-a", 0)] });
    const setup = setupController({ project, isInsideStoryboard: inside });
    setup.controller.handleDragEnd(dragEndEvent({
      activeData: { type: "parked-shot", shotId: "parked-a" },
      overData: overData as DragData | undefined
    }));
    await Promise.resolve();
    expect(setup.projectRef.current).toBe(project);
    expect(setup.pendingTransition).not.toHaveBeenCalled();
    expect(setup.selectedShotIdsByCall).toEqual([]);
    expect(setup.statuses).toEqual([]);
  });

  it("restores a parked storyboard before the target storyboard", async () => {
    const { controller, deleteTargets, projectRef, selectedShotIdsByCall, statuses } = setupController({
      project: projectWithShots({
        shots: [shot("shot-a", 0), shot("shot-b", 1)],
        parkedShots: [shot("parked-a", 0)]
      }),
      storyboardInsertionTarget: { targetShotId: "shot-b", placement: "before" }
    });

    controller.handleDragEnd(dragEndEvent({ activeData: { type: "parked-shot", shotId: "parked-a" } }));
    await vi.waitFor(() => expect(projectRef.current.shots).toHaveLength(3));

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a", "parked-a", "shot-b"]);
    expect(projectRef.current.parkedShots).toBeUndefined();
    expect(selectedShotIdsByCall).toEqual(["parked-a"]);
    expect(deleteTargets).toEqual([{ type: "shot" }]);
    expect(statuses).toEqual([
      "Restoring storyboard from Pending...",
      "Storyboard restored from Pending"
    ]);
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
        recordUndo: false,
        expectedProject: expect.any(Object),
        isWorkspaceCurrent: expect.any(Function),
        isCurrent: expect.any(Function)
      }
    );
    expect(selectedShotIdsByCall).toEqual(["parked-a"]);
    expect(statuses).toEqual([
      "Restoring storyboard from Pending...",
      "Storyboard restored from Pending"
    ]);
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
        recordUndo: false,
        expectedProject: expect.any(Object),
        isWorkspaceCurrent: expect.any(Function),
        isCurrent: expect.any(Function)
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
