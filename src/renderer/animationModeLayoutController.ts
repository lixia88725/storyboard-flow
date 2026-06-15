import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Shot } from "../shared/types";
import {
  getAnimationViewport,
  getStableBoardTop,
  maxStoryboardZoom,
  sameAnimationViewport,
  type AnimationViewport
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

type BoardElement = Pick<HTMLElement, "getBoundingClientRect" | "querySelector">;
type BoardScrollContainer = Pick<
  HTMLElement,
  "clientHeight" | "scrollBy" | "scrollLeft" | "scrollTop"
>;

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
  const firstShot = board?.querySelector<HTMLElement>("[data-shot-id]");
  if (!board || !firstShot) {
    return undefined;
  }

  const boardRect = board.getBoundingClientRect();
  const boardScroll = readCurrentBoardScroll(scrollContainer);
  return getAnimationViewport({
    boardWidth: boardRect.width,
    boardTop: getStableBoardTop(boardRect.top, boardScroll.y),
    viewportHeight: boardViewportHeight(scrollContainer),
    reservedBottom: animationReservedBottom,
    margin: animationViewportMargin,
    zoomLevel,
    maxZoomLevel: maxStoryboardZoom,
    isAnimationMode,
    imageAspectRatio: viewportShot ? aspectRatioForShot(viewportShot) : 420 / 265
  });
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

    const timeline = document.querySelector<HTMLElement>(".timeline");
    const reservedBottom = timeline
      ? window.innerHeight - timeline.getBoundingClientRect().top
      : animationReservedBottom;
    const delta = scrollDeltaToCenterInReservedViewport(element.getBoundingClientRect(), {
      height: boardViewportHeight(workspaceBoardScrollRef.current),
      reservedBottom,
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
