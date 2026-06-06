import { describe, expect, it } from "vitest";
import {
  captureParkingDragRects,
  captureStoryboardDragRects,
  dragPreviewShotIds,
  isDialogueDropZoneHighlighted,
  parkingInsertionIndicatorFromCachedRect,
  parkingInsertionTargetFromPointer,
  shouldShowStoryboardInsertionIndicator,
  storyboardInsertionIndicatorFromCachedRect,
  storyboardSortableItemIds,
  storyboardInsertionTargetFromPointer
} from "./storyboardDnd";

describe("storyboard drag preview", () => {
  it("uses only the active shot when it is not selected", () => {
    expect(
      dragPreviewShotIds({
        activeShotId: "shot-b",
        selectedShotIds: ["shot-a"],
        orderedShotIds: ["shot-a", "shot-b", "shot-c"]
      })
    ).toEqual(["shot-b"]);
  });

  it("preserves storyboard order for selected shot moves", () => {
    expect(
      dragPreviewShotIds({
        activeShotId: "shot-c",
        selectedShotIds: ["shot-c", "shot-a"],
        orderedShotIds: ["shot-a", "shot-b", "shot-c"]
      })
    ).toEqual(["shot-a", "shot-c"]);
  });
});

const shotRects = [
  { shotId: "shot-1", left: 0, right: 100, top: 0, bottom: 80 },
  { shotId: "shot-2", left: 120, right: 220, top: 0, bottom: 80 },
  { shotId: "shot-3", left: 240, right: 340, top: 0, bottom: 80 },
  { shotId: "shot-4", left: 0, right: 100, top: 100, bottom: 180 }
];

describe("storyboard insertion target", () => {
  it("does not show an insertion target while the pointer is still inside moving storyboards", () => {
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 50, y: 40 },
        movingShotIds: ["shot-1"]
      })
    ).toBeUndefined();
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 170, y: 40 },
        movingShotIds: ["shot-1", "shot-2"]
      })
    ).toBeUndefined();
  });

  it("targets the gap between two storyboards on the same row", () => {
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 110, y: 40 },
        movingShotIds: ["shot-1"]
      })
    ).toEqual({ targetShotId: "shot-2", placement: "before" });
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 230, y: 40 },
        movingShotIds: ["shot-1"]
      })
    ).toEqual({ targetShotId: "shot-3", placement: "before" });
  });

  it("uses row-major ordering when the pointer crosses rows", () => {
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 340, y: 90 },
        movingShotIds: ["shot-1"]
      })
    ).toEqual({ targetShotId: "shot-4", placement: "before" });
  });

  it("can target after the last storyboard in a row", () => {
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 360, y: 40 },
        movingShotIds: ["shot-1"]
      })
    ).toEqual({ targetShotId: "shot-3", placement: "after" });
  });

  it("ignores moving shots when finding an insertion target", () => {
    expect(
      storyboardInsertionTargetFromPointer({
        shotRects,
        pointer: { x: 110, y: 40 },
        movingShotIds: ["shot-1", "shot-2"]
      })
    ).toEqual({ targetShotId: "shot-3", placement: "before" });
  });
});

describe("storyboard sortable items", () => {
  it("contains only real storyboard ids for the sortable model", () => {
    const shotIds = ["shot-1", "shot-2", "shot-3"];
    expect(storyboardSortableItemIds(shotIds)).toEqual(shotIds);
  });
});

describe("dialogue drop zone highlighting", () => {
  it("only highlights while dragging a dialogue card", () => {
    expect(isDialogueDropZoneHighlighted({ isOver: true, activeDragType: "dialogue" })).toBe(true);
    expect(isDialogueDropZoneHighlighted({ isOver: true, activeDragType: "shot" })).toBe(false);
    expect(isDialogueDropZoneHighlighted({ isOver: false, activeDragType: "dialogue" })).toBe(false);
  });
});

describe("storyboard insertion indicator visibility", () => {
  it("only shows while a storyboard drag is active and an indicator exists", () => {
    expect(
      shouldShowStoryboardInsertionIndicator({
        activeShotCount: 1,
        hasIndicator: true
      })
    ).toBe(true);
    expect(
      shouldShowStoryboardInsertionIndicator({
        activeShotCount: 0,
        hasIndicator: true
      })
    ).toBe(false);
    expect(
      shouldShowStoryboardInsertionIndicator({
        activeShotCount: 1,
        hasIndicator: false
      })
    ).toBe(false);
  });
});

