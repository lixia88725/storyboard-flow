import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import type { Shot } from "../shared/types";
import {
  getZoomPreviewState,
  nextKeyboardStoryboardZoom,
  normalizeStoryboardZoom,
  type ZoomPreviewState
} from "./animationViewport";
import { animationViewportInputFromBoard } from "./animationModeLayoutController";
import {
  currentBoardScroll as readCurrentBoardScroll,
  scrollBoardBy as scrollBoardContainerBy
} from "./boardViewport";
import type { BoardViewSize } from "./boardViewState";
import {
  captureStoryboardZoomAnchor,
  restoreStoryboardZoomAnchor,
  type ZoomAnchorSnapshot,
  type ZoomClientPoint
} from "./storyboardZoomAnchorController";
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

type StoryboardZoomPreviewStateFromBoardOptions = {
  board: HTMLElement | null;
  scrollContainer: HTMLDivElement | null;
  viewportShot: Shot | undefined;
  zoomLevel: number;
  isAnimationMode: boolean;
};

export const storyboardZoomPreviewStateFromBoard = ({
  board,
  scrollContainer,
  viewportShot,
  zoomLevel,
  isAnimationMode
}: StoryboardZoomPreviewStateFromBoardOptions): ZoomPreviewState | undefined => {
  const input = animationViewportInputFromBoard({
    board,
    scrollContainer,
    viewportShot,
    zoomLevel,
    isAnimationMode
  });

  return input ? getZoomPreviewState(input) : undefined;
};

export const applyZoomPreviewCssVariablesToBoard = (
  board: HTMLElement,
  cssVariables: ZoomPreviewState["cssVariables"]
): void => {
  board.style.setProperty("--shot-scale", cssVariables.shotScale);
  board.style.setProperty("--japanese-storyboard-zoom", cssVariables.shotScale);
  board.style.setProperty("--animation-image-width", cssVariables.animationImageWidth);
  board.style.setProperty("--animation-image-height", cssVariables.animationImageHeight);
  board.style.setProperty("--animation-frame-width", cssVariables.animationFrameWidth);
  board.style.setProperty("--animation-frame-height", cssVariables.animationFrameHeight);
};

