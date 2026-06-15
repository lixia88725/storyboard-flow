import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type { Shot } from "../shared/types";
import {
  getStableBoardTop,
  getZoomPreviewState,
  maxStoryboardZoom,
  normalizeStoryboardZoom,
  type ZoomPreviewState
} from "./animationViewport";
import {
  animationReservedBottom,
  animationViewportMargin
} from "./animationModeLayoutController";
import {
  boardViewportHeight,
  currentBoardScroll as readCurrentBoardScroll,
  scrollBoardBy as scrollBoardContainerBy
} from "./boardViewport";
import type { BoardViewSize } from "./boardViewState";
import { aspectRatioForShot } from "./sketchRendering";
import { useZoomInteractionController } from "./zoomInteractionController";

type StoryboardZoomStyleVariablesInput = {
  animationFrameSize: BoardViewSize;
  animationImageSize: BoardViewSize;
  previewCssVariables: ZoomPreviewState["cssVariables"] | undefined;
  zoomLevel: number;
};

export const storyboardZoomStyleVariables = ({
  animationFrameSize,
  animationImageSize,
  previewCssVariables,
  zoomLevel
}: StoryboardZoomStyleVariablesInput): CSSProperties => ({
  "--shot-scale": previewCssVariables?.shotScale ?? zoomLevel / 100,
  "--animation-image-width":
    previewCssVariables?.animationImageWidth ?? `${animationImageSize.width}px`,
  "--animation-image-height":
    previewCssVariables?.animationImageHeight ?? `${animationImageSize.height}px`,
  "--animation-frame-width":
    previewCssVariables?.animationFrameWidth ?? `${animationFrameSize.width}px`,
  "--animation-frame-height":
    previewCssVariables?.animationFrameHeight ?? `${animationFrameSize.height}px`
} as CSSProperties);

type StoryboardZoomControllerOptions = {
  animationFrameSize: BoardViewSize;
  animationImageSize: BoardViewSize;
  appShellRef: RefObject<HTMLElement | null>;
  isAnimationModeRef: MutableRefObject<boolean>;
  isZoomScrubbing: boolean;
  isZoomScrubbingRef: MutableRefObject<boolean>;
  orderedShots: Shot[];
  primarySelectedShot: Shot | undefined;
  setAnimationFrameSize: Dispatch<SetStateAction<BoardViewSize>>;
  setAnimationImageSize: Dispatch<SetStateAction<BoardViewSize>>;
  setIsAnimationMode: Dispatch<SetStateAction<boolean>>;
  setIsZoomScrubbing: Dispatch<SetStateAction<boolean>>;
  setZoomLevel: Dispatch<SetStateAction<number>>;
  zoomLevel: number;
  zoomLevelRef: MutableRefObject<number>;
};

