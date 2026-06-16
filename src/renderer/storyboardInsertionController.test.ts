import { describe, expect, it } from "vitest";
import {
  parkingInsertionDragRequest,
  storyboardInsertionDragRequest
} from "./storyboardInsertionController";
import type { DragData } from "./storyboardDnd";

const shotDrag = (shotId: string): DragData => ({ type: "shot", shotId });
const parkedShotDrag = (shotId: string): DragData => ({ type: "parked-shot", shotId });
const dialogueDrag = (): DragData => ({ type: "dialogue", shotId: "shot-a", dialogueId: "dialogue-a" });

describe("storyboard insertion controller", () => {
  it("queues selected storyboard ids while dragging a selected shot over the board", () => {
    expect(
      storyboardInsertionDragRequest({
        activeData: shotDrag("shot-b"),
        fallbackPointer: { x: 10, y: 20 },
        isAnimationMode: false,
        isPointerInsideBoard: true,
        isPointerInsideParkingList: false,
        lastPointer: undefined,
        selectedShotIds: ["shot-a", "shot-b"]
      })
    ).toEqual({
      type: "queue",
      pointer: { x: 10, y: 20 },
      movingShotIds: ["shot-a", "shot-b"]
    });
  });

  it("clears the storyboard indicator when a parked shot is outside the board", () => {
    expect(
      storyboardInsertionDragRequest({
        activeData: parkedShotDrag("parked-a"),
        fallbackPointer: { x: 10, y: 20 },
        isAnimationMode: false,
        isPointerInsideBoard: false,
        isPointerInsideParkingList: false,
        lastPointer: undefined,
        selectedShotIds: ["shot-a"]
      })
    ).toEqual({ type: "clear" });
  });

  it("resets storyboard insertion state for non-storyboard drags or animation mode", () => {
    expect(
      storyboardInsertionDragRequest({
        activeData: dialogueDrag(),
        fallbackPointer: { x: 10, y: 20 },
        isAnimationMode: false,
        isPointerInsideBoard: true,
        isPointerInsideParkingList: false,
        lastPointer: undefined,
        selectedShotIds: ["shot-a"]
      })
    ).toEqual({ type: "reset" });
    expect(
      storyboardInsertionDragRequest({
        activeData: shotDrag("shot-a"),
        fallbackPointer: { x: 10, y: 20 },
        isAnimationMode: true,
        isPointerInsideBoard: true,
        isPointerInsideParkingList: false,
        lastPointer: undefined,
        selectedShotIds: ["shot-a"]
      })
    ).toEqual({ type: "reset" });
  });

  it("queues parking insertion only for storyboard drags inside the parking list", () => {
    expect(
      parkingInsertionDragRequest({
        activeData: shotDrag("shot-a"),
        fallbackPointer: { x: 10, y: 20 },
        isPointerInsideParkingList: true,
        lastPointer: undefined
      })
    ).toEqual({
      type: "queue",
      pointer: { x: 10, y: 20 },
      movingShotIds: []
    });
    expect(
      parkingInsertionDragRequest({
        activeData: parkedShotDrag("parked-a"),
        fallbackPointer: { x: 10, y: 20 },
        isPointerInsideParkingList: true,
        lastPointer: undefined
      })
    ).toEqual({ type: "reset" });
    expect(
      parkingInsertionDragRequest({
        activeData: shotDrag("shot-a"),
        fallbackPointer: { x: 10, y: 20 },
        isPointerInsideParkingList: false,
        lastPointer: undefined
      })
    ).toEqual({ type: "clear" });
  });
});
