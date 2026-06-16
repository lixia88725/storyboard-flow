import { describe, expect, it, vi } from "vitest";
import type {
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent
} from "@dnd-kit/core";
import type { Project } from "../shared/types";
import { useStoryboardDragSessionController } from "./storyboardDragSessionController";
import type { DragData } from "./storyboardDnd";

const project = (): Project =>
  ({
    id: "project",
    name: "Project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    shots: [
      { id: "shot-a", imagePath: "/scene/a.tiff", fileName: "a.tiff", order: 0 },
      { id: "shot-b", imagePath: "/scene/b.tiff", fileName: "b.tiff", order: 1 },
      { id: "shot-c", imagePath: "/scene/c.tiff", fileName: "c.tiff", order: 2 }
    ],
    dialogues: [
      { id: "dialogue-a", shotId: "shot-a", text: "Hello", order: 0 }
    ]
  }) as Project;

const dragStartEvent = (data: DragData | undefined): DragStartEvent =>
  ({ active: { data: { current: data } } } as DragStartEvent);

const setupController = ({
  selectedShotIds = ["shot-a", "shot-c"]
}: {
  selectedShotIds?: string[];
} = {}) => {
  const activeDragTypes: Array<DragData["type"] | undefined> = [];
  const activeDialogueIds: Array<string | undefined> = [];
  const activeShotIdsByCall: string[][] = [];
  const dragPreviewShotIdsByCall: string[][] = [];
  const activeParkedShotIdsByCall: string[][] = [];
  const selectedShotIdsByCall: Array<string | undefined> = [];
  const resetInsertionDragState = vi.fn();
  const queueInsertionTargetsFromDrag = vi.fn();
  const openPendingShelf = vi.fn();

  const controller = useStoryboardDragSessionController({
    orderedShotIds: ["shot-a", "shot-b", "shot-c"],
    openPendingShelf,
    projectRef: { current: project() },
    queueInsertionTargetsFromDrag,
    resetInsertionDragState,
    selectedShotIdsRef: { current: selectedShotIds },
    selectSingleShot: (shotId) => selectedShotIdsByCall.push(shotId),
    setActiveDialogue: (dialogue) => activeDialogueIds.push(dialogue?.id),
    setActiveDragType: (dragType) => activeDragTypes.push(dragType),
    setActiveParkedShotIds: (shotIds) => activeParkedShotIdsByCall.push(shotIds),
    setActiveShotIds: (shotIds) => activeShotIdsByCall.push(shotIds),
    setDragPreviewShotIds: (shotIds) => dragPreviewShotIdsByCall.push(shotIds)
  });

  return {
    activeDialogueIds,
    activeDragTypes,
    activeParkedShotIdsByCall,
    activeShotIdsByCall,
    controller,
    dragPreviewShotIdsByCall,
    openPendingShelf,
    queueInsertionTargetsFromDrag,
    resetInsertionDragState,
    selectedShotIdsByCall
  };
};

describe("useStoryboardDragSessionController", () => {
  it("starts a selected storyboard drag with ordered multi-shot preview ids", () => {
    const {
      activeDragTypes,
      activeShotIdsByCall,
      controller,
      dragPreviewShotIdsByCall,
      resetInsertionDragState,
      selectedShotIdsByCall
    } = setupController();

    controller.handleDragStart(dragStartEvent({ type: "shot", shotId: "shot-c" }));

    expect(resetInsertionDragState).toHaveBeenCalledTimes(1);
    expect(activeDragTypes).toEqual(["shot"]);
    expect(activeShotIdsByCall).toEqual([["shot-a", "shot-c"]]);
    expect(dragPreviewShotIdsByCall).toEqual([["shot-a", "shot-c"]]);
    expect(selectedShotIdsByCall).toEqual([]);
  });

  it("selects an unselected storyboard before starting its drag preview", () => {
    const {
      activeShotIdsByCall,
      controller,
      dragPreviewShotIdsByCall,
      selectedShotIdsByCall
    } = setupController();

    controller.handleDragStart(dragStartEvent({ type: "shot", shotId: "shot-b" }));

    expect(activeShotIdsByCall).toEqual([["shot-b"]]);
    expect(dragPreviewShotIdsByCall).toEqual([["shot-b"]]);
    expect(selectedShotIdsByCall).toEqual(["shot-b"]);
  });

  it("opens the pending shelf and tracks a parked storyboard drag", () => {
    const {
      activeDragTypes,
      activeParkedShotIdsByCall,
      controller,
      openPendingShelf
    } = setupController();

    controller.handleDragStart(dragStartEvent({ type: "parked-shot", shotId: "parked-a" }));

    expect(activeDragTypes).toEqual(["parked-shot"]);
    expect(activeParkedShotIdsByCall).toEqual([["parked-a"]]);
    expect(openPendingShelf).toHaveBeenCalledTimes(1);
  });

  it("sets the active dialogue overlay from project state", () => {
    const { activeDialogueIds, controller } = setupController();

    controller.handleDragStart(
      dragStartEvent({ type: "dialogue", dialogueId: "dialogue-a", shotId: "shot-a" })
    );

    expect(activeDialogueIds).toEqual(["dialogue-a"]);
  });

  it("delegates drag move and over events to insertion target queuing", () => {
    const { controller, queueInsertionTargetsFromDrag } = setupController();
    const moveEvent = { active: { data: { current: { type: "shot", shotId: "shot-a" } } } } as unknown as DragMoveEvent;
    const overEvent = { active: { data: { current: { type: "shot", shotId: "shot-a" } } } } as unknown as DragOverEvent;

    controller.handleDragMove(moveEvent);
    controller.handleDragOver(overEvent);

    expect(queueInsertionTargetsFromDrag).toHaveBeenNthCalledWith(1, moveEvent);
    expect(queueInsertionTargetsFromDrag).toHaveBeenNthCalledWith(2, overEvent);
  });

  it("clears active drag state on cancel", () => {
    const {
      activeDialogueIds,
      activeDragTypes,
      activeParkedShotIdsByCall,
      activeShotIdsByCall,
      controller,
      dragPreviewShotIdsByCall,
      resetInsertionDragState
    } = setupController();

    controller.handleDragCancel();

    expect(activeDragTypes).toEqual([undefined]);
    expect(activeDialogueIds).toEqual([undefined]);
    expect(activeShotIdsByCall).toEqual([[]]);
    expect(dragPreviewShotIdsByCall).toEqual([[]]);
    expect(activeParkedShotIdsByCall).toEqual([[]]);
    expect(resetInsertionDragState).toHaveBeenCalledTimes(1);
  });
});
