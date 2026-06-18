import { useCallback, type MutableRefObject } from "react";
import type { BitmapLayer, Shot, SketchTool } from "../shared/types";
import { activeVisibleBitmapLayerForShot, primaryShotOrFirst } from "./activeTargets";
import {
  adjustSketchShortcutValue,
  clipboardActionFromKeyboardEvent,
  shortcutActionFromKeyboardEvent,
  shouldIgnoreShortcutForTarget
} from "./keyboardShortcuts";
import {
  nextKeyboardShotSelection,
  useGlobalKeyboardController,
  type KeyboardSelectionDirection
} from "./globalKeyboardController";
import type { SelectedBitmapLayerIds } from "./storyboardInteractionState";
import { hasOpenWorkspaceMenu } from "./workspaceMenuController";

const minBrushSize = 1;
const maxBrushSize = 28;
const minEraserSize = 4;
const maxEraserSize = 64;
const minSketchOpacity = 0.2;
const maxSketchOpacity = 1;

type StateSetter<T> = (value: T | ((current: T) => T)) => void;
type MaybePromise = void | Promise<unknown>;

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
  applyRedoEntry: () => MaybePromise;
  applyUndoEntry: () => MaybePromise;
  setActiveSketchTool: (tool: SketchTool) => void;
  setBrushOpacity: StateSetter<number>;
  setBrushSize: StateSetter<number>;
  setEraserOpacity: StateSetter<number>;
  setEraserSize: StateSetter<number>;
  setIsOnionSkinEnabled: StateSetter<boolean>;
  setSelectedShotIds: StateSetter<string[]>;
  setStatus: (status: string) => void;
};

const activeShotAndLayer = (
  orderedShots: Shot[],
  selectedShotIds: string[]
): { activeShot: Shot; activeLayer: BitmapLayer } | undefined => {
  const activeShot = primaryShotOrFirst(orderedShots, selectedShotIds);
  const activeLayer = activeShot ? activeVisibleBitmapLayerForShot(activeShot) : undefined;
  return activeShot && activeLayer ? { activeShot, activeLayer } : undefined;
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
  applyRedoEntry,
  applyUndoEntry,
  setActiveSketchTool,
  setBrushOpacity,
  setBrushSize,
  setEraserOpacity,
  setEraserSize,
  setIsOnionSkinEnabled,
  setSelectedShotIds,
  setStatus
}: AppKeyboardShortcutsControllerOptions): ((event: KeyboardEvent) => void) => {
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

    const key = event.key.toLowerCase();
    const shortcutAction = shortcutActionFromKeyboardEvent(event);
    if (shouldIgnoreShortcutForTarget(target, shortcutAction, isAnimationMode)) {
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

      if (shortcutAction === "save") {
        void handleSaveProject();
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

export const useAppKeyboardShortcutsController = (
  options: AppKeyboardShortcutsControllerOptions
): void => {
  const handleGlobalKeyDown = useCallback(
    createAppKeyboardKeyDownHandler(options),
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
      options.applyRedoEntry,
      options.applyUndoEntry,
      options.setActiveSketchTool,
      options.setBrushOpacity,
      options.setBrushSize,
      options.setEraserOpacity,
      options.setEraserSize,
      options.setIsOnionSkinEnabled,
      options.setSelectedShotIds,
      options.setStatus
    ]
  );

  useGlobalKeyboardController(handleGlobalKeyDown);
};
