import { useCallback, type PointerEvent, type RefObject } from "react";
import type { DeleteTarget } from "./deleteTarget";
import {
  createMarqueeBox,
  marqueeEdgeScrollDelta,
  sameMarqueeSelection,
  shotIdsInMarqueeBox,
  updateMarqueeBox
} from "./storyboardMarquee";
import {
  applyMarqueeShotSelection,
  applySelectedShotCountLabel,
  applySelectionMarqueeStyle,
  clearCommittedMarqueeShotSelection,
  hideSelectionMarquee,
  showSelectionMarquee,
  storyboardMarqueeShotElementsFromDom,
  storyboardMarqueeShotRectsFromDom
} from "./storyboardMarqueeDom";

type MutableRef<T> = {
  current: T;
};

type BoardScroll = {
  x: number;
  y: number;
};

type PointerDownLike = {
  button: number;
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
  target: EventTarget | null;
};

type PointerMoveLike = {
  clientX: number;
  clientY: number;
};

type EventTargetLike = {
  addEventListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerMoveLike) => void,
    options?: { once?: boolean }
  ) => void;
  removeEventListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerMoveLike) => void
  ) => void;
};

type MarqueeScheduler = Pick<Window, "cancelAnimationFrame" | "requestAnimationFrame">;

type StoryboardMarqueeSelectionOptions = {
  currentBoardScroll: () => BoardScroll;
  event: PointerDownLike;
  eventTarget: EventTargetLike;
  scheduler: MarqueeScheduler;
  scrollBoardBy: (options: ScrollToOptions) => void;
  selectShotsByIds: (shotIds: string[]) => void;
  deleteTargetRef: MutableRef<DeleteTarget>;
  selectedShotCountLabelRef: RefObject<HTMLSpanElement | null>;
  selectedShotIdsRef: MutableRef<string[]>;
  selectionMarqueeRef: RefObject<HTMLDivElement | null>;
  setDeleteTarget: (target: DeleteTarget) => void;
  shotSelectionAnchorIdRef: MutableRef<string | undefined>;
  viewportHeight: () => number;
  workspaceBoardScrollRef: RefObject<HTMLElement | null>;
};