describe("storyboard drag rect cache", () => {
  it("captures storyboard rects from the board instead of scanning the whole document", () => {
    const makeElement = (shotId: string, rect: { left: number; right: number; top: number; bottom: number }) =>
      ({
        dataset: { shotId },
        getBoundingClientRect: () => ({
          ...rect,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          x: rect.left,
          y: rect.top,
          toJSON: () => ({})
        })
      }) as unknown as HTMLElement;
    const elements = [
      makeElement("shot-1", { left: 20, right: 120, top: 30, bottom: 110 }),
      makeElement("shot-2", { left: 140, right: 240, top: 30, bottom: 110 })
    ];
    const board = {
      querySelectorAll: (selector: string) => (selector === "[data-shot-id]" ? elements : []),
      getBoundingClientRect: () => ({
        left: 10,
        right: 300,
        top: 20,
        bottom: 160,
        width: 290,
        height: 140,
        x: 10,
        y: 20,
        toJSON: () => ({})
      })
    } as unknown as HTMLElement;

    expect(captureStoryboardDragRects(board)).toEqual({
      board: { left: 10, top: 20 },
      shots: [
        { shotId: "shot-1", left: 20, right: 120, top: 30, bottom: 110 },
        { shotId: "shot-2", left: 140, right: 240, top: 30, bottom: 110 }
      ]
    });
  });

  it("computes insertion indicator geometry from cached rects", () => {
    const cache = {
      board: { left: 10, top: 20 },
      shots: [{ shotId: "shot-2", left: 140, right: 240, top: 30, bottom: 110 }]
    };

    expect(
      storyboardInsertionIndicatorFromCachedRect(
        { targetShotId: "shot-2", placement: "before" },
        cache
      )
    ).toEqual({
      targetShotId: "shot-2",
      placement: "before",
      left: 122,
      top: 10,
      height: 80
    });
    expect(
      storyboardInsertionIndicatorFromCachedRect(
        { targetShotId: "shot-2", placement: "after" },
        cache
      )
    ).toEqual({
      targetShotId: "shot-2",
      placement: "after",
      left: 238,
      top: 10,
      height: 80
    });
  });
});

describe("parking insertion target", () => {
  const parkedRects = [
    { shotId: "parked-1", left: 20, right: 220, top: 30, bottom: 110 },
    { shotId: "parked-2", left: 20, right: 220, top: 124, bottom: 204 }
  ];

  it("targets before or after parked storyboards by vertical pointer position", () => {
    expect(
      parkingInsertionTargetFromPointer({
        shotRects: parkedRects,
        pointer: { x: 80, y: 40 },
        movingShotIds: []
      })
    ).toEqual({ targetShotId: "parked-1", placement: "before" });
    expect(
      parkingInsertionTargetFromPointer({
        shotRects: parkedRects,
        pointer: { x: 80, y: 118 },
        movingShotIds: []
      })
    ).toEqual({ targetShotId: "parked-2", placement: "before" });
    expect(
      parkingInsertionTargetFromPointer({
        shotRects: parkedRects,
        pointer: { x: 80, y: 220 },
        movingShotIds: []
      })
    ).toEqual({ targetShotId: "parked-2", placement: "after" });
  });

  it("ignores moving parked storyboards when finding a pending target", () => {
    expect(
      parkingInsertionTargetFromPointer({
        shotRects: parkedRects,
        pointer: { x: 80, y: 40 },
        movingShotIds: ["parked-1"]
      })
    ).toEqual({ targetShotId: "parked-2", placement: "before" });
  });
});

describe("parking drag rect cache", () => {
  it("captures parked storyboard rects from the parking list", () => {
    const makeElement = (shotId: string, rect: { left: number; right: number; top: number; bottom: number }) =>
      ({
        dataset: { parkedShotId: shotId },
        getBoundingClientRect: () => ({
          ...rect,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          x: rect.left,
          y: rect.top,
          toJSON: () => ({})
        })
      }) as unknown as HTMLElement;
    const elements = [
      makeElement("parked-1", { left: 20, right: 220, top: 30, bottom: 110 }),
      makeElement("parked-2", { left: 20, right: 220, top: 124, bottom: 204 })
    ];
    const list = {
      querySelectorAll: (selector: string) => (selector === "[data-parked-shot-id]" ? elements : []),
      getBoundingClientRect: () => ({
        left: 12,
        right: 232,
        top: 18,
        bottom: 260,
        width: 220,
        height: 242,
        x: 12,
        y: 18,
        toJSON: () => ({})
      })
    } as unknown as HTMLElement;

    expect(captureParkingDragRects(list)).toEqual({
      list: { left: 12, top: 18 },
      shots: [
        { shotId: "parked-1", left: 20, right: 220, top: 30, bottom: 110 },
        { shotId: "parked-2", left: 20, right: 220, top: 124, bottom: 204 }
      ]
    });
  });

  it("computes pending insertion indicator geometry from cached rects", () => {
    const cache = {
      list: { left: 12, top: 18 },
      shots: [{ shotId: "parked-2", left: 20, right: 220, top: 124, bottom: 204 }]
    };

    expect(
      parkingInsertionIndicatorFromCachedRect(
        { targetShotId: "parked-2", placement: "before" },
        cache
      )
    ).toEqual({
      targetShotId: "parked-2",
      placement: "before",
      left: 8,
      top: 98,
      width: 200
    });
    expect(
      parkingInsertionIndicatorFromCachedRect(
        { targetShotId: "parked-2", placement: "after" },
        cache
      )
    ).toEqual({
      targetShotId: "parked-2",
      placement: "after",
      left: 8,
      top: 194,
      width: 200
    });
  });
});
