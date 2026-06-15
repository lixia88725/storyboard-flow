import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  addDialogue,
  addGeneratedShot,
  applyRenamePlan,
  createProject,
  createRenamePlan,
  defaultProjectNaming,
  defaultSaveNaming,
  bitmapLayersForShot,
  copyBitmapLayerToShot,
  deleteShots,
  duplicateShotAfter,
  ensureBitmapLayerMetadata,
  getNextStoryboardIndex,
  imageBitmapLayerId,
  markBitmapLayerPainted,
  mergeExternalImageChanges,
  mergeFolderImages,
  moveDialogueToShot,
  moveBitmapLayer,
  moveBitmapLayerGroup,
  projectAcceptedExternalEdits,
  projectHasSwbWarning,
  projectNeedsSwbImport,
  parkShotGroup,
  removeDialogue,
  restoreParkedShotGroup,
  reorderShotGroup,
  reorderShots,
  selectBitmapLayer,
  sortedShots,
  type ShotPlacement,
  updateDialogueText,
  updateBitmapLayer,
  updateBitmapLayerGroupOpacity,
  bitmapLayerPath,
} from "../shared/projectOps";
import { generatedShotTransparentLayerAssets } from "../shared/generatedShotAssets";
import type {
  BitmapLayer,
  Dialogue,
  FolderScanPayload,
  Project,
  ProjectNaming,
  Shot,
  BlankShotPreset,
  SketchStroke,
  SketchTool,
  StrokeTool
} from "../shared/types";
import {
  getAnimationViewport,
  getStableBoardTop,
  getZoomPreviewState,
  maxStoryboardZoom,
  nextWheelStoryboardZoom,
  normalizeStoryboardZoom,
  sameAnimationViewport,
  type ZoomPreviewState
} from "./animationViewport";
import {
  activeVisibleBitmapLayerForShot,
  canFillBitmapLayer,
  primaryShotFromSelection,
  primaryShotOrFirst
} from "./activeTargets";
import { autosaveErrorReducer, type AutosaveErrorNotice } from "./autosaveError";
import {
  readLayerAssetSnapshots,
  restoreLayerAssetSnapshots,
  type LayerAssetSnapshot
} from "./bitmapLayerHistory";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  copySelectionFromProject,
  layerPasteTargetFromProject,
  shotAssetCopyPlan,
  type ClipboardSelection
} from "./clipboardSelection";
import { DialoguePreview, ShotStackPreview } from "./DragPreviews";
import {
  resolveDeleteTarget,
  type DeleteTarget
} from "./deleteTarget";
import { nextRangeSelection, type RangeSelectionMode } from "./rangeSelection";
import {
  adjustSketchShortcutValue,
  defaultKeyboardShortcuts,
  clipboardActionFromKeyboardEvent,
  isKeyboardEditableTarget,
  shortcutActionFromKeyboardEvent,
  shouldIgnoreShortcutForTarget,
  type ShortcutAction
} from "./keyboardShortcuts";
import { BrushIcon, CardFaceIcon, ClearIcon, EraserIcon, GearIcon, SelectIcon, SidePanelIcon, SwatchIcon } from "./icons";
import { getOnionSkinNeighbors } from "./onionSkin";
import { SelectionMarquee } from "./SelectionMarquee";
import { ParkingShelf } from "./ParkingShelf";
import { AiDraftPanel } from "./ai/AiDraftPanel";
import { useExclusiveSidebars } from "./ai/useExclusiveSidebars";
import { useBoardViewState } from "./boardViewState";
import { RadialToolMenu } from "./RadialToolMenu";
import { ShotCard, type CardFace } from "./ShotCard";
import { Timeline } from "./Timeline";
import { formatSaveFailureStatus } from "./saveErrors";
import {
  createMarqueeBox,
  marqueeDisplayedSelectionIds,
  marqueeSelectionClassChanges,
  marqueeViewportRect,
  marqueeEdgeScrollDelta,
  sameMarqueeSelection,
  shotIdsInMarqueeBox,
  updateMarqueeBox,
  type MarqueeBox,
  type MarqueeShotRect
} from "./storyboardMarquee";
import {
  canvasSizeForShot,
  drawImageUrl,
  fillImageDataAtPoint,
  hexToRgba,
  drawStrokePathOnCanvas,
  shouldDrawStrokeToBitmapLayer
} from "./sketchRendering";
import {
  captureParkingDragRects,
  captureStoryboardDragRects,
  dragPreviewShotIds as chooseDragPreviewShotIds,
  inferShotPlacement,
  isPointerInsideRect,
  parkingInsertionIndicatorFromCachedRect,
  parkingInsertionTargetFromPointer,
  pointerFromActiveDragRect,
  sameParkingInsertionIndicator,
  sameStoryboardInsertionIndicator,
  shouldShowStoryboardInsertionIndicator,
  storyboardInsertionIndicatorFromCachedRect,
  storyboardInsertionTargetFromPointer,
  storyboardSortableItemIds as realStoryboardSortableItemIds,
  type ParkingDragRectCache,
  type ParkingInsertionIndicator,
  type StoryboardDragRectCache,
  type StoryboardInsertionIndicator,
  type StoryboardInsertionTarget,
  type DragData
} from "./storyboardDnd";
import { sameLayerSelection, useStoryboardInteractionState } from "./storyboardInteractionState";
import { useShortcutMenuController } from "./shortcutMenuController";
import { scrollDeltaToCenterInReservedViewport } from "./viewportGeometry";
import { shouldIgnoreWorkbenchWheelTarget } from "./workbenchWheel";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { useWorkspaceLifecycleState, type FileNameSyncState } from "./workspaceLifecycleState";
import { useUpdateNoticeController } from "./updateNoticeController";
import { usePopoverController } from "./popoverController";
import { statusPanelToggleClassName, swbStatusLabel, updateCheckButtonLabel } from "./statusPanelController";
import { hasOnlyCompatibleExternalEdits, hasUnsavedWorkspaceChanges, projectChangedDuringLoad, shouldAutosaveAfterLoad, shouldPersistLoadedProject, shouldRunAutosave } from "./workspacePersistenceController";
import {
  applyRadialPresetSlot,
  defaultToolRadialMenuConfig,
  normalizeToolRadialMenuConfig,
  radialCanvasContextMenuAction,
  type RadialDragKind,
  type RadialPresetSlot,
  type RadialToolSlot,
  type ToolRadialMenuConfig
} from "./toolRadialMenu";
import {
  closeRadialToolMenuState,
  nextRadialSlotConfig,
  openRadialToolMenuState,
  updateRadialDragSettings,
  type RadialToolMenuState
} from "./radialToolMenuController";

const defaultBrushColor = "#f05a28";
const defaultBrushSize = 4;
const defaultEraserSize = 18;
const minBrushSize = 1;
const maxBrushSize = 28;
const minEraserSize = 4;
const maxEraserSize = 64;
const minSketchOpacity = 0.2;
const maxSketchOpacity = 1;
const minSketchSoftness = 0;
const maxSketchSoftness = 1;
const maxUndoHistory = 60;
const blankShotPresets: Array<{ id: BlankShotPreset; label: string; detail: string }> = [
  { id: "16:9", label: "16:9", detail: "1920 x 1080" },
  { id: "2.39:1", label: "2.39:1", detail: "2581 x 1080" },
  { id: "1.43:1", label: "1.43:1 IMAX", detail: "1544 x 1080" }
];
const autosaveDelayMs = 600;
const animationReservedBottom = 180;
const animationViewportMargin = 14;
const radialToolMenuCloseAnimationMs = 140;

const ensureProjectBitmapMetadata = (project: Project): Project => ({
  ...project,
  shots: project.shots.map((shot) => ensureBitmapLayerMetadata(shot)),
  parkedShots: project.parkedShots?.map((shot) => ensureBitmapLayerMetadata(shot))
});

type UndoEntry = {
  project: Project;
  selectedShotIds: string[];
  fileNameSyncState: FileNameSyncState;
  layerAssets?: LayerAssetSnapshot[];
};
type ProjectUpdate = Project | ((currentProject: Project) => Project);
type StoryboardScriptImportDraft = {
  sourceMarkdownPath: string;
  fileName: string;
  entryCount: number;
  targetFolderPath: string;
};
type PasteAnimationKind = "shot" | "layer";
type PasteAnimationState = {
  kind: PasteAnimationKind;
  sourceId: string;
  pastedId: string;
  beforeRects: Map<string, DOMRect>;
};

const hasOpenShortcutBlockingMenu = (): boolean =>
  Boolean(
    document.querySelector(
      ".shortcut-menu, .save-menu, .recent-menu, .add-shot-menu, .radial-tool-menu"
    )
  );

const appendHistoryEntry = (entries: UndoEntry[], entry: UndoEntry) => [
  ...entries.slice(Math.max(0, entries.length - maxUndoHistory + 1)),
  entry
];

const blurActiveFormControl = () => {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement.matches("input, textarea, select")) {
    activeElement.blur();
  }
};

const markdownPathFromDrop = (event: ReactDragEvent): string | undefined => {
  const files = Array.from(event.dataTransfer.files);
  if (files.length !== 1) {
    return undefined;
  }

  const file = files[0] as File & { path?: string };
  if (!file.name.toLowerCase().endsWith(".md")) {
    return undefined;
  }

  return window.storyboard?.filePathForDroppedFile(file) || file.path;
};