export const startStoryboardMarqueeSelection = ({
  currentBoardScroll,
  event,
  eventTarget,
  scheduler,
  scrollBoardBy,
  selectShotsByIds,
  deleteTargetRef,
  selectedShotCountLabelRef,
  selectedShotIdsRef,
  selectionMarqueeRef,
  setDeleteTarget,
  shotSelectionAnchorIdRef,
  viewportHeight,
  workspaceBoardScrollRef
}: StoryboardMarqueeSelectionOptions): void => {
  if (event.target !== event.currentTarget || event.button !== 0) {
    return;
  }

  const board = event.currentTarget;
  const marqueeShotRects = storyboardMarqueeShotRectsFromDom(board, currentBoardScroll());
  const marqueeShotElements = storyboardMarqueeShotElementsFromDom(board);
  const initialSelectedShotIds = selectedShotIdsRef.current;
  const initialBoardScroll = currentBoardScroll();
  const shouldCommitShotDeleteTarget = deleteTargetRef.current.type !== "shot";
  const nextBox = createMarqueeBox({
    clientX: event.clientX,
    clientY: event.clientY,
    scrollX: initialBoardScroll.x,
    scrollY: initialBoardScroll.y
  });
  let marqueeSelectedShotIds: string[] = [];
  let latestPointer = { clientX: event.clientX, clientY: event.clientY };
  let marqueeFrame: number | undefined;

  board.classList.add("is-marquee-selecting");
  showSelectionMarquee(selectionMarqueeRef.current, nextBox);
  shotSelectionAnchorIdRef.current = undefined;
  selectedShotIdsRef.current = [];
  deleteTargetRef.current = { type: "shot" };
  clearCommittedMarqueeShotSelection(marqueeShotElements, initialSelectedShotIds);
  applyMarqueeShotSelection(marqueeShotElements, [], marqueeSelectedShotIds);
  applySelectedShotCountLabel(selectedShotCountLabelRef.current, marqueeSelectedShotIds.length);

  function scheduleMarqueeUpdate() {
    if (marqueeFrame !== undefined) {
      return;
    }

    marqueeFrame = scheduler.requestAnimationFrame(() => {
      marqueeFrame = undefined;
      updateMarqueeSelection(true);
    });
  }

  function updateMarqueeSelection(continueAutoScroll: boolean) {
    const scrollViewportRect = workspaceBoardScrollRef.current?.getBoundingClientRect();
    const scrollDelta = marqueeEdgeScrollDelta({
      pointerY: latestPointer.clientY,
      viewportTop: scrollViewportRect?.top ?? 0,
      viewportHeight: scrollViewportRect?.height ?? viewportHeight()
    });
    if (scrollDelta !== 0) {
      scrollBoardBy({ top: scrollDelta, left: 0, behavior: "auto" });
    }

    const boardScroll = currentBoardScroll();
    const movedBox = updateMarqueeBox(nextBox, {
      clientX: latestPointer.clientX,
      clientY: latestPointer.clientY,
      scrollX: boardScroll.x,
      scrollY: boardScroll.y
    });
    applySelectionMarqueeStyle(selectionMarqueeRef.current, movedBox);

    const nextShotIds = shotIdsInMarqueeBox(movedBox, marqueeShotRects);
    if (!sameMarqueeSelection(marqueeSelectedShotIds, nextShotIds)) {
      applyMarqueeShotSelection(marqueeShotElements, marqueeSelectedShotIds, nextShotIds);
      marqueeSelectedShotIds = nextShotIds;
      selectedShotIdsRef.current = nextShotIds;
      shotSelectionAnchorIdRef.current = nextShotIds.at(-1);
      applySelectedShotCountLabel(selectedShotCountLabelRef.current, nextShotIds.length);
    }

    if (scrollDelta !== 0 && continueAutoScroll) {
      scheduleMarqueeUpdate();
    }
  }

  const handlePointerMove = (moveEvent: PointerMoveLike) => {
    latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
    scheduleMarqueeUpdate();
  };

  const handlePointerUp = () => {
    if (marqueeFrame !== undefined) {
      scheduler.cancelAnimationFrame(marqueeFrame);
      marqueeFrame = undefined;
    }
    updateMarqueeSelection(false);
    selectShotsByIds(marqueeSelectedShotIds);
    if (shouldCommitShotDeleteTarget) {
      setDeleteTarget({ type: "shot" });
    }
    hideSelectionMarquee(selectionMarqueeRef.current);
    board.classList.remove("is-marquee-selecting");
    scheduler.requestAnimationFrame(() => {
      applyMarqueeShotSelection(marqueeShotElements, marqueeSelectedShotIds, []);
    });
    eventTarget.removeEventListener("pointermove", handlePointerMove);
    eventTarget.removeEventListener("pointerup", handlePointerUp);
    eventTarget.removeEventListener("pointercancel", handlePointerUp);
  };

  eventTarget.addEventListener("pointermove", handlePointerMove);
  eventTarget.addEventListener("pointerup", handlePointerUp, { once: true });
  eventTarget.addEventListener("pointercancel", handlePointerUp, { once: true });
  scheduleMarqueeUpdate();
};

export const useStoryboardMarqueeController = ({
  currentBoardScroll,
  scrollBoardBy,
  selectShotsByIds,
  deleteTargetRef,
  selectedShotCountLabelRef,
  selectedShotIdsRef,
  selectionMarqueeRef,
  setDeleteTarget,
  shotSelectionAnchorIdRef,
  workspaceBoardScrollRef
}: Omit<StoryboardMarqueeSelectionOptions, "event" | "eventTarget" | "scheduler" | "viewportHeight">) => {
  const handleSelectionPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) =>
      startStoryboardMarqueeSelection({
        currentBoardScroll,
        event,
        eventTarget: window,
        scheduler: window,
        scrollBoardBy,
        selectShotsByIds,
        deleteTargetRef,
        selectedShotCountLabelRef,
        selectedShotIdsRef,
        selectionMarqueeRef,
        setDeleteTarget,
        shotSelectionAnchorIdRef,
        viewportHeight: () => window.innerHeight,
        workspaceBoardScrollRef
      }),
    [
      currentBoardScroll,
      scrollBoardBy,
      selectShotsByIds,
      deleteTargetRef,
      selectedShotCountLabelRef,
      selectedShotIdsRef,
      selectionMarqueeRef,
      setDeleteTarget,
      shotSelectionAnchorIdRef,
      workspaceBoardScrollRef
    ]
  );

  return { handleSelectionPointerDown };
};
