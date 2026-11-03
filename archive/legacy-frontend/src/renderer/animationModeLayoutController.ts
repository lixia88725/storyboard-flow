import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Shot } from "../shared/types";
import {
  getAnimationViewport,
  getStableBoardTop,
  maxStoryboardZoom,
  sameAnimationViewport,
  type AnimationViewport,
  type AnimationViewportInput
} from "./animationViewport";
import type { BoardViewSize } from "./boardViewState";
import {
  boardViewportHeight,
  currentBoardScroll as readCurrentBoardScroll,
  scrollBoardBy as scrollBoardContainerBy
} from "./boardViewport";
import { aspectRatioForShot } from "./sketchRendering";
import { scrollDeltaToCenterInReservedViewport } from "./viewportGeometry";

export const animationReservedBottom = 180;
export const animationViewportMargin = 14;

type RectLike = {
  top: number;
  bottom: number;
};

type ElementRectLike = RectLike & {
  height: number;
};

type BoardElement = Pick<HTMLElement, "getBoundingClientRect" | "querySelector">;
type BoardScrollContainer = Pick<
  HTMLElement,
  "clientHeight" | "getBoundingClientRect" | "scrollBy" | "scrollLeft" | "scrollTop"
>;

export const animationShotChromeHeightFromElement = (shotElement: Partial<BoardElement>): number | undefined => {
  if (
    typeof shotElement.getBoundingClientRect !== "function" ||
    typeof shotElement.querySelector !== "function"
  ) {
    return undefined;
  }

  const imageStage = shotElement.querySelector<HTMLElement>(".image-stage");
  if (!imageStage || typeof imageStage.getBoundingClientRect !== "function") {
    return undefined;
  }

  const shotRect = shotElement.getBoundingClientRect();
  const imageRect = imageStage.getBoundingClientRect();
  const chromeHeight = shotRect.height - imageRect.height;
  if (!Number.isFinite(chromeHeight) || chromeHeight <= 0) {
    return undefined;
  }

  const roundedHeight = Math.round(chromeHeight);
  return roundedHeight > 0 ? roundedHeight : undefined;
};

export const animationCenteringScrollDelta = ({
  elementRect,
  scrollContainerRect,
  scrollContainerHeight,
  timelineRect,
  margin
}: {
  elementRect: ElementRectLike;
  scrollContainerRect: RectLike;
  scrollContainerHeight: number;
  timelineRect?: Pick<RectLike, "top">;
  margin: number;
}): number => {
  const localElementRect = {
    top: elementRect.top - scrollContainerRect.top,
    bottom: elementRect.bottom - scrollContainerRect.top,
    height: elementRect.height
  };
  const reservedBottom = timelineRect
    ? Math.max(0, scrollContainerRect.bottom - timelineRect.top)
    : animationReservedBottom;

  return scrollDeltaToCenterInReservedViewport(localElementRect, {
    height: scrollContainerHeight,
    reservedBottom,
    margin
  });
};

export const animationViewportInputFromBoard = ({
  board,
  scrollContainer,
  viewportShot,
  zoomLevel,
  isAnimationMode
}: AnimationViewportFromBoardOptions): AnimationViewportInput | undefined => {
  const firstShot =
    board && viewportShot
      ? board.querySelector<HTMLElement>(`[data-shot-id="${viewportShot.id}"]`) ??
        board.querySelector<HTMLElement>("[data-shot-id]")
      : board?.querySelector<HTMLElement>("[data-shot-id]");
  if (!board || !firstShot) {
    return undefined;
  }

  const boardRect = board.getBoundingClientRect();
  const shotRect =
    typeof firstShot.getBoundingClientRect === "function"
      ? firstShot.getBoundingClientRect()
      : boardRect;
  const scrollContainerRect = scrollContainer?.getBoundingClientRect();
  const boardScroll = readCurrentBoardScroll(scrollContainer);
  const timelineRect =
    typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(".timeline")?.getBoundingClientRect()
      : undefined;
  const reservedBottom =
    scrollContainerRect && timelineRect
      ? Math.max(0, scrollContainerRect.bottom - timelineRect.top)
      : animationReservedBottom;
  const cardChromeHeight = isAnimationMode
    ? animationShotChromeHeightFromElement(firstShot)
    : undefined;

  return {
    boardWidth: scrollContainerRect?.width ?? boardRect.width,
    boardTop: getStableBoardTop(
      scrollContainerRect ? shotRect.top - scrollContainerRect.top : shotRect.top,
      boardScroll.y
    ),
    viewportHeight: boardViewportHeight(scrollContainer),
    reservedBottom,
    margin: animationViewportMargin,
    zoomLevel,
    maxZoomLevel: maxStoryboardZoom,
    isAnimationMode,
    imageAspectRatio: viewportShot ? aspectRatioForShot(viewportShot) : 420 / 265,
    ...(cardChromeHeight !== undefined ? { cardChromeHeight } : {})
  };
};

