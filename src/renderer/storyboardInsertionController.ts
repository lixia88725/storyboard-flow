import { useRef, type RefObject } from "react";
import type { DragEndEvent, DragMoveEvent, DragOverEvent } from "@dnd-kit/core";
import { isPointerInsideElement } from "./dragHitTesting";
import {
  captureParkingDragRects,
  captureStoryboardDragRects,
  parkingInsertionIndicatorFromCachedRect,
  parkingInsertionTargetFromPointer,
  pointerFromActiveDragRect,
  sameParkingInsertionIndicator,
  sameStoryboardInsertionIndicator,
  storyboardInsertionIndicatorFromCachedRect,
  storyboardInsertionTargetFromPointer,
  storyboardListInsertionIndicatorFromCachedRect,
  storyboardListInsertionTargetFromPointer,
  type DragData,
  type ParkingDragRectCache,
  type ParkingInsertionIndicator,
  type StoryboardDragRectCache,
  type StoryboardInsertionIndicator,
  type StoryboardInsertionTarget
} from "./storyboardDnd";

type PointerPosition = { x: number; y: number };
export type StoryboardInsertionLayout = "grid" | "list";
type InsertionDragRequest =
  | { type: "reset" }
  | { type: "clear" }
  | { type: "queue"; pointer: PointerPosition; movingShotIds: string[] };

export const storyboardInsertionDragRequest = ({
  activeData,
  fallbackPointer,
  isAnimationMode,
  isPointerInsideBoard,
  isPointerInsideParkingList,
  lastPointer,
  selectedShotIds
}: {
  activeData: DragData | undefined;
  fallbackPointer: PointerPosition | undefined;
  isAnimationMode: boolean;
  isPointerInsideBoard: boolean;
  isPointerInsideParkingList: boolean;
  lastPointer: PointerPosition | undefined;
  selectedShotIds: string[];
}): InsertionDragRequest => {
  if (
    (activeData?.type !== "shot" &&
      activeData?.type !== "parked-shot") ||
    isAnimationMode
  ) {
    return { type: "reset" };
  }

  const pointer = lastPointer ?? fallbackPointer;
  if (!pointer) {
    return { type: "clear" };
  }

  if (
    activeData.type === "parked-shot" &&
    !isPointerInsideBoard
  ) {
    return { type: "clear" };
  }

  if (activeData.type === "shot" && isPointerInsideParkingList) {
    return { type: "clear" };
  }

  const movingShotIds = activeData.type === "shot"
    ? selectedShotIds.includes(activeData.shotId)
      ? selectedShotIds
      : [activeData.shotId]
    : [];

  return { type: "queue", pointer, movingShotIds };
};

export const parkingInsertionDragRequest = ({
  activeData,
  fallbackPointer,
  isPointerInsideParkingList,
  lastPointer
}: {
  activeData: DragData | undefined;
  fallbackPointer: PointerPosition | undefined;
  isPointerInsideParkingList: boolean;
  lastPointer: PointerPosition | undefined;
}): InsertionDragRequest => {
  if (activeData?.type !== "shot") {
    return { type: "reset" };
  }

  const pointer = lastPointer ?? fallbackPointer;
  if (!pointer || !isPointerInsideParkingList) {
    return { type: "clear" };
  }

  return { type: "queue", pointer, movingShotIds: [] };
};

type UseStoryboardInsertionControllerOptions = {
  boardGridRef: RefObject<HTMLElement | null>;
  currentBoardScroll: () => { x: number; y: number };
  isAnimationModeRef: RefObject<boolean>;
  lastPointerPositionRef: RefObject<PointerPosition | undefined>;
  parkingListRef: RefObject<HTMLElement | null>;
  selectedShotIdsRef: RefObject<string[]>;
  storyboardInsertionLayoutRef: RefObject<StoryboardInsertionLayout>;
  setParkingInsertionIndicator: (indicator: ParkingInsertionIndicator | undefined) => void;
  setStoryboardInsertionIndicator: (indicator: StoryboardInsertionIndicator | undefined) => void;
};

