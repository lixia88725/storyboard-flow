import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { BitmapLayer, Shot, SketchTool } from "../shared/types";
import { activeVisibleBitmapLayerForShot, primaryShotOrFirst } from "./activeTargets";
import {
  adjustSketchShortcutValue,
  clipboardActionFromKeyboardEvent,
  isSaveShortcutFromKeyboardEvent,
  shortcutActionFromKeyboardEvent,
  storyboardZoomActionFromKeyboardEvent,
  shouldIgnoreShortcutForTarget
} from "./keyboardShortcuts";
import {
  nextKeyboardShotSelection,
  useGlobalKeyboardController,
  type KeyboardSelectionDirection
} from "./globalKeyboardController";
import type { SelectedBitmapLayerIds } from "./storyboardInteractionState";
import type { ZoomClientPoint } from "./storyboardZoomAnchorController";
import { hasOpenWorkspaceMenu } from "./workspaceMenuController";

const minBrushSize = 1;
const maxBrushSize = 28;
const minEraserSize = 4;
const maxEraserSize = 64;
const minSketchOpacity = 0.2;
const maxSketchOpacity = 1;

type StateSetter<T> = (value: T | ((current: T) => T)) => void;
type MaybePromise = void | Promise<unknown>;
type TemporarySketchToolOverride = {
  key: "alt" | "e";
  tool: "eyedropper" | "eraser";
};
type PendingEraserHold = {
  key: "e";
  timerId: ReturnType<typeof globalThis.setTimeout>;
};

export const eraserHoldDelayMs = 180;
export const zZoomCursorClassName = "is-z-zoom-active";

export type AppKeyboardShortcutsControllerOptions = {
  activeSketchTool: SketchTool;
  isAddShotMenuOpen: boolean;
  isAnimationMode: boolean;
  isImportHelpOpen: boolean;
  isRecentMenuOpen: boolean;
  isSaveMenuOpen: boolean;
  orderedShots: Shot[];
  selectedBitmapLayerIdsRef: MutableRefObject<SelectedBitmapLayerIds | undefined>;
  selectedShotIdsRef: MutableRefObject<string[]>;
  shotSelectionAnchorIdRef: MutableRefObject<string | undefined>;
  measureGridColumns: () => number;
  hasOpenShortcutBlockingMenu: () => boolean;
  handleAddShot: () => MaybePromise;
  handleClearBitmapLayer: (shotId: string, layerId: string) => MaybePromise;
  handleCopySelection: () => void;
  handleDeleteKeyPress: () => MaybePromise;
  handleMergeBitmapLayers: (
    shotId: string,
    activeLayerId: string,
    selectedLayerIds: string[]
  ) => MaybePromise;
  handlePasteSelection: () => MaybePromise;
  handleSaveProject: () => MaybePromise;
  handleStoryboardZoomShortcut: (
    direction: "in" | "out",
    clientPoint?: ZoomClientPoint
  ) => void;
  applyRedoEntry: () => MaybePromise;
  applyUndoEntry: () => MaybePromise;
  setActiveSketchTool: (tool: SketchTool) => void;
  setBrushOpacity: StateSetter<number>;
  setBrushSize: StateSetter<number>;
  setEraserOpacity: StateSetter<number>;
  setEraserSize: StateSetter<number>;
  setIsSpacePanActive: StateSetter<boolean>;
  setIsOnionSkinEnabled: StateSetter<boolean>;
  setSelectedShotIds: StateSetter<string[]>;
  setStatus: (status: string) => void;
  zZoomActiveRef: MutableRefObject<boolean>;
};

type AppKeyboardShortcutsHandlerOptions = AppKeyboardShortcutsControllerOptions & {
  pendingEraserHoldRef: MutableRefObject<PendingEraserHold | undefined>;
  spacePanActiveRef: MutableRefObject<boolean>;
  temporarySketchToolOverrideRef: MutableRefObject<TemporarySketchToolOverride | undefined>;
};

const activeShotAndLayer = (
  orderedShots: Shot[],
  selectedShotIds: string[]
): { activeShot: Shot; activeLayer: BitmapLayer } | undefined => {
  const activeShot = primaryShotOrFirst(orderedShots, selectedShotIds);
  const activeLayer = activeShot ? activeVisibleBitmapLayerForShot(activeShot) : undefined;
  return activeShot && activeLayer ? { activeShot, activeLayer } : undefined;
};

const setZZoomCursorActive = (isActive: boolean): void => {
  const classList = globalThis.document?.body?.classList;
  if (!classList) {
    return;
  }

  if (isActive) {
    classList.add(zZoomCursorClassName);
  } else {
    classList.remove(zZoomCursorClassName);
  }
};

const clearZZoomState = (zZoomActiveRef: MutableRefObject<boolean>): void => {
  zZoomActiveRef.current = false;
  setZZoomCursorActive(false);
};

