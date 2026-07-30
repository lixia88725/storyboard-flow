import { useCallback, type PointerEvent, type RefObject } from "react";
import type { DeleteTarget } from "./deleteTarget";
import type { MarqueeOverlayHandle } from "./SelectionMarquee";
import {
  createMarqueeBox,
  marqueeEdgeScrollDelta,
  marqueeHitsInBox,
  marqueeOverlayBoxRect,
  sameMarqueeSelection,
  updateMarqueeBox,
  type MarqueeViewportRect
} from "./storyboardMarquee";
import {
  applySelectedShotCountLabel,
  storyboardMarqueeShotRectsFromDom
} from "./storyboardMarqueeDom";
import type { StoryboardMediaWindowInteractionController } from "./storyboardMediaWindowInteraction";

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

type PointerEventTargetLike = {
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

type ResizeEventTargetLike = {
  addEventListener: (type: "resize", listener: () => void) => void;
  removeEventListener: (type: "resize", listener: () => void) => void;
};

type MarqueeScheduler = Pick<Window, "cancelAnimationFrame" | "requestAnimationFrame">;

type StoryboardMarqueeSelectionOptions = {
  currentBoardScroll: () => BoardScroll;
  event: PointerDownLike;
  eventTarget: PointerEventTargetLike;
  interactionController: StoryboardMediaWindowInteractionController;
  measureViewportRect: () => MarqueeViewportRect;
  resizeTarget: ResizeEventTargetLike;
  scheduler: MarqueeScheduler;
  scrollBoardBy: (options: ScrollToOptions) => void;
  selectShotsByIds: (shotIds: string[]) => void;
  deleteTargetRef: MutableRef<DeleteTarget>;
  selectedShotCountLabelRef: RefObject<HTMLSpanElement | null>;
  selectedShotIdsRef: MutableRef<string[]>;
  selectionMarqueeRef: RefObject<MarqueeOverlayHandle | null>;
  setDeleteTarget: (target: DeleteTarget) => void;
  shotSelectionAnchorIdRef: MutableRef<string | undefined>;
};

type PendingMarqueeRelease = {
  frame: number;
  release: () => void;
};

const pendingMarqueeReleases = new WeakMap<HTMLElement, PendingMarqueeRelease>();

const marqueeBlockedTargetSelector =
  "input, textarea, select, button, .image-stage, .japanese-storyboard-picture";

export const shouldStartStoryboardMarqueeSelection = (
  event: Pick<PointerDownLike, "button" | "currentTarget" | "target">
) => {
  if (event.button !== 0) {
    return false;
  }

  if (event.target === event.currentTarget) {
    return true;
  }

  if (event.currentTarget.dataset.marqueeMode !== "rows") {
    return false;
  }

  const closest = (
    event.target as { closest?: (selector: string) => Element | null } | null
  )?.closest;
  return typeof closest === "function"
    ? !closest.call(event.target, marqueeBlockedTargetSelector)
    : false;
};

const releasePendingMarquee = (board: HTMLElement, scheduler: MarqueeScheduler) => {
  const pendingRelease = pendingMarqueeReleases.get(board);
  if (!pendingRelease) {
    return;
  }
  scheduler.cancelAnimationFrame(pendingRelease.frame);
  pendingMarqueeReleases.delete(board);
  pendingRelease.release();
};

export const startStoryboardMarqueeSelection = ({
  currentBoardScroll,
  event,
  eventTarget,
  interactionController,
  measureViewportRect,
  resizeTarget,
  scheduler,
  scrollBoardBy,
  selectShotsByIds,
  deleteTargetRef,
  selectedShotCountLabelRef,
  selectedShotIdsRef,
  selectionMarqueeRef,
  setDeleteTarget,
  shotSelectionAnchorIdRef
}: StoryboardMarqueeSelectionOptions): void => {
  if (!shouldStartStoryboardMarqueeSelection(event)) {
    return;
  }

  const board = event.currentTarget;
  releasePendingMarquee(board, scheduler);
  const mediaWindowLease = interactionController.beginInteraction();
  const initialSelectedShotIds = selectedShotIdsRef.current;
  const initialBoardScroll = currentBoardScroll();
  let viewportRect = measureViewportRect();
  let marqueeShotRects = storyboardMarqueeShotRectsFromDom(board, initialBoardScroll);
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
  let lastSelectionRenderScroll = initialBoardScroll;
  let finished = false;

  board.classList.add("is-marquee-selecting");
  selectionMarqueeRef.current?.show(viewportRect);
  selectionMarqueeRef.current?.renderBox(marqueeOverlayBoxRect(nextBox, viewportRect));
  selectionMarqueeRef.current?.renderSelection([]);
  shotSelectionAnchorIdRef.current = undefined;
  selectedShotIdsRef.current = [];
  deleteTargetRef.current = { type: "shot" };
  if (selectedShotCountLabelRef.current) {
    selectedShotCountLabelRef.current.textContent = "Selecting…";
  }

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
    const scrollDelta = marqueeEdgeScrollDelta({
      pointerY: latestPointer.clientY,
      viewportTop: viewportRect.top,
      viewportHeight: viewportRect.height
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
    selectionMarqueeRef.current?.renderBox(
      marqueeOverlayBoxRect(movedBox, viewportRect)
    );

    const hits = marqueeHitsInBox(
      movedBox,
      marqueeShotRects,
      boardScroll,
      viewportRect
    );
    const selectionChanged = !sameMarqueeSelection(
      marqueeSelectedShotIds,
      hits.shotIds
    );
    const selectionMovedWithScroll =
      lastSelectionRenderScroll.x !== boardScroll.x ||
      lastSelectionRenderScroll.y !== boardScroll.y;
    if (selectionChanged || selectionMovedWithScroll) {
      selectionMarqueeRef.current?.renderSelection(hits.rects);
      lastSelectionRenderScroll = boardScroll;
    }
    if (selectionChanged) {
      marqueeSelectedShotIds = hits.shotIds;
      selectedShotIdsRef.current = hits.shotIds;
      shotSelectionAnchorIdRef.current = hits.shotIds.at(-1);
    }

    if (scrollDelta !== 0 && continueAutoScroll) {
      scheduleMarqueeUpdate();
    }
  }

  const handlePointerMove = (moveEvent: PointerMoveLike) => {
    latestPointer = {
      clientX: moveEvent.clientX,
      clientY: moveEvent.clientY
    };
    scheduleMarqueeUpdate();
  };

  const handleResize = () => {
    const boardScroll = currentBoardScroll();
    viewportRect = measureViewportRect();
    marqueeShotRects = storyboardMarqueeShotRectsFromDom(board, boardScroll);
    lastSelectionRenderScroll = { x: Number.NaN, y: Number.NaN };
    selectionMarqueeRef.current?.show(viewportRect);
    scheduleMarqueeUpdate();
  };

  const handlePointerUp = (pointerEvent: PointerMoveLike) => {
    if (finished) {
      return;
    }
    finished = true;
    latestPointer = {
      clientX: pointerEvent.clientX,
      clientY: pointerEvent.clientY
    };
    if (marqueeFrame !== undefined) {
      scheduler.cancelAnimationFrame(marqueeFrame);
      marqueeFrame = undefined;
    }
    updateMarqueeSelection(false);
    // Marquee previews keep this ref current without re-rendering every card.
    // Restore the last committed value so the selection controller does not
    // mistake the preview for an already-committed React state update.
    selectedShotIdsRef.current = initialSelectedShotIds;
    applySelectedShotCountLabel(
      selectedShotCountLabelRef.current,
      marqueeSelectedShotIds.length
    );
    selectShotsByIds(marqueeSelectedShotIds);
    if (shouldCommitShotDeleteTarget) {
      setDeleteTarget({ type: "shot" });
    }
    eventTarget.removeEventListener("pointermove", handlePointerMove);
    eventTarget.removeEventListener("pointerup", handlePointerUp);
    eventTarget.removeEventListener("pointercancel", handlePointerUp);
    resizeTarget.removeEventListener("resize", handleResize);

    const release = () => {
      board.classList.remove("is-marquee-selecting");
      selectionMarqueeRef.current?.hide();
      mediaWindowLease.release();
    };
    const frame = scheduler.requestAnimationFrame(() => {
      if (pendingMarqueeReleases.get(board)?.frame !== frame) {
        return;
      }
      pendingMarqueeReleases.delete(board);
      release();
    });
    pendingMarqueeReleases.set(board, { frame, release });
  };

  eventTarget.addEventListener("pointermove", handlePointerMove);
  eventTarget.addEventListener("pointerup", handlePointerUp, { once: true });
  eventTarget.addEventListener("pointercancel", handlePointerUp, { once: true });
  resizeTarget.addEventListener("resize", handleResize);
  scheduleMarqueeUpdate();
};

type StoryboardMarqueeHookOptions = Omit<
  StoryboardMarqueeSelectionOptions,
  | "event"
  | "eventTarget"
  | "measureViewportRect"
  | "resizeTarget"
  | "scheduler"
> & {
  workspaceBoardScrollRef: RefObject<HTMLElement | null>;
};

export const useStoryboardMarqueeController = ({
  currentBoardScroll,
  interactionController,
  scrollBoardBy,
  selectShotsByIds,
  deleteTargetRef,
  selectedShotCountLabelRef,
  selectedShotIdsRef,
  selectionMarqueeRef,
  setDeleteTarget,
  shotSelectionAnchorIdRef,
  workspaceBoardScrollRef
}: StoryboardMarqueeHookOptions) => {
  const handleSelectionPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) =>
      startStoryboardMarqueeSelection({
        currentBoardScroll,
        event,
        eventTarget: window,
        interactionController,
        measureViewportRect: () => {
          const rect = workspaceBoardScrollRef.current?.getBoundingClientRect();
          return rect
            ? {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
              }
            : {
                left: 0,
                top: 0,
                width: window.innerWidth,
                height: window.innerHeight
              };
        },
        resizeTarget: window,
        scheduler: window,
        scrollBoardBy,
        selectShotsByIds,
        deleteTargetRef,
        selectedShotCountLabelRef,
        selectedShotIdsRef,
        selectionMarqueeRef,
        setDeleteTarget,
        shotSelectionAnchorIdRef
      }),
    [
      currentBoardScroll,
      interactionController,
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