export const useStoryboardInsertionController = ({
  boardGridRef,
  currentBoardScroll,
  isAnimationModeRef,
  lastPointerPositionRef,
  parkingListRef,
  selectedShotIdsRef,
  storyboardInsertionLayoutRef,
  setParkingInsertionIndicator,
  setStoryboardInsertionIndicator
}: UseStoryboardInsertionControllerOptions) => {
  const storyboardInsertionTargetRef = useRef<StoryboardInsertionTarget | undefined>(undefined);
  const storyboardInsertionIndicatorRef = useRef<StoryboardInsertionIndicator | undefined>(undefined);
  const storyboardDragRectCacheRef = useRef<StoryboardDragRectCache | undefined>(undefined);
  const storyboardDragRectCacheScrollRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const storyboardInsertionFrameRef = useRef<number | undefined>(undefined);
  const pendingStoryboardInsertionDragRef = useRef<
    | {
        pointer: PointerPosition;
        movingShotIds: string[];
      }
    | undefined
  >(undefined);
  const parkingInsertionTargetRef = useRef<StoryboardInsertionTarget | undefined>(undefined);
  const parkingInsertionIndicatorRef = useRef<ParkingInsertionIndicator | undefined>(undefined);
  const parkingDragRectCacheRef = useRef<ParkingDragRectCache | undefined>(undefined);
  const parkingDragRectCacheScrollRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const parkingInsertionFrameRef = useRef<number | undefined>(undefined);
  const pendingParkingInsertionDragRef = useRef<
    | {
        pointer: PointerPosition;
        movingShotIds: string[];
      }
    | undefined
  >(undefined);

  const currentStoryboardDragRectCache = (): StoryboardDragRectCache | undefined => {
    const scroll = currentBoardScroll();
    const cachedScroll = storyboardDragRectCacheScrollRef.current;
    if (
      !storyboardDragRectCacheRef.current ||
      !cachedScroll ||
      cachedScroll.x !== scroll.x ||
      cachedScroll.y !== scroll.y
    ) {
      storyboardDragRectCacheRef.current = captureStoryboardDragRects(boardGridRef.current);
      storyboardDragRectCacheScrollRef.current = scroll;
    }

    return storyboardDragRectCacheRef.current;
  };

  const currentParkingDragRectCache = (): ParkingDragRectCache | undefined => {
    const scroll = currentBoardScroll();
    const cachedScroll = parkingDragRectCacheScrollRef.current;
    if (
      !parkingDragRectCacheRef.current ||
      !cachedScroll ||
      cachedScroll.x !== scroll.x ||
      cachedScroll.y !== scroll.y
    ) {
      parkingDragRectCacheRef.current = captureParkingDragRects(parkingListRef.current);
      parkingDragRectCacheScrollRef.current = scroll;
    }

    return parkingDragRectCacheRef.current;
  };

  const setNextStoryboardInsertionTarget = (
    nextTarget: StoryboardInsertionTarget | undefined,
    rectCache: StoryboardDragRectCache | undefined
  ) => {
    const currentTarget = storyboardInsertionTargetRef.current;
    const nextIndicator = nextTarget && rectCache
      ? storyboardInsertionLayoutRef.current === "list"
        ? storyboardListInsertionIndicatorFromCachedRect(nextTarget, rectCache)
        : storyboardInsertionIndicatorFromCachedRect(nextTarget, rectCache)
      : undefined;
    if (
      currentTarget?.targetShotId === nextTarget?.targetShotId &&
      currentTarget?.placement === nextTarget?.placement &&
      sameStoryboardInsertionIndicator(storyboardInsertionIndicatorRef.current, nextIndicator)
    ) {
      return;
    }

    storyboardInsertionTargetRef.current = nextTarget;
    storyboardInsertionIndicatorRef.current = nextIndicator;
    setStoryboardInsertionIndicator(nextIndicator);
  };

  const clearStoryboardInsertionTarget = () => {
    storyboardInsertionTargetRef.current = undefined;
    storyboardInsertionIndicatorRef.current = undefined;
    setStoryboardInsertionIndicator(undefined);
  };

  const setNextParkingInsertionTarget = (
    nextTarget: StoryboardInsertionTarget | undefined,
    rectCache: ParkingDragRectCache | undefined
  ) => {
    const currentTarget = parkingInsertionTargetRef.current;
    const nextIndicator = nextTarget && rectCache
      ? parkingInsertionIndicatorFromCachedRect(nextTarget, rectCache)
      : undefined;
    if (
      currentTarget?.targetShotId === nextTarget?.targetShotId &&
      currentTarget?.placement === nextTarget?.placement &&
      sameParkingInsertionIndicator(parkingInsertionIndicatorRef.current, nextIndicator)
    ) {
      return;
    }

    parkingInsertionTargetRef.current = nextTarget;
    parkingInsertionIndicatorRef.current = nextIndicator;
    setParkingInsertionIndicator(nextIndicator);
  };

  const clearParkingInsertionTarget = () => {
    parkingInsertionTargetRef.current = undefined;
    parkingInsertionIndicatorRef.current = undefined;
    setParkingInsertionIndicator(undefined);
  };

  const applyQueuedStoryboardInsertionTarget = () => {
    const pending = pendingStoryboardInsertionDragRef.current;
    pendingStoryboardInsertionDragRef.current = undefined;

    if (!pending) {
      clearStoryboardInsertionTarget();
      return;
    }

    const rectCache = currentStoryboardDragRectCache();
    if (!rectCache) {
      clearStoryboardInsertionTarget();
      return;
    }

    const insertionTarget =
      storyboardInsertionLayoutRef.current === "list"
        ? storyboardListInsertionTargetFromPointer({
            shotRects: rectCache.shots,
            pointer: pending.pointer,
            movingShotIds: pending.movingShotIds
          })
        : storyboardInsertionTargetFromPointer({
            shotRects: rectCache.shots,
            pointer: pending.pointer,
            movingShotIds: pending.movingShotIds
          });
    setNextStoryboardInsertionTarget(insertionTarget, rectCache);
  };

  const applyQueuedParkingInsertionTarget = () => {
    const pending = pendingParkingInsertionDragRef.current;
    pendingParkingInsertionDragRef.current = undefined;

    if (!pending) {
      clearParkingInsertionTarget();
      return;
    }

    const rectCache = currentParkingDragRectCache();
    if (!rectCache) {
      clearParkingInsertionTarget();
      return;
    }

    const insertionTarget = parkingInsertionTargetFromPointer({
      shotRects: rectCache.shots,
      pointer: pending.pointer,
      movingShotIds: pending.movingShotIds
    });
    setNextParkingInsertionTarget(insertionTarget, rectCache);
  };

  const cancelQueuedStoryboardInsertionTarget = () => {
    if (storyboardInsertionFrameRef.current !== undefined) {
      window.cancelAnimationFrame(storyboardInsertionFrameRef.current);
      storyboardInsertionFrameRef.current = undefined;
    }
    pendingStoryboardInsertionDragRef.current = undefined;
  };

  const cancelQueuedParkingInsertionTarget = () => {
    if (parkingInsertionFrameRef.current !== undefined) {
      window.cancelAnimationFrame(parkingInsertionFrameRef.current);
      parkingInsertionFrameRef.current = undefined;
    }
    pendingParkingInsertionDragRef.current = undefined;
  };

  const flushQueuedStoryboardInsertionTarget = () => {
    if (storyboardInsertionFrameRef.current !== undefined) {
      window.cancelAnimationFrame(storyboardInsertionFrameRef.current);
      storyboardInsertionFrameRef.current = undefined;
    }
    applyQueuedStoryboardInsertionTarget();
  };

  const flushQueuedParkingInsertionTarget = () => {
    if (parkingInsertionFrameRef.current !== undefined) {
      window.cancelAnimationFrame(parkingInsertionFrameRef.current);
      parkingInsertionFrameRef.current = undefined;
    }
    applyQueuedParkingInsertionTarget();
  };

  const resetStoryboardInsertionDragState = () => {
    cancelQueuedStoryboardInsertionTarget();
    storyboardDragRectCacheRef.current = undefined;
    storyboardDragRectCacheScrollRef.current = undefined;
    clearStoryboardInsertionTarget();
  };

  const resetParkingInsertionDragState = () => {
    cancelQueuedParkingInsertionTarget();
    parkingDragRectCacheRef.current = undefined;
    parkingDragRectCacheScrollRef.current = undefined;
    clearParkingInsertionTarget();
  };

  const resetInsertionDragState = () => {
    resetStoryboardInsertionDragState();
    resetParkingInsertionDragState();
  };

  const queueInsertionTargetsFromDrag = (event: DragMoveEvent | DragOverEvent | DragEndEvent) => {
    const activeData = event.active.data.current as DragData | undefined;
    const fallbackPointer = pointerFromActiveDragRect(
      event.active.rect.current.translated ?? event.active.rect.current.initial
    );
    const pointerForHitTest = lastPointerPositionRef.current ?? fallbackPointer;

    const storyboardRequest = storyboardInsertionDragRequest({
      activeData,
      fallbackPointer,
      isAnimationMode: isAnimationModeRef.current,
      isPointerInsideBoard: pointerForHitTest
        ? isPointerInsideElement(boardGridRef.current, pointerForHitTest)
        : false,
      isPointerInsideParkingList: pointerForHitTest
        ? isPointerInsideElement(parkingListRef.current, pointerForHitTest)
        : false,
      lastPointer: lastPointerPositionRef.current,
      selectedShotIds: selectedShotIdsRef.current
    });

    if (storyboardRequest.type === "reset") {
      resetStoryboardInsertionDragState();
    } else if (storyboardRequest.type === "clear") {
      clearStoryboardInsertionTarget();
    } else {
      pendingStoryboardInsertionDragRef.current = {
        pointer: storyboardRequest.pointer,
        movingShotIds: storyboardRequest.movingShotIds
      };
      if (storyboardInsertionFrameRef.current === undefined) {
        storyboardInsertionFrameRef.current = window.requestAnimationFrame(() => {
          storyboardInsertionFrameRef.current = undefined;
          applyQueuedStoryboardInsertionTarget();
        });
      }
    }

    const parkingRequest = parkingInsertionDragRequest({
      activeData,
      fallbackPointer,
      isPointerInsideParkingList: pointerForHitTest
        ? isPointerInsideElement(parkingListRef.current, pointerForHitTest)
        : false,
      lastPointer: lastPointerPositionRef.current
    });

    if (parkingRequest.type === "reset") {
      resetParkingInsertionDragState();
    } else if (parkingRequest.type === "clear") {
      clearParkingInsertionTarget();
    } else {
      pendingParkingInsertionDragRef.current = {
        pointer: parkingRequest.pointer,
        movingShotIds: parkingRequest.movingShotIds
      };
      if (parkingInsertionFrameRef.current === undefined) {
        parkingInsertionFrameRef.current = window.requestAnimationFrame(() => {
          parkingInsertionFrameRef.current = undefined;
          applyQueuedParkingInsertionTarget();
        });
      }
    }
  };

  const flushInsertionTargetsFromDragEnd = (event: DragEndEvent) => {
    queueInsertionTargetsFromDrag(event);
    flushQueuedStoryboardInsertionTarget();
    flushQueuedParkingInsertionTarget();
    return {
      storyboardInsertionTarget: storyboardInsertionTargetRef.current,
      parkingInsertionTarget: parkingInsertionTargetRef.current
    };
  };

  return {
    flushInsertionTargetsFromDragEnd,
    queueInsertionTargetsFromDrag,
    resetInsertionDragState
  };
};