type AnimationViewportFromBoardOptions = {
  board: BoardElement | null;
  scrollContainer: BoardScrollContainer | null;
  viewportShot: Shot | undefined;
  zoomLevel: number;
  isAnimationMode: boolean;
};

export const animationViewportFromBoard = ({
  board,
  scrollContainer,
  viewportShot,
  zoomLevel,
  isAnimationMode
}: AnimationViewportFromBoardOptions): AnimationViewport | undefined => {
  const input = animationViewportInputFromBoard({
    board,
    scrollContainer,
    viewportShot,
    zoomLevel,
    isAnimationMode
  });

  return input ? getAnimationViewport(input) : undefined;
};

type UseAnimationModeLayoutControllerOptions = {
  animationFrameSize: BoardViewSize;
  animationImageSize: BoardViewSize;
  boardGridRef: RefObject<HTMLElement | null>;
  isAnimationMode: boolean;
  isZoomScrubbing: boolean;
  orderedShots: Shot[];
  primarySelectedShot: Shot | undefined;
  selectedShotIds: string[];
  setAnimationFrameSize: Dispatch<SetStateAction<BoardViewSize>>;
  setAnimationImageSize: Dispatch<SetStateAction<BoardViewSize>>;
  setIsAnimationMode: Dispatch<SetStateAction<boolean>>;
  workspaceBoardScrollRef: RefObject<HTMLDivElement | null>;
  zoomLevel: number;
};

export const useAnimationModeLayoutController = ({
  animationFrameSize,
  animationImageSize,
  boardGridRef,
  isAnimationMode,
  isZoomScrubbing,
  orderedShots,
  primarySelectedShot,
  selectedShotIds,
  setAnimationFrameSize,
  setAnimationImageSize,
  setIsAnimationMode,
  workspaceBoardScrollRef,
  zoomLevel
}: UseAnimationModeLayoutControllerOptions): void => {
  const measureAnimationMode = useCallback(() => {
    if (isZoomScrubbing) {
      return;
    }

    const viewport = animationViewportFromBoard({
      board: boardGridRef.current,
      scrollContainer: workspaceBoardScrollRef.current,
      viewportShot: primarySelectedShot ?? orderedShots[0],
      zoomLevel,
      isAnimationMode
    });
    if (!viewport) {
      setIsAnimationMode(false);
      return;
    }

    const currentViewport = {
      isAnimationMode,
      imageWidth: animationImageSize.width,
      imageHeight: animationImageSize.height,
      frameWidth: animationFrameSize.width,
      frameHeight: animationFrameSize.height
    };
    if (sameAnimationViewport(viewport, currentViewport)) {
      return;
    }

    setIsAnimationMode(viewport.isAnimationMode);
    setAnimationImageSize({ width: viewport.imageWidth, height: viewport.imageHeight });
    setAnimationFrameSize({ width: viewport.frameWidth, height: viewport.frameHeight });
  }, [
    animationFrameSize.height,
    animationFrameSize.width,
    animationImageSize.height,
    animationImageSize.width,
    boardGridRef,
    isAnimationMode,
    isZoomScrubbing,
    orderedShots,
    primarySelectedShot,
    setAnimationFrameSize,
    setAnimationImageSize,
    setIsAnimationMode,
    workspaceBoardScrollRef,
    zoomLevel
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureAnimationMode);
    window.addEventListener("resize", measureAnimationMode);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureAnimationMode);
    };
  }, [measureAnimationMode]);

  useEffect(() => {
    if (!isAnimationMode || isZoomScrubbing || !selectedShotIds[0]) {
      return;
    }

    const element = document
      .querySelector<HTMLElement>(`[data-shot-id="${selectedShotIds[0]}"]`)
      ?.querySelector<HTMLElement>(".image-stage");
    if (!element) {
      return;
    }

    const scrollContainer = workspaceBoardScrollRef.current;
    const scrollContainerRect = scrollContainer?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight
    };
    const timelineRect = document.querySelector<HTMLElement>(".timeline")?.getBoundingClientRect();
    const delta = animationCenteringScrollDelta({
      elementRect: element.getBoundingClientRect(),
      scrollContainerRect,
      scrollContainerHeight: boardViewportHeight(scrollContainer),
      timelineRect,
      margin: animationViewportMargin
    });

    if (delta !== 0) {
      scrollBoardContainerBy(workspaceBoardScrollRef.current, { top: delta, behavior: "instant" });
    }
  }, [
    animationImageSize.height,
    animationImageSize.width,
    isAnimationMode,
    isZoomScrubbing,
    selectedShotIds,
    workspaceBoardScrollRef
  ]);
};
