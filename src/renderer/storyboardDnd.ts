import { sortedShots, type ShotPlacement } from "../shared/projectOps";
import type { Project } from "../shared/types";

export type DragData =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "drop-zone"; shotId: string }
  | { type: "parking-zone" }
  | { type: "parked-shot"; shotId: string };

export type StoryboardInsertionPlacement = "before" | "after";

export type StoryboardInsertionTarget = {
  targetShotId: string;
  placement: StoryboardInsertionPlacement;
};

export type StoryboardShotRect = {
  shotId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type StoryboardDragRectCache = {
  board: {
    left: number;
    top: number;
  };
  shots: StoryboardShotRect[];
};

export type StoryboardInsertionIndicator = StoryboardInsertionTarget & {
  left: number;
  top: number;
  height: number;
};

export type ParkingDragRectCache = {
  list: {
    left: number;
    top: number;
  };
  shots: StoryboardShotRect[];
};

export type ParkingInsertionIndicator = StoryboardInsertionTarget & {
  left: number;
  top: number;
  width: number;
};

export const dragPreviewShotIds = ({
  activeShotId,
  selectedShotIds,
  orderedShotIds
}: {
  activeShotId: string;
  selectedShotIds: string[];
  orderedShotIds: string[];
}): string[] => {
  if (!selectedShotIds.includes(activeShotId)) {
    return [activeShotId];
  }

  const selected = new Set(selectedShotIds);
  return orderedShotIds.filter((shotId) => selected.has(shotId));
};

export const storyboardSortableItemIds = (shotIds: string[]): string[] => shotIds;

export const isDialogueDropZoneHighlighted = ({
  isOver,
  activeDragType
}: {
  isOver: boolean;
  activeDragType?: DragData["type"];
}): boolean => isOver && activeDragType === "dialogue";

export const shouldShowStoryboardInsertionIndicator = ({
  activeShotCount,
  hasIndicator
}: {
  activeShotCount: number;
  hasIndicator: boolean;
}): boolean => activeShotCount > 0 && hasIndicator;

export const captureStoryboardDragRects = (board: HTMLElement | null): StoryboardDragRectCache | undefined => {
  if (!board) {
    return undefined;
  }

  const boardRect = board.getBoundingClientRect();
  const shots = Array.from(board.querySelectorAll<HTMLElement>("[data-shot-id]"))
    .map((element) => {
      const shotId = element.dataset.shotId;
      if (!shotId) {
        return undefined;
      }

      const rect = element.getBoundingClientRect();
      return {
        shotId,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      };
    })
    .filter((shotRect): shotRect is StoryboardShotRect => Boolean(shotRect));

  return {
    board: {
      left: boardRect.left,
      top: boardRect.top
    },
    shots
  };
};

export const storyboardInsertionIndicatorFromCachedRect = (
  target: StoryboardInsertionTarget,
  cache: StoryboardDragRectCache
): StoryboardInsertionIndicator | undefined => {
  const targetRect = cache.shots.find((rect) => rect.shotId === target.targetShotId);
  if (!targetRect) {
    return undefined;
  }

  const gapOffset = 8;
  return {
    ...target,
    left:
      target.placement === "before"
        ? targetRect.left - cache.board.left - gapOffset
        : targetRect.right - cache.board.left + gapOffset,
    top: targetRect.top - cache.board.top,
    height: targetRect.bottom - targetRect.top
  };
};

export const captureParkingDragRects = (list: HTMLElement | null): ParkingDragRectCache | undefined => {
  if (!list) {
    return undefined;
  }

  const listRect = list.getBoundingClientRect();
  const shots = Array.from(list.querySelectorAll<HTMLElement>("[data-parked-shot-id]"))
    .map((element) => {
      const shotId = element.dataset.parkedShotId;
      if (!shotId) {
        return undefined;
      }

      const rect = element.getBoundingClientRect();
      return {
        shotId,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      };
    })
    .filter((shotRect): shotRect is StoryboardShotRect => Boolean(shotRect));

  return {
    list: {
      left: listRect.left,
      top: listRect.top
    },
    shots
  };
};

export const parkingInsertionIndicatorFromCachedRect = (
  target: StoryboardInsertionTarget,
  cache: ParkingDragRectCache
): ParkingInsertionIndicator | undefined => {
  const targetRect = cache.shots.find((rect) => rect.shotId === target.targetShotId);
  if (!targetRect) {
    return undefined;
  }

  const gapOffset = 8;
  return {
    ...target,
    left: targetRect.left - cache.list.left,
    top:
      target.placement === "before"
        ? targetRect.top - cache.list.top - gapOffset
        : targetRect.bottom - cache.list.top + gapOffset,
    width: targetRect.right - targetRect.left
  };
};

export const storyboardInsertionTargetFromPointer = ({
  shotRects,
  pointer,
  movingShotIds
}: {
  shotRects: StoryboardShotRect[];
  pointer: { x: number; y: number };
  movingShotIds: string[];
}): StoryboardInsertionTarget | undefined => {
  const moving = new Set(movingShotIds);
  const movingRects = shotRects.filter((rect) => moving.has(rect.shotId));
  const isPointerInsideMovingRect = movingRects.some(
    (rect) => pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom
  );
  if (isPointerInsideMovingRect) {
    return undefined;
  }

  const candidates = shotRects
    .filter((rect) => !moving.has(rect.shotId))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  if (candidates.length === 0) {
    return undefined;
  }

  const rows: StoryboardShotRect[][] = [];
  for (const rect of candidates) {
    const row = rows.find((candidateRow) => {
      const first = candidateRow[0];
      return rect.top < first.bottom && rect.bottom > first.top;
    });
    if (row) {
      row.push(rect);
    } else {
      rows.push([rect]);
    }
  }

  rows.forEach((row) => row.sort((a, b) => a.left - b.left));

  const containingRow = rows.find((row) => {
    const top = Math.min(...row.map((rect) => rect.top));
    const bottom = Math.max(...row.map((rect) => rect.bottom));
    return pointer.y >= top && pointer.y <= bottom;
  });

  if (containingRow) {
    const firstAfterPointer = containingRow.find((rect) => pointer.x < (rect.left + rect.right) / 2);
    if (firstAfterPointer) {
      return { targetShotId: firstAfterPointer.shotId, placement: "before" };
    }

    return { targetShotId: containingRow[containingRow.length - 1].shotId, placement: "after" };
  }

  const firstRowAfterPointer = rows.find((row) => {
    const bottom = Math.max(...row.map((rect) => rect.bottom));
    return pointer.y <= bottom;
  });

  if (firstRowAfterPointer) {
    return { targetShotId: firstRowAfterPointer[0].shotId, placement: "before" };
  }

  const lastRow = rows[rows.length - 1];
  return { targetShotId: lastRow[lastRow.length - 1].shotId, placement: "after" };
};

export const parkingInsertionTargetFromPointer = ({
  shotRects,
  pointer,
  movingShotIds
}: {
  shotRects: StoryboardShotRect[];
  pointer: { x: number; y: number };
  movingShotIds: string[];
}): StoryboardInsertionTarget | undefined => {
  const moving = new Set(movingShotIds);
  const candidates = shotRects
    .filter((rect) => !moving.has(rect.shotId))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  if (candidates.length === 0) {
    return undefined;
  }

  const firstAfterPointer = candidates.find((rect) => pointer.y < (rect.top + rect.bottom) / 2);
  if (firstAfterPointer) {
    return { targetShotId: firstAfterPointer.shotId, placement: "before" };
  }

  return { targetShotId: candidates[candidates.length - 1].shotId, placement: "after" };
};

export const inferShotPlacement = (
  project: Project,
  movingShotIds: string[],
  targetShotId: string,
  fallbackShotId: string
): ShotPlacement => {
  const ordered = sortedShots(project.shots);
  const targetIndex = ordered.findIndex((shot) => shot.id === targetShotId);
  const activeIndex = ordered.findIndex((shot) => shot.id === fallbackShotId);
  const movingIndexes = movingShotIds
    .map((shotId) => ordered.findIndex((shot) => shot.id === shotId))
    .filter((index) => index !== -1);

  if (targetIndex === -1 || activeIndex === -1 || movingIndexes.length === 0) {
    return "before";
  }

  return targetIndex > Math.max(...movingIndexes) ? "after" : "before";
};

export const pointerFromActiveDragRect = (
  rect: { left: number; top: number; width: number; height: number } | null | undefined
): { x: number; y: number } | undefined => {
  if (!rect) {
    return undefined;
  }

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
};

export type DropPlacementDragEndEvent = {
  active: {
    rect: {
      current: {
        translated?: { top: number; height: number } | null;
        initial?: { top: number; height: number } | null;
      };
    };
  };
  over?: {
    rect: { top: number; height: number };
  } | null;
};

export const inferDropPlacementFromDragEnd = (event: DropPlacementDragEndEvent): ShotPlacement => {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const overRect = event.over?.rect;

  if (!activeRect || !overRect) {
    return "after";
  }

  const activeCenterY = activeRect.top + activeRect.height / 2;
  const overCenterY = overRect.top + overRect.height / 2;
  return activeCenterY > overCenterY ? "after" : "before";
};

export const sameStoryboardInsertionIndicator = (
  current: StoryboardInsertionIndicator | undefined,
  next: StoryboardInsertionIndicator | undefined
): boolean =>
  current?.targetShotId === next?.targetShotId &&
  current?.placement === next?.placement &&
  current?.left === next?.left &&
  current?.top === next?.top &&
  current?.height === next?.height;

export const sameParkingInsertionIndicator = (
  current: ParkingInsertionIndicator | undefined,
  next: ParkingInsertionIndicator | undefined
): boolean =>
  current?.targetShotId === next?.targetShotId &&
  current?.placement === next?.placement &&
  current?.left === next?.left &&
  current?.top === next?.top &&
  current?.width === next?.width;

export const isPointerInsideRect = (
  rect: { left: number; right: number; top: number; bottom: number } | undefined,
  pointer: { x: number; y: number }
): boolean => {
  if (!rect) {
    return false;
  }

  return pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
};