const setSpacePanActive = (
  spacePanActiveRef: MutableRefObject<boolean>,
  setIsSpacePanActive: StateSetter<boolean>,
  isActive: boolean
): void => {
  spacePanActiveRef.current = isActive;
  setIsSpacePanActive(isActive);
};

export const createAppKeyboardKeyDownHandler = ({
  activeSketchTool,
  isAddShotMenuOpen,
  isAnimationMode,
  isImportHelpOpen,
  isRecentMenuOpen,
  isSaveMenuOpen,
  orderedShots,
  selectedBitmapLayerIdsRef,
  selectedShotIdsRef,
  shotSelectionAnchorIdRef,
  measureGridColumns,
  hasOpenShortcutBlockingMenu,
  handleAddShot,
  handleClearBitmapLayer,
  handleCopySelection,
  handleDeleteKeyPress,
  handleMergeBitmapLayers,
  handlePasteSelection,
  handleSaveProject,
  handleStoryboardZoomShortcut,
  applyRedoEntry,
  applyUndoEntry,
  setActiveSketchTool,
  setBrushOpacity,
  setBrushSize,
  setEraserOpacity,
  setEraserSize,
  setIsSpacePanActive,
  setIsOnionSkinEnabled,
  setSelectedShotIds,
  setStatus,
  pendingEraserHoldRef,
  spacePanActiveRef,
  temporarySketchToolOverrideRef,
  zZoomActiveRef
}: AppKeyboardShortcutsHandlerOptions): ((event: KeyboardEvent) => void) => {
  const moveSelection = (direction: KeyboardSelectionDirection) => {
    setSelectedShotIds((current) => {
      const selection = nextKeyboardShotSelection({
        currentSelectedIds: current,
        direction,
        gridColumns: measureGridColumns(),
        isAnimationMode,
        orderedShotIds: orderedShots.map((shot) => shot.id)
      });
      shotSelectionAnchorIdRef.current = selection.anchorId;
      selectedShotIdsRef.current = selection.selectedIds;
      return selection.selectedIds;
    });
  };

  return (event: KeyboardEvent) => {
    const target = event.target;
    if (isSaveShortcutFromKeyboardEvent(event)) {
      event.preventDefault();
      if (!event.repeat) {
        void handleSaveProject();
      }
      return;
    }

    const storyboardZoomAction = storyboardZoomActionFromKeyboardEvent(event);
    const isMenuOpen =
      hasOpenWorkspaceMenu({
        isAddShotMenuOpen,
        isImportHelpOpen,
        isRecentMenuOpen,
        isSaveMenuOpen
      }) ||
      hasOpenShortcutBlockingMenu();
    if (isMenuOpen) {
      if (storyboardZoomAction) {
        event.preventDefault();
      }
      return;
    }

    const key = event.key.toLowerCase();
    if (storyboardZoomAction) {
      event.preventDefault();
      handleStoryboardZoomShortcut(storyboardZoomAction);
      return;
    }

    const shortcutAction = shortcutActionFromKeyboardEvent(event);
    if (shouldIgnoreShortcutForTarget(target, shortcutAction, isAnimationMode)) {
      return;
    }

    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      (event.code === "Space" || event.key === " ")
    ) {
      event.preventDefault();
      setSpacePanActive(spacePanActiveRef, setIsSpacePanActive, true);
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "z") {
      event.preventDefault();
      zZoomActiveRef.current = true;
      setZZoomCursorActive(true);
      return;
    }

    if (
      activeSketchTool === "brush" &&
      !event.repeat &&
      !temporarySketchToolOverrideRef.current &&
      event.key === "Alt"
    ) {
      event.preventDefault();
      temporarySketchToolOverrideRef.current = { key: "alt", tool: "eyedropper" };
      setActiveSketchTool("eyedropper");
      return;
    }

    if (activeSketchTool === "brush" && !event.metaKey && !event.ctrlKey && !event.altKey && key === "e") {
      event.preventDefault();
      if (event.repeat || pendingEraserHoldRef.current || temporarySketchToolOverrideRef.current) {
        return;
      }

      const timerId = globalThis.setTimeout(() => {
        if (pendingEraserHoldRef.current?.timerId !== timerId) {
          return;
        }

        pendingEraserHoldRef.current = undefined;
        temporarySketchToolOverrideRef.current = { key: "e", tool: "eraser" };
      }, eraserHoldDelayMs);

      pendingEraserHoldRef.current = { key: "e", timerId };
      setActiveSketchTool("eraser");
      return;
    }

    const clipboardAction = clipboardActionFromKeyboardEvent(event);
    if (clipboardAction) {
      event.preventDefault();
      if (clipboardAction === "copy") {
        handleCopySelection();
      } else {
        void handlePasteSelection();
      }
      return;
    }

    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      void handleDeleteKeyPress();
      return;
    }

    if (shortcutAction) {
      event.preventDefault();

      if (
        shortcutAction === "brush" ||
        shortcutAction === "eraser" ||
        shortcutAction === "select" ||
        shortcutAction === "eyedropper"
      ) {
        setActiveSketchTool(shortcutAction);
        return;
      }

      if (shortcutAction === "clearLayer") {
        const targetLayer = activeShotAndLayer(orderedShots, selectedShotIdsRef.current);
        if (targetLayer) {
          void handleClearBitmapLayer(targetLayer.activeShot.id, targetLayer.activeLayer.id);
        }
        return;
      }

      if (shortcutAction === "mergeDown") {
        const targetLayer = activeShotAndLayer(orderedShots, selectedShotIdsRef.current);
        if (targetLayer) {
          const selectedLayerIds =
            selectedBitmapLayerIdsRef.current?.shotId === targetLayer.activeShot.id
              ? selectedBitmapLayerIdsRef.current.layerIds
              : [];
          void handleMergeBitmapLayers(
            targetLayer.activeShot.id,
            targetLayer.activeLayer.id,
            selectedLayerIds
          );
        }
        return;
      }

      if (shortcutAction === "addShot") {
        void handleAddShot();
        return;
      }

      if (shortcutAction === "onionSkin") {
        if (isAnimationMode) {
          setIsOnionSkinEnabled((isEnabled) => !isEnabled);
        } else {
          setStatus("Onion Skin is available in animation mode");
        }
        return;
      }

      if (shortcutAction === "decreaseBrushSize" || shortcutAction === "increaseBrushSize") {
        const direction = shortcutAction === "decreaseBrushSize" ? "decrease" : "increase";
        if (activeSketchTool === "brush") {
          setBrushSize((size) =>
            adjustSketchShortcutValue(size, direction, 0.1, minBrushSize, maxBrushSize)
          );
        } else if (activeSketchTool === "eraser") {
          setEraserSize((size) =>
            adjustSketchShortcutValue(size, direction, 0.1, minEraserSize, maxEraserSize)
          );
        }
        return;
      }

      if (shortcutAction === "decreaseBrushOpacity" || shortcutAction === "increaseBrushOpacity") {
        const direction = shortcutAction === "decreaseBrushOpacity" ? "decrease" : "increase";
        if (activeSketchTool === "brush") {
          setBrushOpacity((opacity) =>
            adjustSketchShortcutValue(opacity, direction, 0.25, minSketchOpacity, maxSketchOpacity)
          );
        } else if (activeSketchTool === "eraser") {
          setEraserOpacity((opacity) =>
            adjustSketchShortcutValue(opacity, direction, 0.25, minSketchOpacity, maxSketchOpacity)
          );
        }
        return;
      }

      if (shortcutAction === "previousShot") {
        moveSelection("left");
        return;
      }

      if (shortcutAction === "nextShot") {
        moveSelection("right");
        return;
      }

      if (shortcutAction === "undo") {
        void applyUndoEntry();
        return;
      }

      if (shortcutAction === "redo") {
        void applyRedoEntry();
        return;
      }
    }

    if (!["arrowdown", "arrowup"].includes(key)) {
      return;
    }

    event.preventDefault();
    moveSelection(key.replace("arrow", "") as "up" | "down");
  };
};