type StoryboardZoomControllerOptions = {
  animationFrameSize: BoardViewSize;
  animationImageSize: BoardViewSize;
  isAnimationMode: boolean;
  isAnimationModeRef: MutableRefObject<boolean>;
  isZoomScrubbing: boolean;
  isZoomScrubbingRef: MutableRefObject<boolean>;
  orderedShots: Shot[];
  primarySelectedShot: Shot | undefined;
  selectedShotIds: string[];
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
  isAnimationMode,
  isAnimationModeRef,
  isZoomScrubbing,
  isZoomScrubbingRef,
  orderedShots,
  primarySelectedShot,
  selectedShotIds,
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
  const zoomAnchorRef = useRef<ZoomAnchorSnapshot | undefined>(undefined);
  const pendingZoomAnchorRestoreRef = useRef(false);
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

    applyZoomPreviewCssVariablesToBoard(board, preview.cssVariables);
  }, []);

  const currentBoardScroll = useCallback(
    () => readCurrentBoardScroll(workspaceBoardScrollRef.current),
    []
  );
  const scrollBoardBy = useCallback(
    (options: ScrollToOptions) => scrollBoardContainerBy(workspaceBoardScrollRef.current, options),
    []
  );
  const captureZoomAnchor = useCallback(
    (clientPoint?: ZoomClientPoint, replace = false) => {
      if (!replace && zoomAnchorRef.current) {
        return zoomAnchorRef.current;
      }

      const anchor = captureStoryboardZoomAnchor({
        board: boardGridRef.current,
        clientPoint,
        scrollContainer: workspaceBoardScrollRef.current,
        selectedShotIds
      });
      zoomAnchorRef.current = anchor;
      return anchor;
    },
    [selectedShotIds]
  );
  const restoreZoomAnchor = useCallback(() => {
    restoreStoryboardZoomAnchor({
      anchor: zoomAnchorRef.current,
      board: boardGridRef.current,
      scrollContainer: workspaceBoardScrollRef.current
    });
  }, []);

  const buildZoomPreviewState = useCallback(
    (zoom: number): ZoomPreviewState | undefined => {
      const board = boardGridRef.current;
      const viewportShot = primarySelectedShot ?? orderedShots[0];
      return storyboardZoomPreviewStateFromBoard({
        board,
        scrollContainer: workspaceBoardScrollRef.current,
        viewportShot,
        zoomLevel: zoom,
        isAnimationMode: isAnimationModeRef.current
      });
    },
    [isAnimationModeRef, orderedShots, primarySelectedShot]
  );

  const applyZoomPreviewState = useCallback(
    (preview: ZoomPreviewState) => {
      zoomPreviewStateRef.current = preview;
      zoomLevelRef.current = preview.zoomLevel;
      applyZoomPreviewCssVariables(preview);
      restoreZoomAnchor();
      syncZoomControlDisplay(preview.zoomLevel);

      if (preview.viewport.isAnimationMode !== isAnimationModeRef.current) {
        pendingZoomAnchorRestoreRef.current = Boolean(zoomAnchorRef.current);
        isAnimationModeRef.current = preview.viewport.isAnimationMode;
        setIsAnimationMode(preview.viewport.isAnimationMode);
      }
    },
    [
      applyZoomPreviewCssVariables,
      isAnimationModeRef,
      restoreZoomAnchor,
      setIsAnimationMode,
      syncZoomControlDisplay,
      zoomLevelRef
    ]
  );

  useEffect(() => {
    if (!isZoomScrubbingRef.current) {
      zoomPreviewStateRef.current = undefined;
      syncZoomControlDisplay(zoomLevel);
    }
  }, [isZoomScrubbingRef, syncZoomControlDisplay, zoomLevel]);

  const commitZoomLevel = useCallback((zoom: number) => {
    const nextZoom = normalizeStoryboardZoom(zoom);
    pendingZoomAnchorRestoreRef.current = Boolean(zoomAnchorRef.current);
    zoomLevelRef.current = nextZoom;
    setZoomLevel((currentZoom) => (currentZoom === nextZoom ? currentZoom : nextZoom));
  }, [setZoomLevel, zoomLevelRef]);

  useLayoutEffect(() => {
    if (!pendingZoomAnchorRestoreRef.current) {
      return;
    }

    restoreZoomAnchor();
    pendingZoomAnchorRestoreRef.current = false;
    if (!isZoomScrubbingRef.current) {
      zoomAnchorRef.current = undefined;
    }
  }, [
    isAnimationMode,
    isZoomScrubbing,
    restoreZoomAnchor,
    zoomLevel,
    isZoomScrubbingRef
  ]);

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

  const beginZoomScrubbing = useCallback((clientPoint?: ZoomClientPoint) => {
    flushScheduledZoomLevel();
    captureZoomAnchor(clientPoint, true);
    isZoomScrubbingRef.current = true;
    const preview = buildZoomPreviewState(zoomLevelRef.current);
    if (preview) {
      applyZoomPreviewState(preview);
    }
    setIsZoomScrubbing(true);
  }, [
    applyZoomPreviewState,
    buildZoomPreviewState,
    captureZoomAnchor,
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
    endZoomScrubbing,
    isZoomScrubbing
  });

  const handleZoomInputChange = useCallback(
    (zoom: number) => {
      if (isZoomScrubbingRef.current) {
        scheduleZoomPreviewLevel(zoom);
      } else {
        captureZoomAnchor();
        scheduleZoomLevel(zoom);
      }
    },
    [captureZoomAnchor, isZoomScrubbingRef, scheduleZoomLevel, scheduleZoomPreviewLevel]
  );

  const handleStoryboardZoomShortcut = useCallback(
    (direction: "in" | "out", clientPoint?: ZoomClientPoint) => {
      captureZoomAnchor(clientPoint);
      const currentZoom = pendingZoomLevelRef.current ?? zoomLevelRef.current;
      scheduleZoomLevel(nextKeyboardStoryboardZoom(currentZoom, direction));
    },
    [captureZoomAnchor, scheduleZoomLevel, zoomLevelRef]
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
    handleStoryboardZoomShortcut,
    handleZoomInputChange,
    scrollBoardBy,
    workspaceBoardScrollRef,
    zoomInputRef,
    zoomValueLabelRef
  };
};