export const App = () => {
  const {
    project,
    setProject,
    projectRef,
    folderPath,
    setFolderPath,
    folderPathRef,
    folderInputValue,
    setFolderInputValue,
    metadataPath,
    setMetadataPath,
    metadataPathRef,
    workspaceSaveState,
    setWorkspaceSaveState,
    workspaceSaveStateRef,
    workspaceTask,
    setWorkspaceTask,
    fileNameSyncState,
    setFileNameSyncState,
    fileNameSyncStateRef,
    recentFolders,
    setRecentFolders,
    autosaveRevision,
    setAutosaveRevision
  } = useWorkspaceLifecycleState();
  const [activeDialogue, setActiveDialogue] = useState<Dialogue | undefined>();
  const {
    activeDragType,
    setActiveDragType,
    activeShotIds,
    setActiveShotIds,
    dragPreviewShotIds,
    setDragPreviewShotIds,
    storyboardInsertionIndicator,
    setStoryboardInsertionIndicator,
    parkingInsertionIndicator,
    setParkingInsertionIndicator,
    activeParkedShotIds,
    setActiveParkedShotIds,
    selectedShotIds,
    setSelectedShotIds,
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
    deleteTarget,
    setDeleteTarget,
    deleteTargetRef,
    selectedBitmapLayerIds,
    setSelectedBitmapLayerIds,
    selectedBitmapLayerIdsRef
  } = useStoryboardInteractionState();
  const [activeSketchTool, setActiveSketchTool] = useState<SketchTool>("brush");
  const [brushColor, setBrushColor] = useState(defaultBrushColor);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSize, setBrushSize] = useState(defaultBrushSize);
  const [brushSoftness, setBrushSoftness] = useState(0);
  const [eraserSize, setEraserSize] = useState(defaultEraserSize);
  const [eraserOpacity, setEraserOpacity] = useState(1);
  const [eraserSoftness, setEraserSoftness] = useState(0);
  const [toolRadialMenuConfig, setToolRadialMenuConfig] =
    useState<ToolRadialMenuConfig>(() => defaultToolRadialMenuConfig());
  const {
    zoomLevel,
    setZoomLevel,
    zoomLevelRef,
    isZoomScrubbing,
    setIsZoomScrubbing,
    isZoomScrubbingRef,
    isAnimationMode,
    setIsAnimationMode,
    isAnimationModeRef,
    animationImageSize,
    setAnimationImageSize,
    animationFrameSize,
    setAnimationFrameSize
  } = useBoardViewState();
  const [isOnionSkinEnabled, setIsOnionSkinEnabled] = useState(false);
  const [editingDialogueId, setEditingDialogueId] = useState<string | undefined>();
  const {
    isOpen: isSaveMenuOpen,
    setIsOpen: setIsSaveMenuOpen,
    ref: saveMenuRef
  } = usePopoverController<HTMLDivElement>();
  const {
    isOpen: isRecentMenuOpen,
    setIsOpen: setIsRecentMenuOpen,
    ref: recentMenuRef
  } = usePopoverController<HTMLDivElement>();
  const {
    isOpen: isAddShotMenuOpen,
    setIsOpen: setIsAddShotMenuOpen,
    ref: addShotMenuRef
  } = usePopoverController<HTMLDivElement>();
  const [blankShotPreset, setBlankShotPreset] = useState<BlankShotPreset>("16:9");
  const [radialToolMenu, setRadialToolMenu] = useState<RadialToolMenuState | undefined>();
  const [isStatusPanelOpen, setIsStatusPanelOpen] = useState(false);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const {
    isOpen: isImportHelpOpen,
    setIsOpen: setIsImportHelpOpen,
    ref: importHelpRef
  } = usePopoverController<HTMLDivElement>();
  const [isImportNudging, setIsImportNudging] = useState(false);
  const [cardFace, setCardFace] = useState<CardFace>("image");
  const [scriptImportNeeded, setScriptImportNeeded] = useState(false);
  const [autosaveError, setAutosaveError] = useState<AutosaveErrorNotice | undefined>();
  const [saveErrorDialog, setSaveErrorDialog] = useState<string | undefined>();
  const [storyboardScriptImportDraft, setStoryboardScriptImportDraft] =
    useState<StoryboardScriptImportDraft | undefined>();
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const {
    isAiPanelOpen,
    isParkingShelfOpen,
    openPendingShelf,
    toggleAiPanel,
    togglePendingShelf
  } = useExclusiveSidebars();
  const [clipboardSelection, setClipboardSelection] = useState<ClipboardSelection | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const {
    updateNotice,
    setUpdateNotice,
    checkForUpdates,
    openUpdateDownload
  } = useUpdateNoticeController({ setStatus });
  const {
    isShortcutMenuOpen,
    setIsShortcutMenuOpen,
    shortcutMenuRef,
    shortcutMenuItems
  } = useShortcutMenuController();
  const selectionMarqueeRef = useRef<HTMLDivElement | null>(null);
  const scriptImportCheckIdRef = useRef(0);
  const dirtyShotIdsRef = useRef<Set<string>>(new Set());
  const clipboardSelectionRef = useRef<ClipboardSelection | undefined>(undefined);
  const pasteAnimationRef = useRef<PasteAnimationState | undefined>(undefined);
  const pasteAnimationFrameRef = useRef<number | undefined>(undefined);
  const pasteAnimationCleanupTimeoutRef = useRef<number | undefined>(undefined);
  const pendingZoomLevelRef = useRef<number | undefined>(undefined);
  const zoomFrameRef = useRef<number | undefined>(undefined);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const zoomValueLabelRef = useRef<HTMLSpanElement | null>(null);
  const selectedShotCountLabelRef = useRef<HTMLSpanElement | null>(null);
  const radialToolMenuCloseTimeoutRef = useRef<number | undefined>(undefined);
  const pendingZoomPreviewLevelRef = useRef<number | undefined>(undefined);
  const zoomPreviewFrameRef = useRef<number | undefined>(undefined);
  const zoomPreviewStateRef = useRef<ZoomPreviewState | undefined>(undefined);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const storyboardInsertionTargetRef = useRef<StoryboardInsertionTarget | undefined>(undefined);
  const storyboardInsertionIndicatorRef = useRef<StoryboardInsertionIndicator | undefined>(undefined);
  const storyboardDragRectCacheRef = useRef<StoryboardDragRectCache | undefined>(undefined);
  const storyboardDragRectCacheScrollRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const storyboardInsertionFrameRef = useRef<number | undefined>(undefined);
  const pendingStoryboardInsertionDragRef = useRef<
    | {
        pointer: { x: number; y: number };
        movingShotIds: string[];
      }
    | undefined
  >(undefined);
  const parkingListRef = useRef<HTMLDivElement | null>(null);
  const parkingInsertionTargetRef = useRef<StoryboardInsertionTarget | undefined>(undefined);
  const parkingInsertionIndicatorRef = useRef<ParkingInsertionIndicator | undefined>(undefined);
  const parkingDragRectCacheRef = useRef<ParkingDragRectCache | undefined>(undefined);
  const parkingDragRectCacheScrollRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const parkingInsertionFrameRef = useRef<number | undefined>(undefined);
  const pendingParkingInsertionDragRef = useRef<
    | {
        pointer: { x: number; y: number };
        movingShotIds: string[];
      }
    | undefined
  >(undefined);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const bitmapLayerWriteQueueRef = useRef(createBitmapLayerWriteQueue());
  const appShellRef = useRef<HTMLElement | null>(null);
  const workspaceBoardScrollRef = useRef<HTMLDivElement | null>(null);
  const boardGridRef = useRef<HTMLElement | null>(null);
  const orderedShots = useMemo(() => sortedShots(project.shots), [project.shots]);
  const parkedShots = useMemo(() => sortedShots(project.parkedShots ?? []), [project.parkedShots]);
  const needsImageImport = useMemo(() => projectNeedsSwbImport(project), [project]);
  const needsSwbImport = needsImageImport || scriptImportNeeded;
  const hasSwbWarning = useMemo(() => projectHasSwbWarning(project), [project]) || scriptImportNeeded;
  const isWorkspaceTaskRunning = Boolean(workspaceTask);
  const isImportLocked = needsImageImport && !isWorkspaceTaskRunning;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const primarySelectedShotId = selectedShotIds[0];
  const primarySelectedShot = useMemo(
    () => primaryShotFromSelection(orderedShots, selectedShotIds),
    [orderedShots, selectedShotIds]
  );
  const shotById = useMemo(
    () => new Map(orderedShots.map((shot) => [shot.id, shot])),
    [orderedShots]
  );
  const renderedShotEntries = useMemo(() => {
    if (!isAnimationMode) {
      return orderedShots.map((shot, index) => ({ shot, index }));
    }

    const activeShot = primarySelectedShot ?? orderedShots[0];
    if (!activeShot) {
      return [];
    }

    return [{ shot: activeShot, index: orderedShots.findIndex((shot) => shot.id === activeShot.id) }];
  }, [isAnimationMode, orderedShots, primarySelectedShot]);
  const storyboardSortableItemIds = useMemo(
    () => realStoryboardSortableItemIds(renderedShotEntries.map(({ shot }) => shot.id)),
    [renderedShotEntries]
  );
  const onionSkinNeighbors = useMemo(
    () => getOnionSkinNeighbors(orderedShots, primarySelectedShotId, isAnimationMode && isOnionSkinEnabled),
    [isAnimationMode, isOnionSkinEnabled, orderedShots, primarySelectedShotId]
  );

  useLayoutEffect(() => {
    const animation = pasteAnimationRef.current;
    if (!animation) {
      return;
    }

    pasteAnimationRef.current = undefined;
    applyPasteAnimation(animation, pasteAnimationFrameRef, pasteAnimationCleanupTimeoutRef);
  }, [project]);

  useEffect(
    () => () => clearPasteAnimation(pasteAnimationFrameRef, pasteAnimationCleanupTimeoutRef),
    []
  );

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

  const currentBoardScroll = () => {
    const scrollContainer = workspaceBoardScrollRef.current;
    return scrollContainer
      ? { x: scrollContainer.scrollLeft, y: scrollContainer.scrollTop }
      : { x: window.scrollX, y: window.scrollY };
  };

  const currentBoardViewportHeight = () =>
    workspaceBoardScrollRef.current?.clientHeight ?? window.innerHeight;

  const scrollBoardBy = (options: ScrollToOptions) => {
    const scrollContainer = workspaceBoardScrollRef.current;
    if (scrollContainer) {
      scrollContainer.scrollBy(options);
      return;
    }

    window.scrollBy(options);
  };

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
    [orderedShots, primarySelectedShot]
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
    [applyZoomPreviewCssVariables, syncZoomControlDisplay]
  );

  useEffect(() => {
    if (!isZoomScrubbingRef.current) {
      zoomPreviewStateRef.current = undefined;
      syncZoomControlDisplay(zoomLevel);
    }
  }, [syncZoomControlDisplay, zoomLevel]);

  const commitZoomLevel = useCallback((zoom: number) => {
    const nextZoom = normalizeStoryboardZoom(zoom);
    zoomLevelRef.current = nextZoom;
    setZoomLevel((currentZoom) => (currentZoom === nextZoom ? currentZoom : nextZoom));
  }, []);

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
  }, [applyZoomPreviewState, buildZoomPreviewState, commitZoomLevel, syncZoomControlDisplay]);

  const beginZoomScrubbing = useCallback(() => {
    flushScheduledZoomLevel();
    isZoomScrubbingRef.current = true;
    const preview = buildZoomPreviewState(zoomLevelRef.current);
    if (preview) {
      applyZoomPreviewState(preview);
    }
    setIsZoomScrubbing(true);
  }, [applyZoomPreviewState, buildZoomPreviewState, flushScheduledZoomLevel]);

  const endZoomScrubbing = useCallback(() => {
    if (!isZoomScrubbingRef.current) {
      return;
    }

    flushZoomPreviewLevel();
    isZoomScrubbingRef.current = false;
    setIsZoomScrubbing(false);
  }, [flushZoomPreviewLevel]);

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

  useEffect(() => {
    if (!isZoomScrubbing) {
      return;
    }

    window.addEventListener("pointerup", endZoomScrubbing, { once: true });
    window.addEventListener("pointercancel", endZoomScrubbing, { once: true });
    return () => {
      window.removeEventListener("pointerup", endZoomScrubbing);
      window.removeEventListener("pointercancel", endZoomScrubbing);
    };
  }, [endZoomScrubbing, isZoomScrubbing]);

  useEffect(() => {
    const element = appShellRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: globalThis.WheelEvent) => {
      if (shouldIgnoreWorkbenchWheelTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      scheduleZoomLevel(
        nextWheelStoryboardZoom(pendingZoomLevelRef.current ?? zoomLevelRef.current, event.deltaY)
      );
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [scheduleZoomLevel]);

  useEffect(() => {
    clipboardSelectionRef.current = clipboardSelection;
  }, [clipboardSelection]);

  const selectSingleShot = (shotId: string | undefined) => {
    shotSelectionAnchorIdRef.current = shotId;
    const nextShotIds = shotId ? [shotId] : [];
    selectedShotIdsRef.current = nextShotIds;
    setSelectedShotIds(nextShotIds);
  };

  const clearSelectedShots = () => {
    shotSelectionAnchorIdRef.current = undefined;
    selectedShotIdsRef.current = [];
    setSelectedShotIds([]);
  };

  const selectShotsByIds = (shotIds: string[]) => {
    shotSelectionAnchorIdRef.current = shotIds.at(-1);
    selectedShotIdsRef.current = shotIds;
    setSelectedShotIds(shotIds);
  };

  const selectShotWithMode = (shotId: string, mode: RangeSelectionMode) => {
    const selection = nextRangeSelection({
      orderedIds: orderedShots.map((shot) => shot.id),
      selectedIds: selectedShotIdsRef.current,
      clickedId: shotId,
      anchorId: shotSelectionAnchorIdRef.current,
      mode
    });
    shotSelectionAnchorIdRef.current = selection.anchorId;
    selectedShotIdsRef.current = selection.selectedIds;
    setSelectedShotIds(selection.selectedIds);
  };

  const handleSelectedBitmapLayerIdsChange = useCallback((shotId: string, layerIds: string[]) => {
    setSelectedBitmapLayerIds((current) =>
      sameLayerSelection(current, shotId, layerIds) ? current : { shotId, layerIds }
    );
  }, []);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  useEffect(() => {
    redoStackRef.current = redoStack;
  }, [redoStack]);

  const setUndoStackSynced = (update: UndoEntry[] | ((current: UndoEntry[]) => UndoEntry[])) => {
    const next = typeof update === "function" ? update(undoStackRef.current) : update;
    undoStackRef.current = next;
    setUndoStack(next);
  };

  const setRedoStackSynced = (update: UndoEntry[] | ((current: UndoEntry[]) => UndoEntry[])) => {
    const next = typeof update === "function" ? update(redoStackRef.current) : update;
    redoStackRef.current = next;
    setRedoStack(next);
  };

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
      lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerMove);
    window.addEventListener("mouseup", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerMove);
    };
  }, []);

  useEffect(() => {
    if (!window.storyboard?.getToolRadialMenu) {
      return;
    }

    void window.storyboard
      .getToolRadialMenu()
      .then((config) => setToolRadialMenuConfig(normalizeToolRadialMenuConfig(config)))
      .catch(() => setToolRadialMenuConfig(defaultToolRadialMenuConfig()));
  }, []);

  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    const removeOpenListener = window.storyboard.onOpenRecentFolder((nextFolderPath) => {
      setFolderInputValue(nextFolderPath);
      void handleOpenFolderByPath(nextFolderPath);
    });
    const removeChangedListener = window.storyboard.onRecentFoldersChanged((folders, reason) => {
      setRecentFolders(folders);
      if (reason === "recent-folders-corrupt") {
        setStatus("Recent folders were reset because recent-folders.json was corrupted");
      }
    });
    void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);
    const removeTaskProgressListener = window.storyboard.onWorkspaceTaskProgress((progress) => {
      setWorkspaceTask((task) =>
        task && task.kind === progress.kind
          ? {
              ...task,
              label: progress.label ?? (progress.kind === "save" ? "Writing changed TIFFs..." : task.label),
              current: progress.current,
              total: progress.total
            }
          : task
      );
    });

    return () => {
      removeOpenListener();
      removeChangedListener();
      removeTaskProgressListener();
    };
  }, []);

  useEffect(() => {
    const activeFolderPath = folderPathRef.current;
    const activeMetadataPath = metadataPathRef.current;
    if (!shouldRunAutosave(autosaveRevision, activeFolderPath, activeMetadataPath, Boolean(window.storyboard))) {
      return;
    }

    const projectToSave = projectRef.current;
    setWorkspaceSaveState("saving");
    const timer = window.setTimeout(() => {
      void persistWorkspace(projectToSave, activeFolderPath, activeMetadataPath).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setWorkspaceSaveState("error");
        setAutosaveError((current) => autosaveErrorReducer(current, { type: "failed", message }));
        setStatus(`Autosave failed: ${message}`);
      });
    }, autosaveDelayMs);

    return () => window.clearTimeout(timer);
  }, [autosaveRevision]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshExternalImportState();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [metadataPath]);

  useEffect(() => {
    if (!window.storyboard || !folderPath) {
      return;
    }

    let stopWatching: (() => void) | undefined;
    let debounceId: number | undefined;
    let cancelled = false;

    void window.storyboard
      .watchWorkspaceFolder(folderPath, () => {
        if (debounceId !== undefined) {
          window.clearTimeout(debounceId);
        }
        debounceId = window.setTimeout(() => {
          void refreshExternalImportState();
        }, 500);
      })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        stopWatching = stop;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (debounceId !== undefined) {
        window.clearTimeout(debounceId);
      }
      stopWatching?.();
    };
  }, [folderPath]);

  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    void window.storyboard.updateCloseGuard({
      hasUnsavedChanges: hasUnsavedWorkspaceChanges(dirtyShotIdsRef.current.size, workspaceSaveState, fileNameSyncState)
    });
  }, [fileNameSyncState, project, workspaceSaveState]);

  const measureGridColumns = useCallback(() => {
    const firstRowTop = Array.from(document.querySelectorAll<HTMLElement>("[data-shot-id]"))
      .map((element) => Math.round(element.getBoundingClientRect().top))
      .sort((a, b) => a - b)[0];

    if (firstRowTop === undefined) {
      return 1;
    }

    return Math.max(
      1,
      Array.from(document.querySelectorAll<HTMLElement>("[data-shot-id]")).filter(
        (element) => Math.abs(Math.round(element.getBoundingClientRect().top) - firstRowTop) <= 4
      ).length
    );
  }, []);

  const measureAnimationMode = useCallback(() => {
    if (isZoomScrubbing) {
      return;
    }

    const board = boardGridRef.current;
    const firstShot = board?.querySelector<HTMLElement>("[data-shot-id]");

    if (!board || !firstShot) {
      setIsAnimationMode(false);
      return;
    }

    const boardRect = board.getBoundingClientRect();
    const boardScroll = currentBoardScroll();
    const viewportShot = primarySelectedShot ?? orderedShots[0];
    const viewport = getAnimationViewport({
      boardWidth: boardRect.width,
      boardTop: getStableBoardTop(boardRect.top, boardScroll.y),
      viewportHeight: currentBoardViewportHeight(),
      reservedBottom: animationReservedBottom,
      margin: animationViewportMargin,
      zoomLevel,
      maxZoomLevel: maxStoryboardZoom,
      isAnimationMode,
      imageAspectRatio: viewportShot ? aspectRatioForShot(viewportShot) : 420 / 265
    });
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
  }, [animationFrameSize, animationImageSize, isAnimationMode, isZoomScrubbing, orderedShots, primarySelectedShot, zoomLevel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureAnimationMode);
    window.addEventListener("resize", measureAnimationMode);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureAnimationMode);
    };
  }, [measureAnimationMode, orderedShots.length, zoomLevel]);

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
    const delta = scrollDeltaToCenterInReservedViewport(
      element.getBoundingClientRect(),
      {
        height: currentBoardViewportHeight(),
        reservedBottom,
        margin: animationViewportMargin
      }
    );

    if (delta !== 0) {
      scrollBoardBy({ top: delta, behavior: "instant" });
    }
  }, [animationImageSize.height, animationImageSize.width, isAnimationMode, isZoomScrubbing, selectedShotIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isMenuOpen =
        isShortcutMenuOpen ||
        isSaveMenuOpen ||
        isRecentMenuOpen ||
        isAddShotMenuOpen ||
        isImportHelpOpen ||
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

      const moveSelection = (direction: "left" | "right" | "up" | "down") => {
        setSelectedShotIds((current) => {
          if (orderedShots.length === 0) {
            shotSelectionAnchorIdRef.current = undefined;
            selectedShotIdsRef.current = [];
            return [];
          }

          const currentIndex = current[0]
            ? orderedShots.findIndex((shot) => shot.id === current[0])
            : -1;
          const nextIndex = getNextStoryboardIndex(
            currentIndex,
            orderedShots.length,
            measureGridColumns(),
            direction,
            isAnimationMode
          );
          const nextShotId = orderedShots[nextIndex].id;
          shotSelectionAnchorIdRef.current = nextShotId;
          selectedShotIdsRef.current = [nextShotId];
          return [nextShotId];
        });
      };

      if (shortcutAction) {
        event.preventDefault();

        if (shortcutAction === "brush") {
          setActiveSketchTool("brush");
          return;
        }

        if (shortcutAction === "eraser") {
          setActiveSketchTool("eraser");
          return;
        }

        if (shortcutAction === "select") {
          setActiveSketchTool("select");
          return;
        }

        if (shortcutAction === "clearLayer") {
          const activeShot = primaryShotOrFirst(orderedShots, selectedShotIdsRef.current);
          const activeLayer = activeShot ? activeVisibleBitmapLayerForShot(activeShot) : undefined;

          if (activeShot && activeLayer) {
            void handleClearBitmapLayer(activeShot.id, activeLayer.id);
          }
          return;
        }

        if (shortcutAction === "mergeDown") {
          const activeShot = primaryShotOrFirst(orderedShots, selectedShotIdsRef.current);
          const activeLayer = activeShot ? activeVisibleBitmapLayerForShot(activeShot) : undefined;

          if (activeShot && activeLayer) {
            const selectedLayerIds =
              selectedBitmapLayerIdsRef.current?.shotId === activeShot.id
                ? selectedBitmapLayerIdsRef.current.layerIds
                : [];
            void handleMergeBitmapLayers(activeShot.id, activeLayer.id, selectedLayerIds);
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isAddShotMenuOpen,
    isAnimationMode,
    isImportHelpOpen,
    isRecentMenuOpen,
    isSaveMenuOpen,
    isShortcutMenuOpen,
    measureGridColumns,
    orderedShots,
    activeSketchTool,
    primarySelectedShot
  ]);

  const updateProject = (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced = true,
    recordUndo = true
  ) => {
    const nextProject =
      typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;

    if (recordUndo) {
      setUndoStackSynced((current) =>
        appendHistoryEntry(current, {
          project: projectRef.current,
          selectedShotIds: selectedShotIdsRef.current,
          fileNameSyncState: fileNameSyncStateRef.current
        })
      );
    }
    setRedoStackSynced([]);
    const acceptedExternalEdits = projectAcceptedExternalEdits(nextProject);

    projectRef.current = nextProject;
    setProject(nextProject);
    setWorkspaceSaveState("saving");
    if (markFileNamesUnsynced) {
      setFileNameSyncState("unsynced");
    }
    setAutosaveRevision((revision) => revision + 1);
    scriptImportCheckIdRef.current += 1;
    setScriptImportNeeded(false);
  };

  const markShotsDirty = (shotIds: string[]) => {
    for (const shotId of shotIds) {
      dirtyShotIdsRef.current.add(shotId);
    }
  };

  const markAllShotsDirty = () => {
    markShotsDirty(projectRef.current.shots.map((shot) => shot.id));
  };

  const handleDeleteSelectedShots = () => {
    const selectedIds = selectedShotIdsRef.current;

    if (selectedIds.length === 0) {
      return;
    }

    const currentProject = projectRef.current;
    const selected = new Set(selectedIds);
    const ordered = sortedShots(currentProject.shots);
    const firstDeletedIndex = ordered.findIndex((shot) => selected.has(shot.id));
    const remaining = ordered.filter((shot) => !selected.has(shot.id));

    if (firstDeletedIndex === -1 || remaining.length === ordered.length) {
      return;
    }

    const nextSelectedShot = remaining[Math.min(firstDeletedIndex, remaining.length - 1)];
    updateProject((projectToUpdate) => deleteShots(projectToUpdate, selectedIds));
    selectSingleShot(nextSelectedShot?.id);
    setDeleteTarget({ type: "shot" });
    setStatus(
      selectedIds.length === 1
        ? "Storyboard deleted; Save will move its file to Trash"
        : `${selectedIds.length} storyboards deleted; Save will move their files to Trash`
    );
  };

  const handleDeleteKeyPress = async () => {
    const resolvedTarget = resolveDeleteTarget(projectRef.current, deleteTarget);

    if (resolvedTarget.type === "layer") {
      await handleRemoveBitmapLayer(resolvedTarget.shotId, resolvedTarget.layerId);
      const nextShot = projectRef.current.shots.find((shot) => shot.id === resolvedTarget.shotId);
      const nextLayer = nextShot ? activeVisibleBitmapLayerForShot(nextShot) : undefined;
      setDeleteTarget(
        nextShot && nextLayer
          ? { type: "layer", shotId: nextShot.id, layerId: nextLayer.id }
          : { type: "shot" }
      );
      return;
    }

    if (resolvedTarget.type === "locked-layer") {
      setStatus("Cannot delete a locked layer");
      return;
    }

    handleDeleteSelectedShots();
  };

  const createHistoryEntry = async (bitmapPaths: string[] = []): Promise<UndoEntry> => {
    const activeFolderPath = folderPathRef.current;
    const layerAssets =
      window.storyboard && activeFolderPath && bitmapPaths.length > 0
        ? await readLayerAssetSnapshots(window.storyboard, activeFolderPath, bitmapPaths)
        : [];

    return {
      project: projectRef.current,
      selectedShotIds: selectedShotIdsRef.current,
      fileNameSyncState: fileNameSyncStateRef.current,
      layerAssets
    };
  };

  const recordUndoEntry = (entry: UndoEntry) => {
    setUndoStackSynced((current) => appendHistoryEntry(current, entry));
    setRedoStackSynced([]);
  };

  const {
    handleAddBitmapLayer,
    handleClearBitmapLayer,
    handleMergeBitmapLayers,
    handleMergeVisibleBitmapLayers,
    handleRemoveBitmapLayer
  } = useBitmapLayerActions({
    projectRef,
    folderPath,
    bitmapLayerWriteQueueRef,
    createTransparentLayerDataUrl,
    createHistoryEntry,
    recordUndoEntry,
    markShotsDirty,
    updateProject,
    setStatus
  });

  async function restoreHistoryLayerAssets(entry: UndoEntry) {
    const activeFolderPath = folderPathRef.current;
    if (!window.storyboard || !activeFolderPath || !entry.layerAssets?.length) {
      return;
    }

    await restoreLayerAssetSnapshots(window.storyboard, activeFolderPath, entry.layerAssets);
  }

  async function applyUndoEntry() {
    const previous = undoStackRef.current.at(-1);
    if (!previous) {
      setStatus("Nothing to undo");
      return;
    }

    try {
      const affectedPaths = previous.layerAssets?.map((snapshot) => snapshot.bitmapPath) ?? [];
      await bitmapLayerWriteQueueRef.current.drain();
      const redoEntry = await createHistoryEntry(affectedPaths);
      await restoreHistoryLayerAssets(previous);

      setRedoStackSynced((current) => appendHistoryEntry(current, redoEntry));
      setUndoStackSynced((current) => current.slice(0, -1));
      setProject(previous.project);
      projectRef.current = previous.project;
      selectShotsByIds(previous.selectedShotIds);
      setFileNameSyncState(previous.fileNameSyncState);
      setWorkspaceSaveState("saving");
      markAllShotsDirty();
      setAutosaveRevision((revision) => revision + 1);
      scriptImportCheckIdRef.current += 1;
      setScriptImportNeeded(false);
      setStatus("Undid last change");
    } catch (error) {
      setStatus(`Undo failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function applyRedoEntry() {
    const next = redoStackRef.current.at(-1);
    if (!next) {
      setStatus("Nothing to redo");
      return;
    }

    try {
      const affectedPaths = next.layerAssets?.map((snapshot) => snapshot.bitmapPath) ?? [];
      await bitmapLayerWriteQueueRef.current.drain();
      const undoEntry = await createHistoryEntry(affectedPaths);
      await restoreHistoryLayerAssets(next);

      setUndoStackSynced((current) => appendHistoryEntry(current, undoEntry));
      setRedoStackSynced((current) => current.slice(0, -1));
      setProject(next.project);
      projectRef.current = next.project;
      selectShotsByIds(next.selectedShotIds);
      setFileNameSyncState(next.fileNameSyncState);
      setWorkspaceSaveState("saving");
      markAllShotsDirty();
      setAutosaveRevision((revision) => revision + 1);
      scriptImportCheckIdRef.current += 1;
      setScriptImportNeeded(false);
      setStatus("Redid last change");
    } catch (error) {
      setStatus(`Redo failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const updateProjectName = (name: string) => {
    updateProject({
      ...project,
      name,
      updatedAt: new Date().toISOString()
    });
  };

  const updateProjectNaming = (field: keyof ProjectNaming, value: string) => {
    updateProject({
      ...project,
      naming: {
        ...defaultProjectNaming,
        ...project.naming,
        [field]: value
      },
      updatedAt: new Date().toISOString()
    });
  };

  const handleShotScriptText = (shotId: string, scriptText: string) => {
    updateProject((currentProject) => ({
      ...currentProject,
      shots: currentProject.shots.map((shot) =>
        shot.id === shotId ? { ...shot, scriptText } : shot
      ),
      updatedAt: new Date().toISOString()
    }));
  };

  const persistWorkspace = async (
    projectToSave: Project,
    activeFolderPath = folderPath,
    activeMetadataPath = metadataPath
  ) => {
    if (!window.storyboard || !activeFolderPath || !activeMetadataPath) {
      return;
    }

    await window.storyboard.autosaveWorkspace({
      project: { ...projectToSave, updatedAt: new Date().toISOString() },
      folderPath: activeFolderPath,
      metadataPath: activeMetadataPath
    });
    scriptImportCheckIdRef.current += 1;
    setScriptImportNeeded(false);
    setWorkspaceSaveState("saved");
    setAutosaveError((current) => autosaveErrorReducer(current, { type: "saved" }));
  };

  const checkStoryboardScriptImportState = async (
    projectToCheck: Project,
    nextFolderPath: string,
    nextMetadataPath: string
  ): Promise<boolean | undefined> => {
    const result = await withStatus(
      "Storyboard script check failed",
      () =>
        window.storyboard.checkStoryboardScript({
          project: projectToCheck,
          folderPath: nextFolderPath,
          metadataPath: nextMetadataPath
        }),
      setStatus
    );

    return result?.scriptImportNeeded;
  };

  const refreshExternalImportState = async () => {
    if (!window.storyboard || !folderPathRef.current || !metadataPathRef.current) {
      return;
    }
    if (workspaceSaveStateRef.current === "saving") {
      return;
    }

    const checkId = (scriptImportCheckIdRef.current += 1);
    const projectToCheck = projectRef.current;
    const nextFolderPath = folderPathRef.current;
    const nextMetadataPath = metadataPathRef.current;
    const result = await withStatus(
      "Workspace change check failed",
      () =>
        window.storyboard.checkExternalChanges({
          project: projectToCheck,
          folderPath: nextFolderPath,
          metadataPath: nextMetadataPath
        }),
      setStatus
    );

    if (
      result &&
      checkId === scriptImportCheckIdRef.current &&
      projectRef.current === projectToCheck &&
      folderPathRef.current === nextFolderPath &&
      metadataPathRef.current === nextMetadataPath
    ) {
      const nextProject = mergeExternalImageChanges(projectToCheck, result.images);
      if (
        nextProject !== projectToCheck &&
        hasOnlyCompatibleExternalEdits(nextProject)
      ) {
        const imported = await withStatus(
          "Import external Photoshop edits failed",
          () =>
            window.storyboard.importSwbFormat({
              project: nextProject,
              folderPath: nextFolderPath,
              metadataPath: nextMetadataPath,
              blankShotPreset,
              dirtyShotIds: [...dirtyShotIdsRef.current],
              preserveDirtyShotLayers: true
            }),
          setStatus
        );
        if (
          imported &&
          checkId === scriptImportCheckIdRef.current &&
          folderPathRef.current === nextFolderPath &&
          metadataPathRef.current === nextMetadataPath
        ) {
          await loadFolderScan(imported, "Imported external Photoshop edits", false, true);
          return;
        }
      }
      if (nextProject !== projectToCheck) {
        setProject(nextProject);
        if (projectNeedsSwbImport(projectToCheck) && !projectNeedsSwbImport(nextProject)) {
          void persistWorkspace(nextProject, nextFolderPath, nextMetadataPath).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            setWorkspaceSaveState("error");
            setAutosaveError((current) => autosaveErrorReducer(current, { type: "failed", message }));
            setStatus(`Autosave failed: ${message}`);
          });
        }
      }
      setScriptImportNeeded(result.scriptImportNeeded);
    }
  };

  const nudgeImportRequired = () => {
    setIsImportHelpOpen(true);
    setIsImportNudging(true);
    setStatus("Import external changes before editing");
    window.setTimeout(() => setIsImportNudging(false), 520);
  };

  const handleBitmapStroke = async (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    pendingStrokes: SketchStroke[] = []
  ) => {
    if (!window.storyboard || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    return bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked) {
        return undefined;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      let dataUrl = renderedDataUrl;

      if (!dataUrl) {
        const blankDataUrl = await createTransparentLayerDataUrl(currentLayer.width, currentLayer.height);
        const layerDataUrl = await window.storyboard
          .readLayerPng({ folderPath, bitmapPath: currentLayer.bitmapPath })
          .catch(() => undefined);
        const sourceDataUrl =
          layerDataUrl ??
          (currentLayer.cleared
            ? blankDataUrl
            : currentLayer.kind === "image"
              ? window.storyboard.assetUrl(currentShot.previewPath ?? currentShot.imagePath)
              : blankDataUrl);
        dataUrl = await drawStrokeOnBitmapLayer(sourceDataUrl, currentLayer, stroke, pendingStrokes);
      }

      await window.storyboard.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  const handleBitmapSelectionTransform = async (shot: Shot, layerId: string, dataUrl: string) => {
    if (!window.storyboard || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    return bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked) {
        return undefined;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      await window.storyboard.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  const handleBitmapFill = async (
    shot: Shot,
    layerId: string,
    point: { x: number; y: number },
    color: string
  ) => {
    if (!window.storyboard || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!canFillBitmapLayer(layer)) {
      return;
    }

    return bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shot.id) ?? shot;
      const currentLayer = bitmapLayersForShot(currentShot).find((item) => item.id === layerId);
      if (!canFillBitmapLayer(currentLayer)) {
        return undefined;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      const blankDataUrl = await createTransparentLayerDataUrl(currentLayer.width, currentLayer.height);
      const layerDataUrl = await window.storyboard
        .readLayerPng({ folderPath, bitmapPath: currentLayer.bitmapPath })
        .catch(() => undefined);
      const sourceDataUrl =
        layerDataUrl ??
        (currentLayer.cleared
          ? blankDataUrl
          : currentLayer.kind === "image"
            ? window.storyboard.assetUrl(currentShot.previewPath ?? currentShot.imagePath)
            : blankDataUrl);
      const dataUrl = await fillBitmapLayerAtPoint(sourceDataUrl, currentLayer, point, color);

      await window.storyboard.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl
      });
      markShotsDirty([currentShot.id]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) => markBitmapLayerPainted(currentProject, currentShot.id, currentLayer.id),
        false,
        false
      );
      return dataUrl;
    });
  };

  const loadFolderScan = async (
    scan: FolderScanPayload,
    nextStatus: string,
    dirty = false,
    resetDirtyShots = true
  ): Promise<Project | undefined> => {
    const checkId = (scriptImportCheckIdRef.current += 1);
    const baseProject = scan.project ?? createProject(scan.folderName || "Untitled Storyboard");
    const projectWithDefaults = {
      ...baseProject,
      name: scan.project ? baseProject.name : scan.folderName || baseProject.name,
      naming: {
        ...defaultProjectNaming,
        ...baseProject.naming
      }
    };
    const nextProject = scan.preserveProjectWithoutImageMerge
      ? ensureProjectBitmapMetadata(projectWithDefaults)
      : mergeFolderImages(projectWithDefaults, scan.images);
    if (
      resetDirtyShots &&
      !dirty &&
      window.storyboard &&
      hasOnlyCompatibleExternalEdits(nextProject)
    ) {
      const imported = await withStatus(
        "Import external Photoshop edits failed",
        () =>
          window.storyboard.importSwbFormat({
            project: nextProject,
            folderPath: scan.folderPath,
            metadataPath: scan.metadataPath,
            blankShotPreset,
            dirtyShotIds: [...dirtyShotIdsRef.current],
            preserveDirtyShotLayers: true
          }),
        setStatus
      );
      if (imported) {
        return loadFolderScan(imported, "Imported external Photoshop edits", false, true);
      }
    }
    const acceptedExternalEdits = projectAcceptedExternalEdits(nextProject);
    const loadedProjectChanged = projectChangedDuringLoad(projectWithDefaults, nextProject);
    let nextScriptImportNeeded = Boolean(scan.scriptImportNeeded);

    projectRef.current = nextProject;
    folderPathRef.current = scan.folderPath;
    metadataPathRef.current = scan.metadataPath;
    setProject(nextProject);
    setFolderPath(scan.folderPath);
    setFolderInputValue(scan.folderPath);
    setMetadataPath(scan.metadataPath);
    setWorkspaceSaveState(dirty || acceptedExternalEdits || loadedProjectChanged ? "saving" : "saved");
    setFileNameSyncState("synced");
    setStatus(acceptedExternalEdits ? "External TIFF edits accepted as new base" : nextStatus);
    setUndoStackSynced([]);
    setRedoStackSynced([]);
    selectSingleShot(nextProject.shots[0]?.id);
    if (resetDirtyShots) {
      dirtyShotIdsRef.current = new Set();
    }

    if (!nextScriptImportNeeded && window.storyboard) {
      nextScriptImportNeeded =
        (await checkStoryboardScriptImportState(nextProject, scan.folderPath, scan.metadataPath)) ?? false;
    }
    if (checkId === scriptImportCheckIdRef.current) {
      setScriptImportNeeded(nextScriptImportNeeded);
    }

    if (shouldPersistLoadedProject(scan.preserveProjectWithoutImageMerge, loadedProjectChanged, dirty, acceptedExternalEdits, nextScriptImportNeeded)) {
      void persistWorkspace(nextProject, scan.folderPath, scan.metadataPath).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setWorkspaceSaveState("error");
        setAutosaveError((current) => autosaveErrorReducer(current, { type: "failed", message }));
        setStatus(`Autosave failed: ${message}`);
      });
      return nextProject;
    }

    if (shouldAutosaveAfterLoad(dirty, acceptedExternalEdits, loadedProjectChanged, nextScriptImportNeeded)) {
      setAutosaveRevision((revision) => revision + 1);
    }
    return nextProject;
  };

  const handleOpenFolderByPath = async (pathOverride?: string) => {
    if (!window.storyboard) {
      setStatus("Cannot open folder: Electron preload API is unavailable");
      return;
    }

    const trimmedPath = (pathOverride ?? folderInputValue).trim();

    if (!trimmedPath) {
      setStatus("Paste a folder path first");
      return;
    }

    setWorkspaceTask({
      kind: "open",
      label: "Loading folder...",
      current: 0,
      total: 0
    });

    const result = await withStatus(
      "Open folder failed",
      () => window.storyboard.openFolderByPath(trimmedPath),
      setStatus
    );

    if (!result) {
      setWorkspaceTask(undefined);
      return;
    }

    await loadFolderScan(result, "Folder opened", !result.project);
    if (result.project) {
      setWorkspaceTask({
        kind: "open",
        label: "Checking external changes...",
        current: 0,
        total: 0
      });
      window.setTimeout(() => {
        void refreshExternalImportState().finally(() => {
          setWorkspaceTask((task) => (task?.kind === "open" ? undefined : task));
        });
      }, 0);
    } else {
      setWorkspaceTask(undefined);
    }
    void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);
  };

  const handleStoryboardScriptDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleStoryboardScriptDrop = async (event: ReactDragEvent<HTMLElement>) => {
    const sourceMarkdownPath = markdownPathFromDrop(event);
    if (!sourceMarkdownPath) {
      if (event.dataTransfer.files.length > 0) {
        event.preventDefault();
        setStatus("Drop a single local .md storyboard script file");
      }
      return;
    }

    event.preventDefault();
    if (!window.storyboard) {
      setStatus("Cannot import script: Electron preload API is unavailable");
      return;
    }

    const result = await withStatus(
      "Storyboard script inspect failed",
      () => window.storyboard.inspectStoryboardScript(sourceMarkdownPath),
      setStatus
    );
    if (!result) {
      return;
    }
    if (result.entryCount === 0) {
      setStatus("No numbered storyboard script entries found");
      return;
    }

    setStoryboardScriptImportDraft({
      sourceMarkdownPath,
      fileName: result.fileName,
      entryCount: result.entryCount,
      targetFolderPath: ""
    });
  };

  const handleSelectStoryboardScriptTargetFolder = async () => {
    if (!window.storyboard) {
      setStatus("Cannot choose folder: Electron preload API is unavailable");
      return;
    }

    const selectedFolder = await withStatus(
      "Choose folder failed",
      () => window.storyboard.selectFolder(),
      setStatus
    );
    if (!selectedFolder) {
      return;
    }

    setStoryboardScriptImportDraft((draft) =>
      draft ? { ...draft, targetFolderPath: selectedFolder } : draft
    );
  };

  const handleCreateProjectFromStoryboardScript = async () => {
    if (!window.storyboard || !storyboardScriptImportDraft) {
      return;
    }

    const targetFolderPath = storyboardScriptImportDraft.targetFolderPath.trim();
    if (!targetFolderPath) {
      setStatus("Choose an empty target folder first");
      return;
    }

    setWorkspaceTask({
      kind: "import",
      label: "Creating storyboard from script...",
      current: storyboardScriptImportDraft.entryCount,
      total: storyboardScriptImportDraft.entryCount
    });

    const result = await (async () => {
      try {
        return await withStatus(
          "Create storyboard from script failed",
          () =>
            window.storyboard.createFromStoryboardScript({
              sourceMarkdownPath: storyboardScriptImportDraft.sourceMarkdownPath,
              targetFolderPath,
              blankShotPreset
            }),
          setStatus
        );
      } finally {
        setWorkspaceTask(undefined);
      }
    })();

    if (!result) {
      return;
    }

    setStoryboardScriptImportDraft(undefined);
    await loadFolderScan(result, "Created storyboard from script");
    void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);
  };

  const handleSaveProject = async (): Promise<boolean> => {
    if (!window.storyboard) {
      const message = "Cannot save: Electron preload API is unavailable";
      setStatus(message);
      setSaveErrorDialog(message);
      return false;
    }

    if (!folderPath || !metadataPath) {
      const message = "Open a folder or add shots before saving";
      setStatus(message);
      setSaveErrorDialog(message);
      return false;
    }

    if (needsSwbImport) {
      const message = "Import external changes before saving";
      setStatus(message);
      setSaveErrorDialog(message);
      nudgeImportRequired();
      return false;
    }

    const trimmedProjectName = project.name.trim();
    if (!trimmedProjectName) {
      const message = "Project name is required before Save can rename image files";
      setStatus(message);
      setSaveErrorDialog(message);
      return false;
    }

    const missingNamingFields = [
      project.naming?.sceneCode.trim() ? undefined : `Scene (${defaultSaveNaming.sceneCode})`,
      project.naming?.artistName.trim() ? undefined : `Artist (${defaultSaveNaming.artistName})`,
      project.naming?.version.trim() ? undefined : `Version (${defaultSaveNaming.version})`
    ].filter((item): item is string => Boolean(item));

    if (missingNamingFields.length > 0) {
      const shouldContinue = window.confirm(
        `Missing naming fields: ${missingNamingFields.join(", ")}.\n\nContinue Save with these defaults?`
      );

      if (!shouldContinue) {
        setStatus("Save cancelled; file names unchanged");
        return false;
      }
    }

    const projectToSave: Project =
      missingNamingFields.length > 0
        ? {
            ...project,
            naming: {
              sceneCode: project.naming?.sceneCode.trim() || defaultSaveNaming.sceneCode,
              artistName: project.naming?.artistName.trim() || defaultSaveNaming.artistName,
              version: project.naming?.version.trim() || defaultSaveNaming.version
            }
          }
        : project;

    setWorkspaceTask({
      kind: "save",
      label: "Preparing save...",
      current: 0,
      total: 0
    });

    try {
      await persistWorkspace(projectToSave);
      const renamePlan = createRenamePlan(projectToSave, {
        allowDefaultNamingFields: missingNamingFields.length > 0
      });
      const renamedProject = applyRenamePlan(projectToSave, renamePlan);
      const result = await window.storyboard.saveWorkspace({
        project: { ...renamedProject, updatedAt: new Date().toISOString() },
        folderPath,
        metadataPath,
        renamePlan,
        dirtyShotIds: [...dirtyShotIdsRef.current]
      });

      setProject(result.project);
      setFolderPath(result.folderPath);
      setFolderInputValue(result.folderPath);
      setMetadataPath(result.metadataPath);
      setWorkspaceSaveState("saved");
      setFileNameSyncState("synced");
      dirtyShotIdsRef.current = new Set();
      workspaceSaveStateRef.current = "saved";
      fileNameSyncStateRef.current = "synced";
      setUndoStackSynced([]);
      setRedoStackSynced([]);
      setStatus("Saved and synced file names");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const saveFailureStatus = formatSaveFailureStatus(message);
      setStatus(saveFailureStatus);
      setSaveErrorDialog(saveFailureStatus);
      return false;
    } finally {
      setWorkspaceTask(undefined);
    }
  };

  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    return window.storyboard.onSaveAndCloseRequested(({ requestId }) => {
      void (async () => {
        const saved = await handleSaveProject();
        await window.storyboard.finishSaveAndClose({ requestId, saved });
        if (!saved) {
          setStatus("Save and Close cancelled because Save did not complete");
        }
      })();
    });
  }, [handleSaveProject]);

  const handleAddShot = async () => {
    if (!window.storyboard) {
      setStatus("Cannot add shot: Electron preload API is unavailable");
      return;
    }

    let targetFolderPath = folderPath;
    let baseProject = projectRef.current;
    let insertAfterShotId = primarySelectedShotId;

    if (!targetFolderPath || !metadataPath) {
      setStatus("Choose a folder for the first shot");
      const selectedFolder = await withStatus(
        "Choose folder failed",
        () => window.storyboard.selectFolder(),
        setStatus
      );
      if (!selectedFolder) {
        setStatus("Add shot cancelled");
        return;
      }

      setWorkspaceTask({
        kind: "open",
        label: "Loading folder...",
        current: 0,
        total: 0
      });

      const scan = await withStatus(
        "Open folder failed",
        () => window.storyboard.openFolderByPath(selectedFolder),
        setStatus
      );

      setWorkspaceTask(undefined);
      if (!scan) {
        return;
      }

      const loadedProject = await loadFolderScan(scan, "Folder opened", !scan.project);
      targetFolderPath = scan.folderPath;
      baseProject = loadedProject ?? projectRef.current;
      insertAfterShotId = baseProject.shots[0]?.id;
      void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);
    }

    const image = await withStatus(
      "Add shot failed",
      () => window.storyboard.createBlankShot(targetFolderPath, { preset: blankShotPreset }),
      setStatus
    );

    if (!image) {
      return;
    }

    const nextProject = addGeneratedShot(baseProject, image, insertAfterShotId);
    const nextShotId = nextProject.shots.find((shot) => shot.imagePath === image.imagePath)?.id;
    const nextShot = nextShotId ? nextProject.shots.find((shot) => shot.id === nextShotId) : undefined;
    if (nextShot) {
      const didCreateLayerAssets = await withStatus(
        "Add shot layer failed",
        async () => {
          await Promise.all(
            generatedShotTransparentLayerAssets(nextShot).map(async (layer) => {
              const dataUrl = await createTransparentLayerDataUrl(layer.width, layer.height);
              await window.storyboard.writeLayerPng({
                folderPath: targetFolderPath,
                bitmapPath: layer.bitmapPath,
                dataUrl
              });
            })
          );
          return true;
        },
        setStatus
      );
      if (!didCreateLayerAssets) {
        return;
      }
    }

    updateProject(nextProject, true, false);
    if (nextShotId) {
      markShotsDirty([nextShotId]);
    }
    selectSingleShot(nextShotId);
    setStatus(`Added ${blankShotPreset} shot: ${image.fileName}`);
  };

  const handleImportSwbFormat = async () => {
    if (!window.storyboard) {
      setStatus("Cannot import: Electron preload API is unavailable");
      return;
    }

    if (!folderPath || !metadataPath) {
      setStatus("Open a folder before importing");
      return;
    }

    if (!needsSwbImport) {
      setStatus("All images are already in Storyboard Flow Format");
      return;
    }

    setIsImportHelpOpen(false);
    setWorkspaceTask({
      kind: "import",
      label: needsImageImport ? "Importing workspace changes..." : "Importing storyboard script...",
      current: 0,
      total: needsImageImport
        ? [...project.shots, ...(project.parkedShots ?? [])].filter((shot) => shot.swb?.status !== "owned").length ||
          project.shots.length
        : 1
    });

    const result = await (async () => {
      try {
        return await withStatus(
          "Import failed",
          () =>
            window.storyboard.importSwbFormat({
              project,
              folderPath,
              metadataPath,
              blankShotPreset,
              dirtyShotIds: [...dirtyShotIdsRef.current]
            }),
          setStatus
        );
      } finally {
        setWorkspaceTask(undefined);
      }
    })();

    if (!result) {
      return;
    }

    await loadFolderScan(
      result,
      needsImageImport
        ? "Imported images into Storyboard Flow Format"
        : "Imported storyboard script changes",
      false,
      false
    );
  };

  const handleCreateDialogue = (shotId: string) => {
    const dialogueId = crypto.randomUUID();
    updateProject((currentProject) => addDialogue(currentProject, shotId, "", dialogueId));
    setEditingDialogueId(dialogueId);
  };

  const handleCopySelection = () => {
    const currentProject = projectRef.current;
    const result = copySelectionFromProject(
      currentProject,
      deleteTargetRef.current,
      selectedShotIdsRef.current
    );
    if (!result.ok) {
      setStatus(result.status);
      return;
    }

    clipboardSelectionRef.current = result.clipboard;
    setClipboardSelection(result.clipboard);
    setStatus(result.status);
  };

  const handlePasteSelection = async () => {
    const clipboard = clipboardSelectionRef.current;
    if (!clipboard) {
      setStatus("Nothing to paste");
      return;
    }

    if (clipboard.type === "shot") {
      await pasteCopiedShot(clipboard.shotId);
      return;
    }

    await pasteCopiedLayer(clipboard.shotId, clipboard.layerId);
  };

  const pasteCopiedShot = async (sourceShotId: string) => {
    if (!window.storyboard) {
      setStatus("Cannot paste storyboard: Electron preload API is unavailable");
      return;
    }
    if (!folderPath || !metadataPath) {
      setStatus("Cannot paste storyboard: workspace is not loaded");
      return;
    }

    const currentProject = projectRef.current;
    const sourceShot = currentProject.shots.find((shot) => shot.id === sourceShotId);
    const targetShot = primaryShotOrFirst(sortedShots(currentProject.shots), selectedShotIdsRef.current);
    if (!sourceShot || !targetShot) {
      setStatus("Cannot paste storyboard: copied or target storyboard is missing");
      return;
    }

    const pastedShotId = crypto.randomUUID();
    const copyPlan = shotAssetCopyPlan(sourceShot, pastedShotId);
    const ensuredLayerAssets = await withStatus(
      "Paste storyboard failed",
      () =>
        window.storyboard.ensureLayerAssets({
          project: currentProject,
          folderPath,
          metadataPath
        }),
      setStatus
    );

    if (!ensuredLayerAssets) {
      return;
    }

    const copiedAssets = await withStatus(
      "Paste storyboard failed",
      () =>
        window.storyboard.copyShotAssets({
          folderPath,
          sourceImagePath: sourceShot.imagePath,
          fileName: sourceShot.fileName,
          layerCopies: copyPlan.layerCopies
        }),
      setStatus
    );

    if (!copiedAssets) {
      return;
    }

    clearPasteAnimation(pasteAnimationFrameRef, pasteAnimationCleanupTimeoutRef);
    pasteAnimationRef.current = {
      kind: "shot",
      sourceId: sourceShot.id,
      pastedId: pastedShotId,
      beforeRects: measurePasteAnimationRects("shot")
    };
    const nextProject = duplicateShotAfter(currentProject, sourceShotId, targetShot.id, {
      shotId: pastedShotId,
      imagePath: copiedAssets.imagePath,
      fileName: copiedAssets.fileName,
      previewPath: copiedAssets.previewPath,
      placement: "after"
    });
    updateProject(nextProject);
    markShotsDirty([pastedShotId]);
    selectSingleShot(pastedShotId);
    setSelectedBitmapLayerIds(undefined);
    setDeleteTarget({ type: "shot" });
    setStatus("Storyboard pasted");
  };

  const pasteCopiedLayer = async (sourceShotId: string, sourceLayerId: string) => {
    if (!window.storyboard || !folderPath) {
      setStatus("Cannot paste layer: Electron preload API is unavailable");
      return;
    }

    const currentProject = projectRef.current;
    const pasteTarget = layerPasteTargetFromProject(
      currentProject,
      deleteTargetRef.current,
      sourceShotId,
      sourceLayerId
    );
    if (!pasteTarget.ok) {
      setStatus(pasteTarget.status);
      return;
    }
    const { sourceLayer, targetShot, targetLayer } = pasteTarget;

    const pastedLayerId = `layer-${crypto.randomUUID()}`;
    const targetBitmapPath = bitmapLayerPath(targetShot.id, pastedLayerId);
    const undoEntry = await createHistoryEntry([targetBitmapPath]);
    const copied = await withStatus(
      "Paste layer failed",
      () =>
        window.storyboard.copyLayerPng({
          folderPath,
          sourceBitmapPath: sourceLayer.bitmapPath,
          targetBitmapPath
        }),
      setStatus
    );

    if (!copied) {
      return;
    }

    clearPasteAnimation(pasteAnimationFrameRef, pasteAnimationCleanupTimeoutRef);
    pasteAnimationRef.current = {
      kind: "layer",
      sourceId: sourceLayer.id,
      pastedId: pastedLayerId,
      beforeRects: measurePasteAnimationRects("layer")
    };
    recordUndoEntry(undoEntry);
    markShotsDirty([targetShot.id]);
    updateProject(
      (projectToUpdate) =>
        copyBitmapLayerToShot(
          projectToUpdate,
          sourceShotId,
          sourceLayerId,
          targetShot.id,
          pastedLayerId,
          targetLayer.id,
          "before"
        ),
      false,
      false
    );
    selectSingleShot(targetShot.id);
    setSelectedBitmapLayerIds({ shotId: targetShot.id, layerIds: [pastedLayerId] });
    setDeleteTarget({ type: "layer", shotId: targetShot.id, layerId: pastedLayerId });
    setStatus(`Layer "${sourceLayer.name}" pasted`);
  };

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
      ? storyboardInsertionIndicatorFromCachedRect(nextTarget, rectCache)
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

    const insertionTarget = storyboardInsertionTargetFromPointer({
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

  const handleDragStart = (event: DragStartEvent) => {
    resetStoryboardInsertionDragState();
    resetParkingInsertionDragState();
    const data = event.active.data.current as DragData | undefined;
    setActiveDragType(data?.type);

    if (data?.type === "shot") {
      const movingShotIds = selectedShotIdsRef.current.includes(data.shotId)
        ? selectedShotIdsRef.current
        : [data.shotId];
      setActiveShotIds(movingShotIds);
      setDragPreviewShotIds(
        chooseDragPreviewShotIds({
          activeShotId: data.shotId,
          selectedShotIds: selectedShotIdsRef.current,
          orderedShotIds: orderedShots.map((shot) => shot.id)
        })
      );

      if (!selectedShotIdsRef.current.includes(data.shotId)) {
        selectSingleShot(data.shotId);
      }
    }

    if (data?.type === "parked-shot") {
      setActiveParkedShotIds([data.shotId]);
      openPendingShelf();
    }

    if (data?.type === "dialogue") {
      setActiveDialogue(project.dialogues.find((dialogue) => dialogue.id === data.dialogueId));
    }
  };

  const queueStoryboardInsertionTargetFromDrag = (event: DragMoveEvent | DragOverEvent | DragEndEvent) => {
    const activeData = event.active.data.current as DragData | undefined;
    if ((activeData?.type !== "shot" && activeData?.type !== "parked-shot") || isAnimationModeRef.current) {
      resetStoryboardInsertionDragState();
      return;
    }

    const pointer =
      lastPointerPositionRef.current ??
      pointerFromActiveDragRect(event.active.rect.current.translated ?? event.active.rect.current.initial);
    if (!pointer) {
      clearStoryboardInsertionTarget();
      return;
    }

    if (activeData.type === "parked-shot" && !isPointerInsideElement(boardGridRef.current, pointer)) {
      clearStoryboardInsertionTarget();
      return;
    }

    if (activeData.type === "shot" && isPointerInsideElement(parkingListRef.current, pointer)) {
      clearStoryboardInsertionTarget();
      return;
    }

    const movingShotIds =
      activeData.type === "shot"
        ? selectedShotIdsRef.current.includes(activeData.shotId)
          ? selectedShotIdsRef.current
          : [activeData.shotId]
        : [];
    pendingStoryboardInsertionDragRef.current = {
      pointer,
      movingShotIds
    };

    if (storyboardInsertionFrameRef.current !== undefined) {
      return;
    }

    storyboardInsertionFrameRef.current = window.requestAnimationFrame(() => {
      storyboardInsertionFrameRef.current = undefined;
      applyQueuedStoryboardInsertionTarget();
    });
  };

  const queueParkingInsertionTargetFromDrag = (event: DragMoveEvent | DragOverEvent | DragEndEvent) => {
    const activeData = event.active.data.current as DragData | undefined;
    if (activeData?.type !== "shot") {
      resetParkingInsertionDragState();
      return;
    }

    const pointer =
      lastPointerPositionRef.current ??
      pointerFromActiveDragRect(event.active.rect.current.translated ?? event.active.rect.current.initial);
    if (!pointer || !isPointerInsideElement(parkingListRef.current, pointer)) {
      clearParkingInsertionTarget();
      return;
    }

    pendingParkingInsertionDragRef.current = {
      pointer,
      movingShotIds: []
    };

    if (parkingInsertionFrameRef.current !== undefined) {
      return;
    }

    parkingInsertionFrameRef.current = window.requestAnimationFrame(() => {
      parkingInsertionFrameRef.current = undefined;
      applyQueuedParkingInsertionTarget();
    });
  };

  const handleDragMove = (event: DragMoveEvent) => {
    queueStoryboardInsertionTargetFromDrag(event);
    queueParkingInsertionTargetFromDrag(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    queueStoryboardInsertionTargetFromDrag(event);
    queueParkingInsertionTargetFromDrag(event);
  };

  const handleDragCancel = () => {
    setActiveDragType(undefined);
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setActiveParkedShotIds([]);
    resetStoryboardInsertionDragState();
    resetParkingInsertionDragState();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    queueStoryboardInsertionTargetFromDrag(event);
    queueParkingInsertionTargetFromDrag(event);
    flushQueuedStoryboardInsertionTarget();
    flushQueuedParkingInsertionTarget();
    const dragEndStoryboardInsertionTarget = storyboardInsertionTargetRef.current;
    const dragEndParkingInsertionTarget = parkingInsertionTargetRef.current;
    setActiveDragType(undefined);
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setActiveParkedShotIds([]);
    resetStoryboardInsertionDragState();
    resetParkingInsertionDragState();

    const activeData = event.active.data.current as DragData | undefined;
    const overData = event.over?.data.current as DragData | undefined;

    if (!activeData) {
      return;
    }

    if (
      activeData.type === "shot" &&
      dragEndInsideSelector(event, ".parking-shelf.is-open", lastPointerPositionRef.current)
    ) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const nextProject = parkShotGroup(
        projectRef.current,
        movingShotIds,
        dragEndParkingInsertionTarget
          ? {
              targetParkedShotId: dragEndParkingInsertionTarget.targetShotId,
              placement: dragEndParkingInsertionTarget.placement
            }
          : undefined
      );
      updateProject(nextProject);
      const nextSelectedShot = sortedShots(nextProject.shots)[0];
      selectSingleShot(nextSelectedShot?.id);
      setDeleteTarget({ type: "shot" });
      setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to pending`);
      return;
    }

    if (!overData && !dragEndStoryboardInsertionTarget) {
      return;
    }

    if (
      activeData.type === "shot" &&
      (overData?.type === "parking-zone" || overData?.type === "parked-shot")
    ) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const nextProject = parkShotGroup(
        projectRef.current,
        movingShotIds,
        dragEndParkingInsertionTarget
          ? {
              targetParkedShotId: dragEndParkingInsertionTarget.targetShotId,
              placement: dragEndParkingInsertionTarget.placement
            }
          : undefined
      );
      updateProject(nextProject);
      const nextSelectedShot = sortedShots(nextProject.shots)[0];
      selectSingleShot(nextSelectedShot?.id);
      setDeleteTarget({ type: "shot" });
      setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to pending`);
      return;
    }

    if (
      activeData.type === "shot" &&
      (dragEndStoryboardInsertionTarget || overData?.type === "shot")
    ) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const fallbackTargetShotId = overData?.type === "shot" ? overData.shotId : undefined;
      const targetShotId = dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId) {
        return;
      }
      const currentProject = projectRef.current;
      const placement =
        dragEndStoryboardInsertionTarget?.placement ??
        inferShotPlacement(currentProject, movingShotIds, targetShotId, activeData.shotId);
      const nextProject =
        movingShotIds.length > 1
          ? reorderShotGroup(currentProject, movingShotIds, targetShotId, placement)
          : reorderShots(currentProject, activeData.shotId, targetShotId, placement);
      if (nextProject === currentProject) {
        return;
      }

      clearPasteAnimation(pasteAnimationFrameRef, pasteAnimationCleanupTimeoutRef);
      pasteAnimationRef.current = {
        kind: "shot",
        sourceId: "",
        pastedId: "",
        beforeRects: measurePasteAnimationRects("shot")
      };
      updateProject(nextProject);
    }

    if (
      activeData.type === "parked-shot" &&
      (dragEndStoryboardInsertionTarget || overData?.type === "shot" || overData?.type === "drop-zone")
    ) {
      const fallbackTargetShotId =
        overData?.type === "shot" || overData?.type === "drop-zone" ? overData.shotId : undefined;
      const targetShotId = dragEndStoryboardInsertionTarget?.targetShotId ?? fallbackTargetShotId;
      if (!targetShotId) {
        return;
      }
      const placement = dragEndStoryboardInsertionTarget?.placement ?? inferDropPlacementFromDragEnd(event);
      const nextProject = restoreParkedShotGroup(projectRef.current, [activeData.shotId], targetShotId, placement);
      updateProject(nextProject);
      selectSingleShot(activeData.shotId);
      setDeleteTarget({ type: "shot" });
      setStatus("Storyboard restored from pending");
    }

    if (activeData.type === "dialogue" && (overData?.type === "shot" || overData?.type === "drop-zone")) {
      const targetShotId = overData.type === "drop-zone" ? overData.shotId : overData.shotId;

      if (targetShotId && targetShotId !== activeData.shotId) {
        updateProject((currentProject) =>
          moveDialogueToShot(currentProject, activeData.dialogueId, targetShotId)
        );
      }
    }
  };

  const handleShotSelect = (shotId: string, event: MouseEvent) => {
    if (!isKeyboardEditableTarget(event.target)) {
      blurActiveFormControl();
    }

    setDeleteTarget({ type: "shot" });
    setSelectedBitmapLayerIds(undefined);

    if (event.shiftKey) {
      selectShotWithMode(shotId, "range");
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      selectShotWithMode(shotId, "toggle");
      return;
    }

    selectShotWithMode(shotId, "single");
  };

  const handleSelectionPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0) {
      return;
    }

    const board = event.currentTarget;
    const marqueeShotRects = storyboardMarqueeShotRectsFromDom(board, currentBoardScroll());
    const marqueeShotElements = storyboardMarqueeShotElementsFromDom(board);
    const initialSelectedShotIds = selectedShotIdsRef.current;
    const shouldCommitShotDeleteTarget = deleteTargetRef.current.type !== "shot";
    let marqueeSelectedShotIds: string[] = [];
    const initialBoardScroll = currentBoardScroll();
    const nextBox = createMarqueeBox({
      clientX: event.clientX,
      clientY: event.clientY,
      scrollX: initialBoardScroll.x,
      scrollY: initialBoardScroll.y
    });
    board.classList.add("is-marquee-selecting");
    showSelectionMarquee(selectionMarqueeRef.current, nextBox);
    shotSelectionAnchorIdRef.current = undefined;
    selectedShotIdsRef.current = [];
    deleteTargetRef.current = { type: "shot" };
    clearCommittedMarqueeShotSelection(marqueeShotElements, initialSelectedShotIds);
    applyMarqueeShotSelection(marqueeShotElements, [], marqueeSelectedShotIds);
    applySelectedShotCountLabel(selectedShotCountLabelRef.current, marqueeSelectedShotIds.length);
    let latestPointer = { clientX: event.clientX, clientY: event.clientY };
    let marqueeFrame: number | undefined;

    function updateMarqueeSelection(continueAutoScroll: boolean) {
      const scrollViewportRect = workspaceBoardScrollRef.current?.getBoundingClientRect();
      const scrollDelta = marqueeEdgeScrollDelta({
        pointerY: latestPointer.clientY,
        viewportTop: scrollViewportRect?.top ?? 0,
        viewportHeight: scrollViewportRect?.height ?? window.innerHeight
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

    function scheduleMarqueeUpdate() {
      if (marqueeFrame !== undefined) {
        return;
      }

      marqueeFrame = window.requestAnimationFrame(() => {
        marqueeFrame = undefined;
        updateMarqueeSelection(true);
      });
    }

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      scheduleMarqueeUpdate();
    };

    const handlePointerUp = () => {
      if (marqueeFrame !== undefined) {
        window.cancelAnimationFrame(marqueeFrame);
        marqueeFrame = undefined;
      }
      updateMarqueeSelection(false);
      selectShotsByIds(marqueeSelectedShotIds);
      if (shouldCommitShotDeleteTarget) {
        setDeleteTarget({ type: "shot" });
      }
      hideSelectionMarquee(selectionMarqueeRef.current);
      board.classList.remove("is-marquee-selecting");
      window.requestAnimationFrame(() => {
        applyMarqueeShotSelection(marqueeShotElements, marqueeSelectedShotIds, []);
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    scheduleMarqueeUpdate();
  };

  const persistToolRadialMenuConfig = (nextConfig: ToolRadialMenuConfig) => {
    const normalized = normalizeToolRadialMenuConfig(nextConfig);
    setToolRadialMenuConfig(normalized);
    void window.storyboard?.setToolRadialMenu?.(normalized).catch(() => {
      setStatus("Could not save radial shortcut settings");
    });
  };

  const clearRadialToolMenuCloseTimeout = useCallback(() => {
    if (radialToolMenuCloseTimeoutRef.current !== undefined) {
      window.clearTimeout(radialToolMenuCloseTimeoutRef.current);
      radialToolMenuCloseTimeoutRef.current = undefined;
    }
  }, []);

  const openRadialToolMenu = useCallback(
    (nextMenu: Omit<RadialToolMenuState, "isClosing">) => {
      clearRadialToolMenuCloseTimeout();
      setRadialToolMenu(openRadialToolMenuState(nextMenu));
    },
    [clearRadialToolMenuCloseTimeout]
  );

  const closeRadialToolMenu = useCallback(() => {
    clearRadialToolMenuCloseTimeout();

    const shouldReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shouldReduceMotion) {
      setRadialToolMenu(undefined);
      return;
    }

    setRadialToolMenu((current) => closeRadialToolMenuState(current, false));
    radialToolMenuCloseTimeoutRef.current = window.setTimeout(() => {
      radialToolMenuCloseTimeoutRef.current = undefined;
      setRadialToolMenu(undefined);
    }, radialToolMenuCloseAnimationMs);
  }, [clearRadialToolMenuCloseTimeout]);

  useEffect(() => clearRadialToolMenuCloseTimeout, [clearRadialToolMenuCloseTimeout]);

  const openSketchCanvasContextMenu = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, .save-menu")) {
      return;
    }

    const action = radialCanvasContextMenuAction({
      isCanvasTarget: Boolean(target.closest(".image-stage")),
      isInsideRadialMenu: Boolean(target.closest(".radial-tool-menu")),
      hasOpenRadialMenu: Boolean(radialToolMenu && !radialToolMenu.isClosing),
      activeTool: activeSketchTool
    });

    if (action === "ignore") {
      return;
    }

    event.preventDefault();
    if (action === "close") {
      closeRadialToolMenu();
      return;
    }

    if (needsSwbImport) {
      setStatus("Import external changes before editing");
      return;
    }

    if (activeSketchTool !== "brush" && activeSketchTool !== "eraser") {
      return;
    }

    openRadialToolMenu({
      tool: activeSketchTool,
      x: event.clientX,
      y: event.clientY
    });
  };

  const boardZoomCssVariables = zoomPreviewStateRef.current?.cssVariables;
  const showStoryboardInsertionIndicator = shouldShowStoryboardInsertionIndicator({
    activeShotCount: activeShotIds.length + activeParkedShotIds.length,
    hasIndicator: Boolean(storyboardInsertionIndicator)
  });
  const currentSketchToolSettings = {
    tool: activeSketchTool,
    brushColor,
    brushSize,
    brushOpacity,
    brushSoftness,
    eraserSize,
    eraserOpacity,
    eraserSoftness
  };
  const applySketchToolSettings = (settings: typeof currentSketchToolSettings) => {
    setActiveSketchTool(settings.tool);
    setBrushColor(settings.brushColor);
    setBrushSize(settings.brushSize);
    setBrushOpacity(settings.brushOpacity);
    setBrushSoftness(settings.brushSoftness);
    setEraserSize(settings.eraserSize);
    setEraserOpacity(settings.eraserOpacity);
    setEraserSoftness(settings.eraserSoftness);
  };
  const applyRadialPreset = (slot: RadialPresetSlot) => {
    applySketchToolSettings(applyRadialPresetSlot(currentSketchToolSettings, slot));
    closeRadialToolMenu();
  };
  const adjustRadialToolValue = (kind: RadialDragKind, value: number) => {
    applySketchToolSettings(updateRadialDragSettings(currentSketchToolSettings, kind, value));
  };
  const updateRadialSlot = (tool: StrokeTool, index: number, slot: RadialToolSlot) => {
    persistToolRadialMenuConfig(nextRadialSlotConfig(toolRadialMenuConfig, tool, index, slot));
  };
  const handleAiProjectChange = (nextProject: Project, nextStatus: string) => {
    const currentProject = projectRef.current;
    const changedLayerShotIds = nextProject.shots
      .filter((nextShot) => {
        const currentShot = currentProject.shots.find((shot) => shot.id === nextShot.id);
        return (
          currentShot?.activeLayerId !== nextShot.activeLayerId ||
          JSON.stringify(currentShot?.layers ?? []) !== JSON.stringify(nextShot.layers ?? [])
        );
      })
      .map((shot) => shot.id);
    markShotsDirty(changedLayerShotIds);
    setProject(nextProject);
    projectRef.current = nextProject;
    setWorkspaceSaveState("saving");
    setAutosaveRevision((revision) => revision + 1);
    setStatus(nextStatus);
  };
  const handleToggleAiPanel = () => {
    if (!folderPath) {
      setStatus("Open a folder before using AI Draft");
      return;
    }
    toggleAiPanel();
  };
  const handleTogglePendingShelf = togglePendingShelf;
  const isAiPanelVisible = Boolean(folderPath && isAiPanelOpen);

  return (
    <main
      ref={appShellRef}
      className={[
        "app-shell",
        isAnimationMode ? "is-animation-mode" : "",
        isParkingShelfOpen ? "has-parking-shelf-open" : "",
        isAiPanelVisible ? "has-ai-panel-open" : ""
      ].filter(Boolean).join(" ")}
      onContextMenu={openSketchCanvasContextMenu}
      onDragOver={handleStoryboardScriptDragOver}
      onDrop={(event) => void handleStoryboardScriptDrop(event)}
    >
      <header className="topbar">
        <div className="import-control" ref={importHelpRef}>
          <button
            type="button"
            className={isImportNudging ? "import-button is-nudging" : "import-button"}
            onClick={() => void handleImportSwbFormat()}
            disabled={!needsSwbImport || isWorkspaceTaskRunning}
            title="Import image or storyboard-script.md changes into Storyboard Flow"
          >
            {workspaceTask?.kind === "import" ? "Importing..." : "Import"}
          </button>
          {hasSwbWarning ? (
            <button
              type="button"
              className={isImportNudging ? "import-warning is-nudging" : "import-warning"}
              aria-label="Import explanation"
              aria-expanded={isImportHelpOpen}
              onClick={() => setIsImportHelpOpen((isOpen) => !isOpen)}
            >
              !
            </button>
          ) : null}
          {isImportHelpOpen ? (
            <div className="import-help-popover" role="dialog" aria-label="Import explanation">
              <strong>为什么需要 Import？</strong>
              <p>
                Import 会把外部 TIFF 和 storyboard-script.md 的变化导入 Storyboard
                Flow。在你点击 Import 之前，软件内的编辑仍然是当前工作状态。
              </p>
              <p>
                原始 TIFF 会先移动到 Archive，然后 Storyboard Flow 接管工作文件。
                能匹配上的镜头顺序、台词、分镜脚本文字和支持的位图图层会尽量继承。
              </p>
              <p>
                Photoshop-only 信息不会作为内部工作格式。Save 会从
                .storyboard-workbench/layers 下的 PNG 数据重建工作 TIFF。
              </p>
              <p>
                storyboard-script.md 是根目录下的文字镜像。软件内编辑会自动写入；
                外部修改这个 MD 文档后，需要点击 Import 才会导入软件。
              </p>
            </div>
          ) : null}
          <div className="save-menu-container" ref={saveMenuRef}>
            <div className="save-split-button">
              <button
                type="button"
                className="save-main-button"
                disabled={isWorkspaceTaskRunning || isImportLocked}
                onClick={() => {
                  setIsSaveMenuOpen(false);
                  void handleSaveProject();
                }}
              >
                {workspaceTask?.kind === "save" ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="save-menu-toggle"
                aria-label="Save naming options"
                aria-expanded={isSaveMenuOpen}
                disabled={isWorkspaceTaskRunning || isImportLocked}
                onClick={() => setIsSaveMenuOpen((isOpen) => !isOpen)}
              >
                <span className="save-caret" aria-hidden="true" />
              </button>
            </div>
            {isSaveMenuOpen ? (
              <div className="save-menu" aria-label="Save naming options">
                <label className="save-menu-field">
                  <span>Project</span>
                  <input
                    aria-label="Project name"
                    value={project.name}
                    onChange={(event) => updateProjectName(event.target.value)}
                    placeholder="Untitled Storyboard"
                  />
                </label>
                <label className="save-menu-field">
                  <span>Scene</span>
                  <input
                    aria-label="Scene code"
                    value={project.naming?.sceneCode ?? ""}
                    onChange={(event) => updateProjectNaming("sceneCode", event.target.value)}
                    placeholder="scene"
                  />
                </label>
                <label className="save-menu-field">
                  <span>Artist</span>
                  <input
                    aria-label="Artist name"
                    value={project.naming?.artistName ?? ""}
                    onChange={(event) => updateProjectNaming("artistName", event.target.value)}
                    placeholder="artist"
                  />
                </label>
                <label className="save-menu-field">
                  <span>Version</span>
                  <input
                    aria-label="Version"
                    value={project.naming?.version ?? ""}
                    onChange={(event) => updateProjectNaming("version", event.target.value)}
                    placeholder="v001"
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <div className="address-bar-container" ref={recentMenuRef}>
          <div className="address-bar">
            <form
              className="path-form"
              onSubmit={(event) => {
                event.preventDefault();
                setIsRecentMenuOpen(false);
                void handleOpenFolderByPath();
              }}
            >
              <input
                aria-label="Folder path"
                value={folderInputValue}
                onChange={(event) => setFolderInputValue(event.target.value)}
                placeholder="/Users/name/Pictures/scene"
              />
            </form>
            <button
              type="button"
              className="address-recent-toggle"
              aria-label="Recent folders"
              aria-expanded={isRecentMenuOpen}
              disabled={recentFolders.length === 0}
              onClick={() => setIsRecentMenuOpen((isOpen) => !isOpen)}
            >
              <span className="address-caret" aria-hidden="true" />
            </button>
          </div>
          {isRecentMenuOpen ? (
            <div className="recent-menu" aria-label="Recent folders">
              {recentFolders.map((recentFolder) => (
                <button
                  key={recentFolder}
                  type="button"
                  onClick={() => {
                    setIsRecentMenuOpen(false);
                    setFolderInputValue(recentFolder);
                    void handleOpenFolderByPath(recentFolder);
                  }}
                >
                  {recentFolder}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="toolbar">
          <button
            type="button"
            className={`ai-panel-toggle ${isAiPanelVisible ? "selected" : ""}`}
            aria-label="Toggle AI Draft panel"
            aria-expanded={isAiPanelVisible}
            title="AI Draft"
            onClick={handleToggleAiPanel}
          >
            AI
          </button>
          <div className="add-shot-menu-container" ref={addShotMenuRef}>
            <div className="add-shot-split-button">
              <button
                type="button"
                className="add-shot-main-button"
                disabled={isImportLocked}
                onClick={() => {
                  if (isImportLocked) {
                    nudgeImportRequired();
                    return;
                  }
                  setIsAddShotMenuOpen(false);
                  void handleAddShot();
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="add-shot-menu-toggle"
                aria-label="Add shot aspect ratio"
                aria-expanded={isAddShotMenuOpen}
                disabled={isImportLocked}
                onClick={() => setIsAddShotMenuOpen((isOpen) => !isOpen)}
              >
                <span className="add-shot-caret" aria-hidden="true" />
              </button>
            </div>
            {isAddShotMenuOpen ? (
              <div className="add-shot-menu" aria-label="Add shot aspect ratio">
                {blankShotPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={preset.id === blankShotPreset ? "is-selected" : ""}
                    onClick={() => {
                      setBlankShotPreset(preset.id);
                      setIsAddShotMenuOpen(false);
                    }}
                  >
                    <span>{preset.label}</span>
                    <small>{preset.detail}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`pending-shelf-toggle ${isParkingShelfOpen ? "selected" : ""}`}
            aria-label="Toggle pending sidebar"
            aria-expanded={isParkingShelfOpen}
            title="Pending sidebar"
            onClick={handleTogglePendingShelf}
          >
            <SidePanelIcon />
          </button>
        </div>
      </header>

      {workspaceTask ? (
        <div className="workspace-task-progress" role="status" aria-live="polite">
          <div className="workspace-task-progress-copy">
            <span>{workspaceTask.label}</span>
            <span>
              {workspaceTask.current} / {workspaceTask.total}{" "}
              {workspaceTask.kind === "open" ? "images" : "shots"}
            </span>
          </div>
          <div className="workspace-task-progress-track" aria-hidden="true">
            <div className="workspace-task-progress-line" />
          </div>
        </div>
      ) : null}

      {saveErrorDialog ? (
        <div className="save-error-modal-backdrop" role="presentation">
          <section
            className="save-error-modal"
            role="alertdialog"
            aria-label="Save failed"
            aria-modal="true"
          >
            <header>
              <strong>Save failed</strong>
            </header>
            <p>{saveErrorDialog}</p>
            <div className="save-error-actions">
              <button
                type="button"
                className="primary"
                autoFocus
                onClick={() => setSaveErrorDialog(undefined)}
              >
                OK
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {storyboardScriptImportDraft ? (
        <div className="script-import-modal-backdrop" role="presentation">
          <section
            className="script-import-modal"
            role="dialog"
            aria-label="Create storyboard from Markdown"
          >
            <header>
              <strong>导入文字分镜脚本？</strong>
              <button
                type="button"
                aria-label="Cancel storyboard script import"
                onClick={() => setStoryboardScriptImportDraft(undefined)}
              >
                x
              </button>
            </header>
            <p>
              {storyboardScriptImportDraft.fileName} 里有 {storyboardScriptImportDraft.entryCount} 个镜头条目。
            </p>
            <label className="script-import-target">
              <span>目标文件夹</span>
              <input
                aria-label="Storyboard script target folder"
                value={storyboardScriptImportDraft.targetFolderPath}
                readOnly
                placeholder="选择一个空文件夹"
              />
            </label>
            <div className="script-import-actions">
              <button
                type="button"
                onClick={() => void handleSelectStoryboardScriptTargetFolder()}
              >
                Choose Folder
              </button>
              <button
                type="button"
                className="primary"
                disabled={!storyboardScriptImportDraft.targetFolderPath || isWorkspaceTaskRunning}
                onClick={() => void handleCreateProjectFromStoryboardScript()}
              >
                Create Storyboard
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="workspace-layout">
        <aside className="tool-rail" aria-label="Sketch tools">
          <button
            type="button"
            className={`card-face-tool ${cardFace === "script" ? "selected" : ""}`}
            onClick={() => setCardFace((face) => (face === "image" ? "script" : "image"))}
            title={cardFace === "image" ? "Show script side" : "Show image side"}
            aria-label={cardFace === "image" ? "Show script side" : "Show image side"}
          >
            <CardFaceIcon />
          </button>
          <div className="shortcut-menu-container" ref={shortcutMenuRef}>
            <button
              type="button"
              className={isShortcutMenuOpen ? "selected" : ""}
              onClick={() => setIsShortcutMenuOpen((isOpen) => !isOpen)}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              aria-expanded={isShortcutMenuOpen}
            >
              <GearIcon />
            </button>
            {isShortcutMenuOpen ? (
              <div className="shortcut-menu" aria-label="Keyboard shortcuts">
                <div className="shortcut-menu-head">
                  <strong>Shortcuts</strong>
                  <span>Fixed shortcuts for the current build.</span>
                </div>
                <div className="shortcut-list">
                  {shortcutMenuItems.map(({ action, label }) => (
                    <div key={action} className="shortcut-field">
                      <span>{label}</span>
                      <kbd className="shortcut-key-display">{defaultKeyboardShortcuts[action]}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={activeSketchTool === "brush" ? "selected" : ""}
            onClick={() => {
              setActiveSketchTool("brush");
              closeRadialToolMenu();
            }}
            onContextMenu={(event) => event.preventDefault()}
            title="Brush"
            aria-label="Brush"
          >
            <BrushIcon />
          </button>
          <button
            type="button"
            className={activeSketchTool === "eraser" ? "selected" : ""}
            onClick={() => {
              setActiveSketchTool("eraser");
              closeRadialToolMenu();
            }}
            onContextMenu={(event) => event.preventDefault()}
            title="Eraser"
            aria-label="Eraser"
          >
            <EraserIcon />
          </button>
          <button
            type="button"
            className={activeSketchTool === "select" ? "selected" : ""}
            onClick={() => {
              setActiveSketchTool("select");
              closeRadialToolMenu();
            }}
            title="Select"
            aria-label="Select"
          >
            <SelectIcon />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!primarySelectedShot) {
                setStatus("Select a shot before clearing a layer");
                return;
              }
              const activeLayer = activeVisibleBitmapLayerForShot(primarySelectedShot);
              if (activeLayer) {
                void handleClearBitmapLayer(primarySelectedShot.id, activeLayer.id);
              }
            }}
            title="Clear current layer"
            aria-label="Clear current layer"
          >
            <ClearIcon />
          </button>
          <label
            className="color-control"
            title="Brush color"
            style={{ "--brush-swatch-color": brushColor } as CSSProperties}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData("application/x-storyboard-fill-color", brushColor);
            }}
          >
            <input
              aria-label="Brush color"
              type="color"
              value={brushColor}
              onChange={(event) => setBrushColor(event.target.value)}
            />
            <SwatchIcon />
          </label>
        </aside>
        {radialToolMenu ? (
          <RadialToolMenu
            menu={toolRadialMenuConfig[radialToolMenu.tool]}
            tool={radialToolMenu.tool}
            x={radialToolMenu.x}
            y={radialToolMenu.y}
            isClosing={radialToolMenu.isClosing === true}
            settings={currentSketchToolSettings}
            onApplyPreset={applyRadialPreset}
            onAdjust={adjustRadialToolValue}
            onUpdateSlot={(index, slot) => updateRadialSlot(radialToolMenu.tool, index, slot)}
            onClose={closeRadialToolMenu}
          />
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="workspace-board-scroll" ref={workspaceBoardScrollRef}>
            <SortableContext
              items={storyboardSortableItemIds}
              strategy={rectSortingStrategy}
            >
              <section
                ref={boardGridRef}
                className="board-grid"
                style={
                  {
                    "--shot-scale": boardZoomCssVariables?.shotScale ?? zoomLevel / 100,
                    "--animation-image-width":
                      boardZoomCssVariables?.animationImageWidth ?? `${animationImageSize.width}px`,
                    "--animation-image-height":
                      boardZoomCssVariables?.animationImageHeight ?? `${animationImageSize.height}px`,
                    "--animation-frame-width":
                      boardZoomCssVariables?.animationFrameWidth ?? `${animationFrameSize.width}px`,
                    "--animation-frame-height":
                      boardZoomCssVariables?.animationFrameHeight ?? `${animationFrameSize.height}px`
                  } as CSSProperties
                }
                onPointerDown={handleSelectionPointerDown}
              >
                {renderedShotEntries.map((entry) => {
                  const { shot, index } = entry;
                  return (
                    <ShotCard
                      key={shot.id}
                      shot={shot}
                      index={index}
                    project={project}
                    folderPath={folderPath}
                    isSelected={selectedShotIds.length > 1 && selectedShotIds.includes(shot.id)}
                    isPrimarySelected={shot.id === primarySelectedShotId}
                    isAnimationFocused={isAnimationMode && shot.id === primarySelectedShotId}
                    isZoomScrubbing={isZoomScrubbing}
                    disableSortableTransform={activeShotIds.length > 0}
                    keepDraggingSourceVisible={activeShotIds.includes(shot.id)}
                    activeDragType={activeDragType}
                    activeSketchTool={activeSketchTool}
                    brushColor={brushColor}
                    brushOpacity={brushOpacity}
                    brushSize={brushSize}
                    brushSoftness={brushSoftness}
                    eraserOpacity={eraserOpacity}
                    eraserSize={eraserSize}
                    eraserSoftness={eraserSoftness}
                    cardFace={cardFace}
                    onionSkinPreviousShot={
                      isAnimationMode && shot.id === primarySelectedShotId
                        ? onionSkinNeighbors.previous
                        : undefined
                    }
                    onionSkinNextShot={
                      isAnimationMode && shot.id === primarySelectedShotId
                        ? onionSkinNeighbors.next
                        : undefined
                    }
                      editingDialogueId={editingDialogueId}
                      onSelect={(event) => handleShotSelect(shot.id, event)}
                    onFocusShot={() => {
                      selectSingleShot(shot.id);
                      setDeleteTarget({ type: "shot" });
                      setSelectedBitmapLayerIds(undefined);
                    }}
                      isLayerPanelOpen={isLayerPanelOpen && shot.id === primarySelectedShotId}
                      thumbnailRevision={autosaveRevision}
                      onToggleLayerPanel={() => {
                        selectSingleShot(shot.id);
                        setDeleteTarget({ type: "shot" });
                        setSelectedBitmapLayerIds(undefined);
                        setIsLayerPanelOpen((isOpen) => (shot.id === primarySelectedShotId ? !isOpen : true));
                      }}
                      onAddLayer={(shotId) => void handleAddBitmapLayer(shotId)}
                      onRemoveLayer={(shotId, layerId) =>
                        void handleRemoveBitmapLayer(shotId, layerId)
                      }
                      onMergeLayers={(shotId, layerId, selectedLayerIds) =>
                        void handleMergeBitmapLayers(shotId, layerId, selectedLayerIds)
                      }
                      onMergeVisibleLayers={(shotId) => void handleMergeVisibleBitmapLayers(shotId)}
                      onClearLayer={(shotId, layerId) => void handleClearBitmapLayer(shotId, layerId)}
                      onSelectLayer={(shotId, layerId) => {
                        shotSelectionAnchorIdRef.current = undefined;
                        setDeleteTarget({ type: "layer", shotId, layerId });
                        updateProject((currentProject) => selectBitmapLayer(currentProject, shotId, layerId), false, false);
                      }}
                      onUpdateLayer={(shotId, layerId, patch) => {
                        markShotsDirty([shotId]);
                        updateProject(
                          (currentProject) => updateBitmapLayer(currentProject, shotId, layerId, patch),
                          false
                        );
                      }}
                      onMoveLayer={(shotId, layerId, targetLayerId, placement) => {
                        markShotsDirty([shotId]);
                        updateProject(
                          (currentProject) =>
                            moveBitmapLayer(currentProject, shotId, layerId, targetLayerId, placement),
                          false
                        );
                      }}
                      onMoveLayerGroup={(shotId, layerIds, targetLayerId, placement) => {
                        markShotsDirty([shotId]);
                        updateProject(
                          (currentProject) =>
                            moveBitmapLayerGroup(currentProject, shotId, layerIds, targetLayerId, placement),
                          false
                        );
                      }}
                      onSelectedLayerIdsChange={handleSelectedBitmapLayerIdsChange}
                      onUpdateLayerGroupOpacity={(shotId, layerIds, deltaOpacity, initialOpacityByLayerId) => {
                        markShotsDirty([shotId]);
                        updateProject(
                          (currentProject) =>
                            updateBitmapLayerGroupOpacity(
                              currentProject,
                              shotId,
                              layerIds,
                              deltaOpacity,
                              initialOpacityByLayerId
                            ),
                          false
                        );
                      }}
                      onCreateDialogue={handleCreateDialogue}
                      onDialogueText={(dialogueId, text) =>
                        updateProject((currentProject) =>
                          updateDialogueText(currentProject, dialogueId, text)
                        )
                      }
                      onDialogueBlur={(dialogue) => {
                        if (!dialogue.text.trim()) {
                          updateProject((currentProject) =>
                            removeDialogue(currentProject, dialogue.id)
                          );
                        }
                        setEditingDialogueId(undefined);
                      }}
                      onScriptText={(shotId, scriptText) => handleShotScriptText(shotId, scriptText)}
                      onSketchStroke={(layerId, stroke, renderedDataUrl, pendingStrokes) =>
                        handleBitmapStroke(shot, layerId, stroke, renderedDataUrl, pendingStrokes)
                      }
                      onSelectionTransform={(layerId, dataUrl) =>
                        handleBitmapSelectionTransform(shot, layerId, dataUrl)
                      }
                      onFill={(layerId, point, color) =>
                        handleBitmapFill(shot, layerId, point, color)
                      }
                      onSketchBeginInteraction={closeRadialToolMenu}
                    />
                  );
                })}
                {showStoryboardInsertionIndicator && storyboardInsertionIndicator ? (
                  <div
                    className="storyboard-insertion-indicator"
                    aria-hidden="true"
                    style={{
                      left: storyboardInsertionIndicator.left,
                      top: storyboardInsertionIndicator.top,
                      height: storyboardInsertionIndicator.height
                    }}
                  />
                ) : null}
                <SelectionMarquee ref={selectionMarqueeRef} />
              </section>
            </SortableContext>
          </div>
          <SortableContext items={parkedShots.map((shot) => `parked-${shot.id}`)} strategy={rectSortingStrategy}>
            <ParkingShelf
              shots={parkedShots}
              isOpen={isParkingShelfOpen}
              insertionIndicator={activeShotIds.length > 0 ? parkingInsertionIndicator : undefined}
              listRef={parkingListRef}
            />
          </SortableContext>

          <DragOverlay>
            {activeDialogue ? <DialoguePreview dialogue={activeDialogue} /> : null}
            {!activeDialogue && dragPreviewShotIds.length > 0 ? (
              <ShotStackPreview
                shots={dragPreviewShotIds
                  .map((shotId) => shotById.get(shotId))
                  .filter((shot): shot is Shot => Boolean(shot))}
                folderPath={folderPath}
                variant="thumbnail"
              />
            ) : null}
            {!activeDialogue && dragPreviewShotIds.length === 0 && activeParkedShotIds.length > 0 ? (
              <ShotStackPreview
                shots={parkedShots.filter((shot) => activeParkedShotIds.includes(shot.id))}
                folderPath={folderPath}
                variant="thumbnail"
              />
            ) : null}
          </DragOverlay>
        </DndContext>
        {isImportLocked ? (
          <button
            type="button"
            className="workspace-import-lock"
            onClick={nudgeImportRequired}
            aria-label="Import external changes before editing"
          >
            <span>Import external changes before editing</span>
          </button>
        ) : null}
      </div>

      {folderPath ? (
        <AiDraftPanel
          isOpen={isAiPanelVisible}
          folderPath={folderPath}
          project={project}
          selectedShotIds={selectedShotIds}
          onProjectChange={handleAiProjectChange}
        />
      ) : null}

      {isAnimationMode && orderedShots.length > 0 ? (
        <Timeline
          shots={orderedShots}
          selectedShotIds={selectedShotIds}
          onSelect={(shotId) => {
            selectSingleShot(shotId);
            setDeleteTarget({ type: "shot" });
            setSelectedBitmapLayerIds(undefined);
          }}
        />
      ) : null}

      {orderedShots.length === 0 ? (
        <section className="empty-state">
          <h2>Paste a folder path to start arranging the board.</h2>
          <p>V1 keeps the workflow narrow: order shots, move dialogue, and draw rough notes.</p>
        </section>
      ) : null}
      <div className="status-popover">
        {autosaveError ? (
          <div className="autosave-error-notice" role="alert">
            <span>{autosaveError.message}</span>
            <button
              type="button"
              aria-label="Dismiss autosave error"
              onClick={() =>
                setAutosaveError((current) => autosaveErrorReducer(current, { type: "dismissed" }))
              }
            >
              x
            </button>
          </div>
        ) : null}
        {isStatusPanelOpen ? (
          <div className="status-panel" aria-label="Workspace status">
            <span>{status}</span>
            {updateNotice.status === "available" ? (
              <div className="update-notice" role="status">
                <span>Storyboard Flow {updateNotice.update.version} is available.</span>
                {updateNotice.update.notes ? <small>{updateNotice.update.notes}</small> : null}
                <button type="button" onClick={() => openUpdateDownload(updateNotice.update)}>
                  Download
                </button>
                <button type="button" onClick={() => setUpdateNotice({ status: "dismissed" })}>
                  Later
                </button>
              </div>
            ) : null}
            <span>{project.shots.length} shots</span>
            <span>{parkedShots.length} pending</span>
            <span>Workspace {workspaceSaveState}</span>
            <span>File names {fileNameSyncState}</span>
            <span>{swbStatusLabel({ needsSwbImport, hasSwbWarning })}</span>
            <button type="button" className="status-panel-action" onClick={() => void checkForUpdates(true)}>
              {updateCheckButtonLabel(updateNotice.status)}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={statusPanelToggleClassName({
            workspaceSaveState,
            fileNameSyncState,
            hasSwbWarning,
            updateNoticeStatus: updateNotice.status
          })}
          aria-label="Workspace status"
          aria-expanded={isStatusPanelOpen}
          onClick={() => setIsStatusPanelOpen((isOpen) => !isOpen)}
          title="Workspace status"
        >
          i
        </button>
      </div>
      <footer className="bottom-bar">
        <label>
          Zoom
          <input
            ref={zoomInputRef}
            type="range"
            min="25"
            max={maxStoryboardZoom}
            step="5"
            defaultValue={zoomLevel}
            onPointerDown={beginZoomScrubbing}
            onPointerUp={endZoomScrubbing}
            onLostPointerCapture={endZoomScrubbing}
            onBlur={endZoomScrubbing}
            onChange={(event) => {
              const nextZoom = Number(event.target.value);
              if (isZoomScrubbingRef.current) {
                scheduleZoomPreviewLevel(nextZoom);
              } else {
                scheduleZoomLevel(nextZoom);
              }
            }}
          />
        </label>
        <span ref={zoomValueLabelRef}>{zoomLevel}%</span>
        {isAnimationMode ? (
          <label className="onion-skin-toggle">
            <input
              type="checkbox"
              checked={isOnionSkinEnabled}
              onChange={(event) => setIsOnionSkinEnabled(event.target.checked)}
            />
            Onion Skin
          </label>
        ) : null}
        <span ref={selectedShotCountLabelRef}>{selectedShotIds.length} selected</span>
      </footer>
    </main>
  );
};

const storyboardMarqueeShotRectsFromDom = (
  board: HTMLElement | null,
  scroll: { x: number; y: number } = { x: window.scrollX, y: window.scrollY }
): MarqueeShotRect[] => {
  if (!board) {
    return [];
  }

  return Array.from(board.querySelectorAll<HTMLElement>("[data-shot-id]"))
    .map((element) => {
      const shotId = element.dataset.shotId;
      if (!shotId) {
        return undefined;
      }

      const rect = element.getBoundingClientRect();
      return {
        shotId,
        rect: {
          left: rect.left + scroll.x,
          right: rect.right + scroll.x,
          top: rect.top + scroll.y,
          bottom: rect.bottom + scroll.y
        }
      };
    })
    .filter((shotRect): shotRect is MarqueeShotRect => Boolean(shotRect));
};

const storyboardMarqueeShotElementsFromDom = (board: HTMLElement | null): Map<string, HTMLElement> => {
  if (!board) {
    return new Map();
  }

  return Array.from(board.querySelectorAll<HTMLElement>("[data-shot-id]")).reduce(
    (elements, element) => {
      const shotId = element.dataset.shotId;
      if (shotId) {
        elements.set(shotId, element);
      }
      return elements;
    },
    new Map<string, HTMLElement>()
  );
};

const applyMarqueeShotSelection = (
  elements: ReadonlyMap<string, HTMLElement>,
  previousShotIds: string[],
  nextShotIds: string[]
) => {
  const changes = marqueeSelectionClassChanges(previousShotIds, nextShotIds);

  changes.remove.forEach((shotId) => {
    elements.get(shotId)?.classList.remove("is-marquee-selected");
  });
  changes.add.forEach((shotId) => {
    elements.get(shotId)?.classList.add("is-marquee-selected");
  });
};

const clearCommittedMarqueeShotSelection = (
  elements: ReadonlyMap<string, HTMLElement>,
  selectedShotIds: string[]
) => {
  marqueeDisplayedSelectionIds(selectedShotIds).forEach((shotId) => {
    elements.get(shotId)?.classList.remove("is-selected");
  });
};

const applySelectedShotCountLabel = (element: HTMLSpanElement | null, selectedCount: number) => {
  if (element) {
    element.textContent = `${selectedCount} selected`;
  }
};

const applySelectionMarqueeStyle = (element: HTMLDivElement | null, box: MarqueeBox) => {
  if (!element) {
    return;
  }

  const rect = marqueeViewportRect(box);
  element.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
};

const showSelectionMarquee = (element: HTMLDivElement | null, box: MarqueeBox) => {
  if (!element) {
    return;
  }

  applySelectionMarqueeStyle(element, box);
  element.classList.add("is-active");
};

const hideSelectionMarquee = (element: HTMLDivElement | null) => {
  if (!element) {
    return;
  }

  element.classList.remove("is-active");
  element.style.removeProperty("transform");
  element.style.removeProperty("width");
  element.style.removeProperty("height");
};

const isPointerInsideElement = (element: HTMLElement | null, pointer: { x: number; y: number }): boolean => {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return isPointerInsideRect(rect, pointer);
};

const inferDropPlacementFromDragEnd = (event: DragEndEvent): ShotPlacement => {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const overRect = event.over?.rect;

  if (!activeRect || !overRect) {
    return "after";
  }

  const activeCenterY = activeRect.top + activeRect.height / 2;
  const overCenterY = overRect.top + overRect.height / 2;
  return activeCenterY > overCenterY ? "after" : "before";
};

const pasteAnimationTransition = "transform 190ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const pasteAnimationCleanupMs = 240;

const pasteAnimationSelector = (kind: PasteAnimationKind): string =>
  kind === "shot" ? "[data-shot-id]" : "[data-layer-id]";

const pasteAnimationIdForElement = (element: HTMLElement, kind: PasteAnimationKind): string | undefined =>
  kind === "shot" ? element.dataset.shotId : element.dataset.layerId;

const measurePasteAnimationRects = (kind: PasteAnimationKind): Map<string, DOMRect> => {
  const rects = new Map<string, DOMRect>();
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(pasteAnimationSelector(kind)))) {
    const id = pasteAnimationIdForElement(element, kind);
    if (id) {
      rects.set(id, element.getBoundingClientRect());
    }
  }
  return rects;
};

const resetPasteAnimationStyles = () => {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-shot-id], [data-layer-id]"))) {
    element.style.removeProperty("transform");
    element.style.removeProperty("transition");
    element.style.removeProperty("will-change");
  }
};

const clearPasteAnimation = (
  frameRef: { current: number | undefined },
  timeoutRef: { current: number | undefined }
) => {
  if (frameRef.current !== undefined) {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
  }

  if (timeoutRef.current !== undefined) {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  }

  resetPasteAnimationStyles();
};

const applyPasteAnimation = (
  animation: PasteAnimationState,
  frameRef: { current: number | undefined },
  timeoutRef: { current: number | undefined }
) => {
  clearPasteAnimation(frameRef, timeoutRef);

  const sourceRect = animation.beforeRects.get(animation.sourceId);
  const movedElements: HTMLElement[] = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(pasteAnimationSelector(animation.kind)))) {
    const id = pasteAnimationIdForElement(element, animation.kind);
    const fromRect =
      id === animation.pastedId && sourceRect ? sourceRect : id ? animation.beforeRects.get(id) : undefined;
    if (!fromRect) {
      continue;
    }

    const afterRect = element.getBoundingClientRect();
    const deltaX = fromRect.left - afterRect.left;
    const deltaY = fromRect.top - afterRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      continue;
    }

    element.style.transition = "none";
    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    element.style.willChange = "transform";
    movedElements.push(element);
  }

  if (movedElements.length === 0) {
    return;
  }

  frameRef.current = window.requestAnimationFrame(() => {
    frameRef.current = undefined;
    for (const element of movedElements) {
      element.style.transition = pasteAnimationTransition;
      element.style.transform = "";
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = undefined;
      for (const element of movedElements) {
        element.style.removeProperty("transform");
        element.style.removeProperty("transition");
        element.style.removeProperty("will-change");
      }
    }, pasteAnimationCleanupMs);
  });
};

const dragEndInsideSelector = (
  event: DragEndEvent,
  selector: string,
  pointerPosition?: { x: number; y: number }
): boolean => {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const target = document.querySelector<HTMLElement>(selector);
  if ((!activeRect && !pointerPosition) || !target) {
    return false;
  }

  const targetRect = target.getBoundingClientRect();
  if (pointerPosition) {
    const pointedElement = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
    if (pointedElement instanceof HTMLElement && pointedElement.closest(selector)) {
      return true;
    }
  }

  if (
    activeRect &&
    activeRect.right >= targetRect.left &&
    activeRect.left <= targetRect.right &&
    activeRect.bottom >= targetRect.top &&
    activeRect.top <= targetRect.bottom
  ) {
    return true;
  }

  const point = pointerPosition ?? {
    x: activeRect!.left + activeRect!.width / 2,
    y: activeRect!.top + activeRect!.height / 2
  };
  return (
    point.x >= targetRect.left &&
    point.x <= targetRect.right &&
    point.y >= targetRect.top &&
    point.y <= targetRect.bottom
  );
};

const withStatus = async <T,>(
  label: string,
  action: () => Promise<T>,
  setStatus: (status: string) => void
): Promise<T | undefined> => {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`${label}: ${message}`);
    return undefined;
  }
};

const createTransparentLayerDataUrl = async (width: number, height: number): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas.toDataURL("image/png");
};

const drawStrokeOnBitmapLayer = async (
  sourceUrl: string,
  layer: BitmapLayer,
  stroke: SketchStroke,
  pendingStrokes: SketchStroke[] = []
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  await drawImageUrl(context, sourceUrl, canvas.width, canvas.height);

  for (const pendingStroke of [...pendingStrokes, stroke]) {
    if (shouldDrawStrokeToBitmapLayer(pendingStroke)) {
      drawStrokePathOnCanvas(context, pendingStroke);
    }
  }

  return canvas.toDataURL("image/png");
};

const fillBitmapLayerAtPoint = async (
  sourceUrl: string,
  layer: BitmapLayer,
  point: { x: number; y: number },
  color: string
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  await drawImageUrl(context, sourceUrl, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  fillImageDataAtPoint(imageData, point, hexToRgba(color));
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

const aspectRatioForShot = (shot: Shot): number => {
  const canvasSize = canvasSizeForShot(shot);
  return canvasSize.width / canvasSize.height;
};