export const createAppKeyboardKeyUpHandler = ({
  setIsSpacePanActive,
  setActiveSketchTool,
  pendingEraserHoldRef,
  spacePanActiveRef,
  temporarySketchToolOverrideRef,
  zZoomActiveRef
}: AppKeyboardShortcutsHandlerOptions): ((event: KeyboardEvent) => void) => {
  return (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.code === "Space" || event.key === " ") && spacePanActiveRef.current) {
      event.preventDefault();
      setSpacePanActive(spacePanActiveRef, setIsSpacePanActive, false);
      return;
    }

    if (key === "z" && zZoomActiveRef.current) {
      event.preventDefault();
      clearZZoomState(zZoomActiveRef);
      return;
    }

    const pendingEraserHold = pendingEraserHoldRef.current;
    if (pendingEraserHold?.key === "e" && key === "e") {
      event.preventDefault();
      globalThis.clearTimeout(pendingEraserHold.timerId);
      pendingEraserHoldRef.current = undefined;
      return;
    }

    const override = temporarySketchToolOverrideRef.current;
    const didReleaseTemporaryKey =
      override?.key === "alt" ? event.key === "Alt" : override?.key === "e" && key === "e";

    if (!didReleaseTemporaryKey) {
      return;
    }

    event.preventDefault();
    temporarySketchToolOverrideRef.current = undefined;
    setActiveSketchTool("brush");
  };
};