export const useStoryboardZoomController = ({
  animationFrameSize,
  animationImageSize,
  appShellRef,
  isAnimationModeRef,
  isZoomScrubbing,
  isZoomScrubbingRef,
  orderedShots,
  primarySelectedShot,
  setAnimationFrameSize,
  setAnimationImageSize,
  setIsAnimationMode,
  setIsZoomScrubbing,
  setZoomLevel,
  zoomLevel,
  zoomLevelRef
}: StoryboardZoomControllerOptions) => {
  const pendingZoomLevelRef = useRef<number | undefined>(undefined);
  const zoomFrameRef = useRef<number | undefined>(undefined);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const zoomValueLabelRef = useRef<HTMLSpanElement | null>(null);
  const pendingZoomPreviewLevelRef = useRef<number | undefined>(undefined);
  const zoomPreviewFrameRef = useRef<number | undefined>(undefined);
  const zoomPreviewStateRef = useRef<ZoomPreviewState | undefined>(undefined);
  const workspaceBoardScrollRef = useRef<HTMLDivElement | null>(null);
  const boardGridRef = useRef<HTMLElement | null>(null);

  const syncZoomControlDisplay = useCallback((zoom: number) => {
    const normalizedZoom = normalizeStoryboardZoom(zoom);
    const zoomValue = String(normalizedZoom);
    if (zoomInputRef.current && zoomInputRef.current.value !== zoomValue) {
      zoomInputRef.current.value = zoomValue;
    }
    if (zoomValueLabelRef.current) {
      zoomValueLabelRef.current.textContent = `${normalizedZoom}%`;
    }
  }, []);

  const applyZoomPreviewCssVariables = useCallback((preview: ZoomPreviewState) => {
    const board = boardGridRef.current;
    if (!board) {
      return;
    }

    board.style.setProperty("--shot-scale", preview.cssVariables.shotScale);
    board.style.setProperty("--animation-image-width", preview.cssVariables.animationImageWidth);
    board.style.setProperty("--animation-image-height", preview.cssVariables.animationImageHeight);
    board.style.setProperty("--animation-frame-width", preview.cssVariables.animationFrameWidth);
    board.style.setProperty("--animation-frame-height", preview.cssVariables.animationFrameHeight);
  }, []);

  const currentBoardScroll = useCallback(
    () => readCurrentBoardScroll(workspaceBoardScrollRef.current),
    []
  );
  const currentBoardViewportHeight = useCallback(
    () => boardViewportHeight(workspaceBoardScrollRef.current),
    []
  );
  const scrollBoardBy = useCallback(
    (options: ScrollToOptions) => scrollBoardContainerBy(workspaceBoardScrollRef.current, options),
    []
  );

  const buildZoomPreviewState = useCallback(
    (zoom: number): ZoomPreviewState | undefined => {
      const board = boardGridRef.current;
      const firstShot = board?.querySelector<HTMLElement>("[data-shot-id]");
      if (!board || !firstShot) {
        return undefined;
      }

      const boardRect = board.getBoundingClientRect();
      const boardScroll = currentBoardScroll();
      const viewportShot = primarySelectedShot ?? orderedShots[0];
      return getZoomPreviewState({
        boardWidth: boardRect.width,
        boardTop: getStableBoardTop(boardRect.top, boardScroll.y),
        viewportHeight: currentBoardViewportHeight(),
        reservedBottom: animationReservedBottom,
        margin: animationViewportMargin,
        zoomLevel: zoom,
        maxZoomLevel: maxStoryboardZoom,
        isAnimationMode: isAnimationModeRef.current,
        imageAspectRatio: viewportShot ? aspectRatioForShot(viewportShot) : 420 / 265
      });
    },
    [currentBoardScroll, currentBoardViewportHeight, isAnimationModeRef, orderedShots, primarySelectedShot]
  );

  const applyZoomPreviewState = useCallback(
    (preview: ZoomPreviewState) => {
      zoomPreviewStateRef.current = preview;
      zoomLevelRef.current = preview.zoomLevel;
      applyZoomPreviewCssVariables(preview);
      syncZoomControlDisplay(preview.zoomLevel);

      if (preview.viewport.isAnimationMode !== isAnimationModeRef.current) {
        isAnimationModeRef.current = preview.viewport.isAnimationMode;
        setIsAnimationMode(preview.viewport.isAnimationMode);
      }
    },
    [applyZoomPreviewCssVariables, isAnimationModeRef, setIsAnimationMode, syncZoomControlDisplay, zoomLevelRef]
  );

  useEffect(() => {
    if (!isZoomScrubbingRef.current) {
      zoomPreviewStateRef.current = undefined;
      syncZoomControlDisplay(zoomLevel);
    }
  }, [isZoomScrubbingRef, syncZoomControlDisplay, zoomLevel]);

  const commitZoomLevel = useCallback((zoom: number) => {
    const nextZoom = normalizeStoryboardZoom(zoom);
    zoomLevelRef.current = nextZoom;
    setZoomLevel((currentZoom) => (currentZoom === nextZoom ? currentZoom : nextZoom));
  }, [setZoomLevel, zoomLevelRef]);

  const scheduleZoomLevel = useCallback(
    (zoom: number) => {
      pendingZoomLevelRef.current = normalizeStoryboardZoom(zoom);
      if (zoomFrameRef.current !== undefined) {
        return;
      }

      zoomFrameRef.current = window.requestAnimationFrame(() => {
        zoomFrameRef.current = undefined;
        const nextZoom = pendingZoomLevelRef.current;
        pendingZoomLevelRef.current = undefined;
        if (nextZoom !== undefined) {
          commitZoomLevel(nextZoom);
        }
      });
    },
    [commitZoomLevel]
  );

  const scheduleZoomPreviewLevel = useCallback(
    (zoom: number) => {
      pendingZoomPreviewLevelRef.current = normalizeStoryboardZoom(zoom);
      if (zoomPreviewFrameRef.current !== undefined) {
        return;
      }

      zoomPreviewFrameRef.current = window.requestAnimationFrame(() => {
        zoomPreviewFrameRef.current = undefined;
        const nextZoom = pendingZoomPreviewLevelRef.current;
        pendingZoomPreviewLevelRef.current = undefined;
        if (nextZoom === undefined) {
          return;
        }

        const preview = buildZoomPreviewState(nextZoom);
        if (preview) {
          applyZoomPreviewState(preview);
        } else {
          syncZoomControlDisplay(nextZoom);
        }
      });
    },
    [applyZoomPreviewState, buildZoomPreviewState, syncZoomControlDisplay]
  );

  const flushScheduledZoomLevel = useCallback(() => {
    if (zoomFrameRef.current !== undefined) {
      window.cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = undefined;
    }

    const nextZoom = pendingZoomLevelRef.current;
    pendingZoomLevelRef.current = undefined;
    if (nextZoom !== undefined) {
      commitZoomLevel(nextZoom);
    }
  }, [commitZoomLevel]);

  const flushZoomPreviewLevel = useCallback(() => {
    if (zoomPreviewFrameRef.current !== undefined) {
      window.cancelAnimationFrame(zoomPreviewFrameRef.current);
      zoomPreviewFrameRef.current = undefined;
    }

    const nextZoom =
      pendingZoomPreviewLevelRef.current ??
      zoomPreviewStateRef.current?.zoomLevel ??
      zoomLevelRef.current;
    pendingZoomPreviewLevelRef.current = undefined;
    const preview = buildZoomPreviewState(nextZoom);
    if (!preview) {
      commitZoomLevel(nextZoom);
      syncZoomControlDisplay(nextZoom);
      return;
    }

    applyZoomPreviewState(preview);
    isAnimationModeRef.current = preview.viewport.isAnimationMode;
    setIsAnimationMode(preview.viewport.isAnimationMode);
    setAnimationImageSize({ width: preview.viewport.imageWidth, height: preview.viewport.imageHeight });
    setAnimationFrameSize({ width: preview.viewport.frameWidth, height: preview.viewport.frameHeight });
    commitZoomLevel(preview.zoomLevel);
  }, [
    applyZoomPreviewState,
    buildZoomPreviewState,
    commitZoomLevel,
    isAnimationModeRef,
    setAnimationFrameSize,
    setAnimationImageSize,
    setIsAnimationMode,
    syncZoomControlDisplay,
    zoomLevelRef
  ]);

  const beginZoomScrubbing = useCallback(() => {
    flushScheduledZoomLevel();
    isZoomScrubbingRef.current = true;
    const preview = buildZoomPreviewState(zoomLevelRef.current);
    if (preview) {
      applyZoomPreviewState(preview);
    }
    setIsZoomScrubbing(true);
  }, [
    applyZoomPreviewState,
    buildZoomPreviewState,
    flushScheduledZoomLevel,
    isZoomScrubbingRef,
    setIsZoomScrubbing,
    zoomLevelRef
  ]);

  const endZoomScrubbing = useCallback(() => {
    if (!isZoomScrubbingRef.current) {
      return;
    }

    flushZoomPreviewLevel();
    isZoomScrubbingRef.current = false;
    setIsZoomScrubbing(false);
  }, [flushZoomPreviewLevel, isZoomScrubbingRef, setIsZoomScrubbing]);

  useEffect(
    () => () => {
      if (zoomFrameRef.current !== undefined) {
        window.cancelAnimationFrame(zoomFrameRef.current);
      }
      if (zoomPreviewFrameRef.current !== undefined) {
        window.cancelAnimationFrame(zoomPreviewFrameRef.current);
      }
    },
    []
  );

  useZoomInteractionController({
    appShellRef,
    endZoomScrubbing,
    isZoomScrubbing,
    pendingZoomLevelRef,
    scheduleZoomLevel,
    zoomLevelRef
  });

  const handleZoomInputChange = useCallback(
    (zoom: number) => {
      if (isZoomScrubbingRef.current) {
        scheduleZoomPreviewLevel(zoom);
      } else {
        scheduleZoomLevel(zoom);
      }
    },
    [isZoomScrubbingRef, scheduleZoomLevel, scheduleZoomPreviewLevel]
  );

  return {
    beginZoomScrubbing,
    boardGridRef,
    boardZoomStyle: storyboardZoomStyleVariables({
      animationFrameSize,
      animationImageSize,
      previewCssVariables: zoomPreviewStateRef.current?.cssVariables,
      zoomLevel
    }),
    currentBoardScroll,
    endZoomScrubbing,
    handleZoomInputChange,
    scrollBoardBy,
    workspaceBoardScrollRef,
    zoomInputRef,
    zoomValueLabelRef
  };
};