export const createAppKeyboardBlurHandler = ({
  setIsSpacePanActive,
  spacePanActiveRef,
  zZoomActiveRef
}: Pick<
  AppKeyboardShortcutsHandlerOptions,
  "setIsSpacePanActive" | "spacePanActiveRef" | "zZoomActiveRef"
>): (() => void) => {
  return () => {
    setSpacePanActive(spacePanActiveRef, setIsSpacePanActive, false);
    clearZZoomState(zZoomActiveRef);
  };
};

export const createAppKeyboardWheelHandler = ({
  isAddShotMenuOpen,
  isImportHelpOpen,
  isRecentMenuOpen,
  isSaveMenuOpen,
  hasOpenShortcutBlockingMenu,
  handleStoryboardZoomShortcut,
  zZoomActiveRef
}: AppKeyboardShortcutsHandlerOptions): ((event: WheelEvent) => void) => {
  return (event: WheelEvent) => {
    if (!zZoomActiveRef.current || event.deltaY === 0) {
      return;
    }

    const isMenuOpen =
      hasOpenWorkspaceMenu({
        isAddShotMenuOpen,
        isImportHelpOpen,
        isRecentMenuOpen,
        isSaveMenuOpen
      }) ||
      hasOpenShortcutBlockingMenu();
    if (isMenuOpen) {
      return;
    }

    event.preventDefault();
    handleStoryboardZoomShortcut(event.deltaY < 0 ? "in" : "out", {
      x: event.clientX,
      y: event.clientY
    });
  };
};

export const useAppKeyboardShortcutsController = (
  options: AppKeyboardShortcutsControllerOptions
): void => {
  const pendingEraserHoldRef = useRef<PendingEraserHold | undefined>(undefined);
  const spacePanActiveRef = useRef(false);
  const temporarySketchToolOverrideRef = useRef<TemporarySketchToolOverride | undefined>(undefined);
  const handlerOptions = {
    ...options,
    pendingEraserHoldRef,
    spacePanActiveRef,
    temporarySketchToolOverrideRef
  };
  const handleGlobalKeyDown = useCallback(
    createAppKeyboardKeyDownHandler(handlerOptions),
    [
      options.activeSketchTool,
      options.isAddShotMenuOpen,
      options.isAnimationMode,
      options.isImportHelpOpen,
      options.isRecentMenuOpen,
      options.isSaveMenuOpen,
      options.orderedShots,
      options.measureGridColumns,
      options.handleAddShot,
      options.handleClearBitmapLayer,
      options.handleCopySelection,
      options.handleDeleteKeyPress,
      options.handleMergeBitmapLayers,
      options.handlePasteSelection,
      options.handleSaveProject,
      options.handleStoryboardZoomShortcut,
      options.applyRedoEntry,
      options.applyUndoEntry,
      options.setActiveSketchTool,
      options.setBrushOpacity,
      options.setBrushSize,
      options.setEraserOpacity,
      options.setEraserSize,
      options.setIsSpacePanActive,
      options.setIsOnionSkinEnabled,
      options.setSelectedShotIds,
      options.setStatus,
      options.zZoomActiveRef
    ]
  );
  const handleGlobalKeyUp = useCallback(
    createAppKeyboardKeyUpHandler(handlerOptions),
    [options.setActiveSketchTool, options.setIsSpacePanActive, options.zZoomActiveRef]
  );
  const handleGlobalWheel = useCallback(
    createAppKeyboardWheelHandler(handlerOptions),
    [
      options.isAddShotMenuOpen,
      options.isImportHelpOpen,
      options.isRecentMenuOpen,
      options.isSaveMenuOpen,
      options.hasOpenShortcutBlockingMenu,
      options.handleStoryboardZoomShortcut,
      options.zZoomActiveRef
    ]
  );
  const handleGlobalBlur = useCallback(
    createAppKeyboardBlurHandler(handlerOptions),
    [options.setIsSpacePanActive, options.zZoomActiveRef]
  );

  useEffect(
    () => () => {
      if (pendingEraserHoldRef.current) {
        globalThis.clearTimeout(pendingEraserHoldRef.current.timerId);
        pendingEraserHoldRef.current = undefined;
      }
      setSpacePanActive(spacePanActiveRef, options.setIsSpacePanActive, false);
      clearZZoomState(options.zZoomActiveRef);
    },
    [options.setIsSpacePanActive, options.zZoomActiveRef]
  );

  useEffect(() => {
    window.addEventListener("wheel", handleGlobalWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleGlobalWheel);
  }, [handleGlobalWheel]);

  useEffect(() => {
    window.addEventListener("blur", handleGlobalBlur);
    return () => window.removeEventListener("blur", handleGlobalBlur);
  }, [handleGlobalBlur]);

  useGlobalKeyboardController(handleGlobalKeyDown, handleGlobalKeyUp);
};
