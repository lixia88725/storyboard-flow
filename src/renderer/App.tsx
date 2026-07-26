import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import {
  applyRenamePlan,
  createProject,
  createRenamePlan,
  defaultProjectNaming,
  defaultSaveNaming,
  bitmapLayersForShot,
  dialogueOverlayBitmapLayerId,
  imageBitmapLayerId,
  matteForShot,
  matteOverlayBitmapLayerId,
  mergeExternalImageChanges,
  mergeFolderImages,
  projectAcceptedExternalEdits,
  projectHasSwbWarning,
  projectNeedsSwbImport,
  sceneDialogueOverlayEnabledForProject,
  sceneMatteModeForProject,
  sortedShots,
  type ShotPlacement,
} from "../shared/projectOps";
import type {
  BitmapLayer,
  Dialogue,
  FolderScanPayload,
  Project,
  Shot,
  BlankShotPreset,
} from "../shared/types";
import { maxStoryboardZoom } from "./animationViewport";
import {
  primaryShotFromSelection,
  primaryShotOrFirst
} from "./activeTargets";
import { autosaveErrorReducer, type AutosaveErrorNotice } from "./autosaveError";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { ClipboardSelection } from "./clipboardSelection";
import { useClipboardActionController } from "./clipboardActionController";
import { DialoguePreview, ShotStackPreview } from "./DragPreviews";
import { nextEditableDialogueTextProject } from "./editableDialogueText";
import type { DeleteTarget } from "./deleteTarget";
import { useDeleteActionController } from "./deleteActionController";
import { useDialogueActionController } from "./dialogueActionController";
import { createDirtyShotTracker } from "./dirtyShotTracker";
import { blurActiveFormControl } from "./formFocus";
import { isKeyboardEditableTarget } from "./keyboardShortcuts";
import { getOnionSkinNeighbors } from "./onionSkin";
import { ensureProjectBitmapMetadata } from "./projectBitmapMetadata";
import { useProjectHistoryController } from "./projectHistoryController";
import { markdownPathFromDroppedFiles } from "./markdownDrop";
import { SelectionMarquee } from "./SelectionMarquee";
import { ParkingShelf } from "./ParkingShelf";
import { AiDraftPanel } from "./ai/AiDraftPanel";
import { applyAiProjectChange } from "./ai/aiProjectChangeController";
import { useBoardViewState } from "./boardViewState";
import { useStoryboardZoomController } from "./storyboardZoomController";
import { RadialToolMenu } from "./RadialToolMenu";
import { ShotCard } from "./ShotCard";
import { StatusPopover } from "./StatusPopover";
import { Timeline } from "./Timeline";
import { ToolRail } from "./ToolRail";
import { Topbar } from "./Topbar";
import { JapaneseStoryboardView } from "./JapaneseStoryboardView";
import { IMPORT_REQUIRED_HELP } from "./importRequiredHelp";
import { formatSaveFailureStatus } from "./saveErrors";
import { useStoryboardMarqueeController } from "./storyboardMarqueeController";
import { measureStoryboardGridColumnsFromDom } from "./storyboardGridMeasurement";
import {
  createTransparentLayerDataUrl,
  type BitmapBlurPoint
} from "./bitmapLayerCanvas";
import {
  shouldShowStoryboardInsertionIndicator,
  storyboardSortableItemIds as realStoryboardSortableItemIds,
  type DragData
} from "./storyboardDnd";
import { useStoryboardInsertionController, type StoryboardInsertionLayout } from "./storyboardInsertionController";
import { dragEndInsideSelector } from "./dragHitTesting";
import { sameLayerSelection, useStoryboardInteractionState } from "./storyboardInteractionState";
import { hasOpenShortcutBlockingMenu } from "./shortcutMenuController";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { useBitmapLayerPaintingController } from "./bitmapLayerPaintingController";
import { useWorkspaceLifecycleState } from "./workspaceLifecycleState";
import { useUpdateNoticeController } from "./updateNoticeController";
import { useAnimationModeLayoutController } from "./animationModeLayoutController";
import { usePasteAnimationController } from "./pasteAnimationController";
import {
  hasOnlyCompatibleExternalEdits,
  hasUnsavedWorkspaceChanges,
  projectChangedDuringLoad,
  runExclusiveWorkspaceAction,
  shouldAutosaveAfterLoad,
  shouldEmphasizeSaveButton,
  shouldPersistLoadedProject
} from "./workspacePersistenceController";
import { useRadialToolMenuController } from "./radialToolMenuController";
import { useSketchToolSettingsController } from "./sketchToolSettingsController";
import type { RadialPresetSlot } from "./toolRadialMenu";
import { usePointerPositionController } from "./pointerPositionController";
import { useRecentFoldersController } from "./recentFoldersController";
import { useToolRadialSettingsController } from "./toolRadialSettingsController";
import { useWorkspaceTaskProgressController } from "./workspaceTaskProgressController";
import { useWorkspaceCloseGuardController } from "./workspaceCloseGuardController";
import {
  refreshWorkspaceExternalImportState,
  useWorkspaceExternalRefreshController
} from "./workspaceExternalRefreshController";
import { useWorkspaceMenuController } from "./workspaceMenuController";
import { persistWorkspaceProject, useWorkspaceAutosaveController } from "./workspaceAutosaveController";
import { useAppKeyboardShortcutsController } from "./appKeyboardShortcutsController";
import { useLayerPanelController } from "./layerPanelController";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import { useRightSidebarController } from "./rightSidebarController";
import { useStoryboardDragSessionController } from "./storyboardDragSessionController";
import { useStoryboardDragEndController } from "./storyboardDragEndController";
import { createShotSelectionController } from "./shotSelectionController";
import { useAddShotController } from "./addShotController";
import { visibleBoardViewMode, type BoardViewMode } from "./boardViewMode";
import { useBoardPanController } from "./boardPanController";
import { useZDragZoomController } from "./zDragZoomController";
import { useProjectEditController } from "./projectEditController";
import { withStatus } from "./statusAction";
import { createCurrentLayerActionController } from "./currentLayerActionController";
import { createShotPresentationController } from "./shotPresentationController";
import {
  SaveErrorModal,
  StoryboardScriptImportModal,
  WorkspaceTaskProgressBanner,
  type StoryboardScriptImportDraft
} from "./WorkspaceOverlays";

const minSketchSoftness = 0;
const maxSketchSoftness = 1;
const maxUndoHistory = 60;

type ProjectUpdate = Project | ((currentProject: Project) => Project);
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
    addShotMenuRef,
    importHelpRef,
    isAddShotMenuOpen,
    isImportHelpOpen,
    isMatteMenuOpen,
    isRecentMenuOpen,
    isSaveMenuOpen,
    matteMenuRef,
    recentMenuRef,
    saveMenuRef,
    setIsAddShotMenuOpen,
    setIsImportHelpOpen,
    setIsMatteMenuOpen,
    setIsRecentMenuOpen,
    setIsSaveMenuOpen
  } = useWorkspaceMenuController();
  const [blankShotPreset, setBlankShotPreset] = useState<BlankShotPreset>("16:9");
  const [isImportNudging, setIsImportNudging] = useState(false);
  const [boardViewMode, setBoardViewMode] = useState<BoardViewMode>("storyboard");
  const [isSpacePanActive, setIsSpacePanActive] = useState(false);
  const [isBoardPanning, setIsBoardPanning] = useState(false);
  const isSpacePanActiveRef = useRef(false);
  const zZoomActiveRef = useRef(false);
  const currentBoardViewMode = visibleBoardViewMode({ boardViewMode, isAnimationMode });
  const isStoryboardBoardMode = currentBoardViewMode !== "japaneseStoryboard";
  const [scriptImportNeeded, setScriptImportNeeded] = useState(false);
  const [autosaveError, setAutosaveError] = useState<AutosaveErrorNotice | undefined>();
  const [saveErrorDialog, setSaveErrorDialog] = useState<string | undefined>();
  const [storyboardScriptImportDraft, setStoryboardScriptImportDraft] =
    useState<StoryboardScriptImportDraft | undefined>();
  const [clipboardSelection, setClipboardSelection] = useState<ClipboardSelection | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const {
    appShellClassName,
    isAiPanelVisible,
    isParkingShelfOpen,
    openPendingShelf,
    toggleAiPanel: handleToggleAiPanel,
    togglePendingShelf: handleTogglePendingShelf
  } = useRightSidebarController({
    folderPath,
    isAnimationMode,
    setStatus
  });
  const {
    toolRadialMenuConfig,
    persistToolRadialMenuConfig
  } = useToolRadialSettingsController({ setStatus });
  const {
    updateNotice,
    setUpdateNotice,
    checkForUpdates,
    openUpdateDownload
  } = useUpdateNoticeController({ setStatus });
  const selectionMarqueeRef = useRef<HTMLDivElement | null>(null);
  const scriptImportCheckIdRef = useRef(0);
  const dirtyShotIdsRef = useRef<Set<string>>(new Set());
  const clipboardSelectionRef = useRef<ClipboardSelection | undefined>(undefined);
  const selectedShotCountLabelRef = useRef<HTMLSpanElement | null>(null);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const parkingListRef = useRef<HTMLDivElement | null>(null);
  const storyboardInsertionLayoutRef = useRef<StoryboardInsertionLayout>("grid");
  const storyboardInsertionBlockedRef = useRef(false);
  const bitmapLayerWriteQueueRef = useRef(createBitmapLayerWriteQueue());
  const saveInFlightRef = useRef<Promise<boolean> | undefined>(undefined);
  const shotPresentationActionRef = useRef<Promise<void | boolean> | undefined>(undefined);
  const workspaceRecoveryRequiredRef = useRef<string | undefined>(undefined);
  const sceneMatteInheritanceRef = useRef<
    | ((
        baseProject: Project,
        mode: "expanded" | "embedded" | undefined,
        shotIds: readonly string[],
        options?: {
          dialogueOverlayEnabled?: boolean;
          expectedProject?: Project;
          markFileNamesUnsynced?: boolean;
          recordUndo?: boolean;
        }
      ) => Promise<boolean>)
    | undefined
  >(undefined);
  const bitmapBlurSelectionsRef = useRef(
    new Map<string, { layerId: string; points: BitmapBlurPoint[] }>()
  );
  storyboardInsertionLayoutRef.current = isStoryboardBoardMode ? "grid" : "list";
  storyboardInsertionBlockedRef.current = isStoryboardBoardMode && isAnimationMode;
  const isSaveEmphasized = shouldEmphasizeSaveButton(
    dirtyShotIdsRef.current.size,
    workspaceSaveState,
    fileNameSyncState
  );
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
  const japaneseStoryboardSortableItemIds = useMemo(
    () => realStoryboardSortableItemIds(orderedShots.map((shot) => shot.id)),
    [orderedShots]
  );
  const onionSkinNeighbors = useMemo(
    () => getOnionSkinNeighbors(orderedShots, primarySelectedShotId, isAnimationMode && isOnionSkinEnabled),
    [isAnimationMode, isOnionSkinEnabled, orderedShots, primarySelectedShotId]
  );
  const {
    activeSketchTool,
    adjustRadialToolValue,
    applyRadialPreset,
    blurRadius,
    brushColor,
    brushOpacity,
    brushSize,
    brushSoftness,
    currentSketchToolSettings,
    eraserOpacity,
    eraserSize,
    eraserSoftness,
    setActiveSketchTool,
    setBlurRadius,
    setBrushColor,
    setBrushOpacity,
    setBrushSize,
    setEraserOpacity,
    setEraserSize,
    updateRadialSlot,
    updateRadialSlots
  } = useSketchToolSettingsController({
    persistToolRadialMenuConfig,
    toolRadialMenuConfig
  });
  const {
    radialToolMenu,
    closeRadialToolMenu,
    openSketchCanvasContextMenu
  } = useRadialToolMenuController({
    activeSketchTool,
    needsSwbImport,
    setStatus
  });
  const applyRadialPresetAndClose = useCallback(
    (slot: RadialPresetSlot) => {
      applyRadialPreset(slot);
      closeRadialToolMenu();
    },
    [applyRadialPreset, closeRadialToolMenu]
  );

  const { queueAnimation: queuePasteAnimation } = usePasteAnimationController(project);

  const {
    beginZoomScrubbing,
    boardGridRef,
    boardZoomStyle,
    currentBoardScroll,
    endZoomScrubbing,
    handleStoryboardZoomShortcut,
    handleZoomInputChange,
    scrollBoardBy,
    workspaceBoardScrollRef,
    zoomInputRef,
    zoomValueLabelRef
  } = useStoryboardZoomController({
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
  });
  const { handleBoardPanPointerDownCapture } = useBoardPanController({
    isSpacePanActiveRef,
    scrollBoardBy,
    setIsBoardPanning,
    workspaceBoardScrollRef
  });
  const { handleZDragZoomPointerDownCapture } = useZDragZoomController({
    beginZoomScrubbing,
    endZoomScrubbing,
    handleZoomInputChange,
    zZoomActiveRef,
    zoomLevelRef
  });
  const handleBoardNavigationPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (handleZDragZoomPointerDownCapture(event)) {
        return;
      }

      handleBoardPanPointerDownCapture(event);
    },
    [handleBoardPanPointerDownCapture, handleZDragZoomPointerDownCapture]
  );
  const {
    flushInsertionTargetsFromDragEnd,
    queueInsertionTargetsFromDrag,
    resetInsertionDragState
  } = useStoryboardInsertionController({
    boardGridRef,
    currentBoardScroll,
    isAnimationModeRef: storyboardInsertionBlockedRef,
    lastPointerPositionRef,
    parkingListRef,
    selectedShotIdsRef,
    storyboardInsertionLayoutRef,
    setParkingInsertionIndicator,
    setStoryboardInsertionIndicator
  });

  useEffect(() => {
    clipboardSelectionRef.current = clipboardSelection;
  }, [clipboardSelection]);

  const {
    clearSelectedShots,
    handleShotSelect,
    selectSingleShot,
    selectShotsByIds
  } = createShotSelectionController({
    blurActiveFormControl,
    isEditableTarget: isKeyboardEditableTarget,
    orderedShotIds: orderedShots.map((shot) => shot.id),
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
    setDeleteTarget,
    setSelectedBitmapLayerIds,
    setSelectedShotIds
  });

  const { handleSelectionPointerDown } = useStoryboardMarqueeController({
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
  });

  const { layerPanelPropsForShot } = useLayerPanelController({
    primarySelectedShotId, selectSingleShot, setDeleteTarget, setSelectedBitmapLayerIds
  });

  const handleSelectedBitmapLayerIdsChange = useCallback((shotId: string, layerIds: string[]) => {
    setSelectedBitmapLayerIds((current) =>
      sameLayerSelection(current, shotId, layerIds) ? current : { shotId, layerIds }
    );
  }, []);

  const handleBitmapSelectionChange = useCallback(
    (
      shotId: string,
      layerId: string | undefined,
      points: BitmapBlurPoint[] | undefined
    ) => {
      if (!layerId || !points || points.length < 3) {
        bitmapBlurSelectionsRef.current.delete(shotId);
        return;
      }

      bitmapBlurSelectionsRef.current.set(shotId, {
        layerId,
        points: points.map((point) => ({ ...point }))
      });
    },
    []
  );

  usePointerPositionController(lastPointerPositionRef);
  useWorkspaceTaskProgressController(setWorkspaceTask);

  useWorkspaceCloseGuardController({
    dirtyShotIdsRef,
    fileNameSyncState,
    refreshKey: project,
    workspaceSaveState
  });
  const {
    dirtyShotIds,
    markAllShotsDirty,
    markShotsDirty,
    resetDirtyShots: resetTrackedDirtyShots
  } = createDirtyShotTracker({ dirtyShotIdsRef, projectRef });
  const {
    applyRedoEntry,
    applyUndoEntry,
    createHistoryEntry,
    recordProjectUndoEntry,
    recordUndoEntry,
    resetHistoryStacks
  } = useProjectHistoryController({
    api: window.storyboard,
    bitmapLayerWriteQueueRef,
    fileNameSyncStateRef,
    folderPathRef,
    markAllShotsDirty,
    maxEntries: maxUndoHistory,
    projectRef,
    scriptImportCheckIdRef,
    selectShotsByIds,
    selectedShotIdsRef,
    setAutosaveRevision,
    setFileNameSyncState,
    setProject,
    setScriptImportNeeded,
    setStatus,
    setWorkspaceSaveState
  });

  const measureGridColumns = useCallback(measureStoryboardGridColumnsFromDom, []);

  useAnimationModeLayoutController({
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
  });

  const updateProject = (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced = true,
    recordUndo = true
  ) => {
    const nextProject =
      typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;

    if (recordUndo) {
      recordProjectUndoEntry();
    }
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

  const {
    handleMoveLayer,
    handleMoveLayerGroup,
    handleSelectLayer,
    handleUpdateLayer,
    handleUpdateLayerGroupOpacity
  } = useLayerMetadataActionController({
    markShotsDirty,
    setDeleteTarget,
    shotSelectionAnchorIdRef,
    updateProject
  });

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

  const { handleDeleteKeyPress } = useDeleteActionController({
    deleteTarget,
    handleRemoveBitmapLayer,
    projectRef,
    selectedShotIdsRef,
    selectSingleShot,
    setDeleteTarget,
    setStatus,
    updateProject
  });

  const {
    handleBitmapBlur,
    handleBitmapFill,
    handleBitmapSelectionTransform,
    handleBitmapStroke
  } = useBitmapLayerPaintingController({
    api: window.storyboard,
    projectRef,
    folderPath,
    bitmapLayerWriteQueueRef,
    createHistoryEntry,
    recordUndoEntry,
    markShotsDirty,
    updateProject
  });

  const {
    handleShotScriptText,
    updateProjectName,
    updateProjectNaming
  } = useProjectEditController({
    project,
    updateProject
  });
  const handleShotDialogueText = (shotId: string, dialogueText: string) => {
    updateProject((currentProject) =>
      nextEditableDialogueTextProject(currentProject, shotId, dialogueText)
    );
  };

  const persistWorkspaceWithoutAssetLock = async (
    projectToSave: Project,
    activeFolderPath = folderPath,
    activeMetadataPath = metadataPath
  ) =>
    persistWorkspaceProject({
      activeFolderPath,
      activeMetadataPath,
      api: window.storyboard,
      projectToSave,
      scriptImportCheckIdRef,
      setAutosaveError,
      setScriptImportNeeded,
      setWorkspaceSaveState
    });

  const persistWorkspace = async (
    projectToSave: Project,
    activeFolderPath = folderPath,
    activeMetadataPath = metadataPath
  ) =>
    bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      if (workspaceRecoveryRequiredRef.current) {
        throw new Error(workspaceRecoveryRequiredRef.current);
      }
      if (
        projectRef.current !== projectToSave ||
        folderPathRef.current !== activeFolderPath ||
        metadataPathRef.current !== activeMetadataPath
      ) {
        return;
      }
      await persistWorkspaceWithoutAssetLock(
        projectToSave,
        activeFolderPath,
        activeMetadataPath
      );
    });

  useWorkspaceAutosaveController({
    autosaveRevision,
    folderPathRef,
    metadataPathRef,
    persistWorkspace,
    projectRef,
    setAutosaveError,
    setStatus,
    setWorkspaceSaveState
  });

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
    await refreshWorkspaceExternalImportState({
      api: window.storyboard,
      blankShotPreset,
      checkIdRef: scriptImportCheckIdRef,
      dirtyShotIds,
      folderPathRef,
      hasOnlyCompatibleExternalEdits,
      loadFolderScan,
      metadataPathRef,
      mergeExternalImageChanges,
      persistResolvedExternalProject: (nextProject, nextFolderPath, nextMetadataPath) => {
        void persistWorkspace(nextProject, nextFolderPath, nextMetadataPath).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setWorkspaceSaveState("error");
          setAutosaveError((current) => autosaveErrorReducer(current, { type: "failed", message }));
          setStatus(`Autosave failed: ${message}`);
        });
      },
      projectNeedsSwbImport,
      projectRef,
      runWithStatus: (label, action) => withStatus(label, action, setStatus),
      setProject: (nextProject) => {
        projectRef.current = nextProject;
        setProject(nextProject);
      },
      setScriptImportNeeded,
      workspaceSaveStateRef
    });
  };

  useWorkspaceExternalRefreshController({
    folderPath,
    focusRefreshKey: metadataPath,
    refreshExternalImportState
  });

  const nudgeImportRequired = () => {
    setIsImportHelpOpen(true);
    setIsImportNudging(true);
    setStatus("Import external changes before editing");
    window.setTimeout(() => setIsImportNudging(false), 520);
  };

  const loadFolderScan = async (
    scan: FolderScanPayload,
    nextStatus: string,
    dirty = false,
    resetDirtyShots = true,
    clearRecoveryRequired = false
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
            dirtyShotIds: dirtyShotIds(),
            preserveDirtyShotLayers: true
          }),
        setStatus
      );
      if (imported) {
        return loadFolderScan(
          imported,
          "Imported external Photoshop edits",
          false,
          true,
          clearRecoveryRequired
        );
      }
    }
    const acceptedExternalEdits = projectAcceptedExternalEdits(nextProject);
    const loadedProjectChanged = projectChangedDuringLoad(projectWithDefaults, nextProject);
    let nextScriptImportNeeded = Boolean(scan.scriptImportNeeded);

    projectRef.current = nextProject;
    if (clearRecoveryRequired) {
      workspaceRecoveryRequiredRef.current = undefined;
    }
    folderPathRef.current = scan.folderPath;
    metadataPathRef.current = scan.metadataPath;
    setProject(nextProject);
    setFolderPath(scan.folderPath);
    setFolderInputValue(scan.folderPath);
    setMetadataPath(scan.metadataPath);
    setWorkspaceSaveState(dirty || acceptedExternalEdits || loadedProjectChanged ? "saving" : "saved");
    setFileNameSyncState("synced");
    setStatus(acceptedExternalEdits ? "External TIFF edits accepted as new base" : nextStatus);
    resetHistoryStacks();
    selectSingleShot(nextProject.shots[0]?.id);
    if (resetDirtyShots) {
      resetTrackedDirtyShots();
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

    await loadFolderScan(result, "Folder opened", !result.project, true, true);
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

  useRecentFoldersController({
    openFolder: handleOpenFolderByPath,
    setFolderInputValue,
    setRecentFolders,
    setStatus
  });

  const handleStoryboardScriptDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleStoryboardScriptDrop = async (event: ReactDragEvent<HTMLElement>) => {
    const sourceMarkdownPath = markdownPathFromDroppedFiles(
      event.dataTransfer.files,
      window.storyboard?.filePathForDroppedFile
    );
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
    await loadFolderScan(
      result,
      "Created storyboard from script",
      false,
      true,
      true
    );
    void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);
  };

  const handleSaveProject = async (): Promise<boolean> => {
    if (saveInFlightRef.current) {
      return saveInFlightRef.current;
    }

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

    if (workspaceRecoveryRequiredRef.current) {
      const message = workspaceRecoveryRequiredRef.current;
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

    return runExclusiveWorkspaceAction(saveInFlightRef, () =>
      bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        setWorkspaceTask({
          kind: "save",
          label: "Preparing save...",
          current: 0,
          total: 0
        });

        try {
          if (workspaceRecoveryRequiredRef.current) {
            throw new Error(workspaceRecoveryRequiredRef.current);
          }
          if (projectRef.current !== project) {
            throw new Error(
              "The storyboard changed while Save was waiting; run Save again to include the latest edits"
            );
          }
          await persistWorkspaceWithoutAssetLock(projectToSave);
          const renamePlan = createRenamePlan(projectToSave, {
            allowDefaultNamingFields: missingNamingFields.length > 0
          });
          const renamedProject = applyRenamePlan(projectToSave, renamePlan);
          const result = await window.storyboard.saveWorkspace({
            project: { ...renamedProject, updatedAt: new Date().toISOString() },
            folderPath,
            metadataPath,
            renamePlan,
            dirtyShotIds: dirtyShotIds()
          });

          projectRef.current = result.project;
          folderPathRef.current = result.folderPath;
          metadataPathRef.current = result.metadataPath;
          setProject(result.project);
          setFolderPath(result.folderPath);
          setFolderInputValue(result.folderPath);
          setMetadataPath(result.metadataPath);
          setWorkspaceSaveState("saved");
          setFileNameSyncState("synced");
          resetTrackedDirtyShots();
          workspaceSaveStateRef.current = "saved";
          fileNameSyncStateRef.current = "synced";
          resetHistoryStacks();
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
      })
    );
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

  const { handleAddShot } = useAddShotController({
    api: window.storyboard,
    blankShotPreset,
    createTransparentLayerDataUrl,
    folderPath,
    inheritSceneMatte: (baseProject, mode, shotIds) => {
      const expectedProject = projectRef.current;
      return (
        sceneMatteInheritanceRef.current?.(baseProject, mode, shotIds, {
          dialogueOverlayEnabled:
            sceneDialogueOverlayEnabledForProject(expectedProject),
          expectedProject,
          markFileNamesUnsynced: true
        }) ?? Promise.resolve(false)
      );
    },
    loadFolderScan,
    markShotsDirty,
    metadataPath,
    primarySelectedShotId,
    projectRef,
    selectSingleShot,
    setRecentFolders,
    setStatus,
    setWorkspaceTask,
    updateProject
  });

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

    const inheritedMatteMode = sceneMatteModeForProject(project);
    const inheritedDialogueOverlayEnabled =
      sceneDialogueOverlayEnabledForProject(project);
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
              dirtyShotIds: dirtyShotIds()
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

    const importedProject = await loadFolderScan(
      result,
      needsImageImport
        ? "Imported images into Storyboard Flow Format"
        : "Imported storyboard script changes",
      false,
      false
    );
    if (importedProject && inheritedMatteMode) {
      const inheritedShotIds = importedProject.shots
        .filter(
          (shot) =>
            shot.swb?.status === "owned" &&
            (!matteForShot(shot) ||
              inheritedDialogueOverlayEnabled !==
                bitmapLayersForShot(shot).some(
                  (layer) => layer.id === dialogueOverlayBitmapLayerId
                ))
        )
        .map((shot) => shot.id);
      if (inheritedShotIds.length > 0) {
        await sceneMatteInheritanceRef.current?.(
          importedProject,
          inheritedMatteMode,
          inheritedShotIds,
          {
            dialogueOverlayEnabled: inheritedDialogueOverlayEnabled,
            expectedProject: importedProject
          }
        );
      }
    }
  };

  const {
    handleCreateDialogue,
    handleDialogueBlur,
    handleDialogueText
  } = useDialogueActionController({
    setEditingDialogueId,
    updateProject
  });

  const {
    handleCopySelection,
    handlePasteSelection
  } = useClipboardActionController({
    api: typeof window === "undefined" ? undefined : window.storyboard,
    bitmapLayerWriteQueueRef,
    clipboardSelectionRef,
    createHistoryEntry,
    deleteTargetRef,
    folderPath,
    markShotsDirty,
    metadataPath,
    projectRef,
    queuePasteAnimation,
    recordUndoEntry,
    selectSingleShot,
    selectedShotIdsRef,
    setClipboardSelection,
    setDeleteTarget,
    setSelectedBitmapLayerIds,
    setStatus,
    updateProject
  });
  const setSpacePanActiveForKeyboard = useCallback((value: SetStateAction<boolean>) => {
    setIsSpacePanActive((current) => {
      const next = typeof value === "function" ? value(current) : value;
      isSpacePanActiveRef.current = next;
      if (!next) {
        setIsBoardPanning(false);
      }
      return next;
    });
  }, []);

  useAppKeyboardShortcutsController({
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
    setIsSpacePanActive: setSpacePanActiveForKeyboard,
    setIsOnionSkinEnabled,
    setSelectedShotIds,
    setStatus,
    zZoomActiveRef
  });

  const {
    handleDragCancel,
    handleDragMove,
    handleDragOver,
    handleDragStart,
    resetActiveDragState
  } = useStoryboardDragSessionController({
    openPendingShelf,
    orderedShotIds: orderedShots.map((shot) => shot.id),
    projectRef,
    queueInsertionTargetsFromDrag,
    resetInsertionDragState,
    selectedShotIdsRef,
    selectSingleShot,
    setActiveDialogue,
    setActiveDragType,
    setActiveParkedShotIds,
    setActiveShotIds,
    setDragPreviewShotIds
  });

  const { handleDragEnd } = useStoryboardDragEndController({
    flushInsertionTargetsFromDragEnd,
    inheritSceneMatte: (baseProject, mode, shotIds, options) => {
      const expectedProject = projectRef.current;
      return (
        sceneMatteInheritanceRef.current?.(baseProject, mode, shotIds, {
          ...options,
          dialogueOverlayEnabled:
            sceneDialogueOverlayEnabledForProject(expectedProject),
          expectedProject
        }) ?? Promise.resolve(false)
      );
    },
    isDragEndInsideParkingShelf: (event) =>
      dragEndInsideSelector(event, ".parking-shelf.is-open", lastPointerPositionRef.current),
    projectRef,
    queuePasteAnimation,
    resetActiveDragState,
    selectedShotIdsRef,
    selectSingleShot,
    setDeleteTarget,
    setStatus,
    updateProject
  });

  const showStoryboardInsertionIndicator = shouldShowStoryboardInsertionIndicator({
    activeShotCount: activeShotIds.length + activeParkedShotIds.length,
    hasIndicator: Boolean(storyboardInsertionIndicator)
  });
  const storyboardInsertionIndicatorElement =
    showStoryboardInsertionIndicator && storyboardInsertionIndicator ? (
      <div
        className={`storyboard-insertion-indicator ${
          storyboardInsertionIndicator.orientation === "horizontal" ? "is-horizontal" : ""
        }`}
        aria-hidden="true"
        style={{
          left: storyboardInsertionIndicator.left,
          top: storyboardInsertionIndicator.top,
          height: storyboardInsertionIndicator.height,
          width: storyboardInsertionIndicator.width
        }}
      />
    ) : null;
  const storyboardDragOverlay = (
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
  );
  const {
    handleApplyBlurFromToolRail,
    handleClearCurrentLayerFromToolRail
  } = createCurrentLayerActionController({
    getPrimarySelectedShot: () => primarySelectedShot,
    getBlurRadius: () => blurRadius,
    handleBlurBitmapLayer: (shot, layerId, radius) => {
      const selection = bitmapBlurSelectionsRef.current.get(shot.id);
      return handleBitmapBlur(
        shot,
        layerId,
        radius,
        selection?.layerId === layerId ? selection.points : undefined
      );
    },
    handleClearBitmapLayer,
    setStatus
  });
  const {
    handleDisableSceneMatte,
    handleInheritSceneMatte,
    handlePlaceDialogueOnMatte,
    handleSetShotMatteMode
  } = createShotPresentationController({
    api: window.storyboard,
    bitmapLayerWriteQueueRef,
    createHistoryEntry,
    folderPath,
    getRecoveryRequiredMessage: () => workspaceRecoveryRequiredRef.current,
    markShotsDirty,
    metadataPath,
    onRecoveryRequired: (message) => {
      workspaceRecoveryRequiredRef.current = message;
      workspaceSaveStateRef.current = "error";
      setWorkspaceSaveState("error");
      setAutosaveError((current) =>
        autosaveErrorReducer(current, { type: "failed", message })
      );
      setSaveErrorDialog(message);
    },
    projectRef,
    recordUndoEntry,
    setStatus,
    shotPresentationActionRef,
    updateProject
  });
  sceneMatteInheritanceRef.current = handleInheritSceneMatte;
  const sceneMatteModes = [
    ...new Set(
      project.shots
        .map((shot) => matteForShot(shot)?.mode)
        .filter((mode): mode is "expanded" | "embedded" => Boolean(mode))
    )
  ];
  const sceneMatteMode = sceneMatteModes.length === 1 ? sceneMatteModes[0] : undefined;
  const isSceneMatteConfigured =
    project.shots.length > 0 &&
    project.shots.every(
      (shot) =>
        Boolean(matteForShot(shot)) &&
        bitmapLayersForShot(shot).some((layer) => layer.id === matteOverlayBitmapLayerId)
    );
  const isSceneDialogueOverlayConfigured =
    isSceneMatteConfigured &&
    project.shots.every((shot) =>
      bitmapLayersForShot(shot).some(
        (layer) => layer.id === dialogueOverlayBitmapLayerId
      )
    );
  const isMatteConfigurationDisabled =
    project.shots.length === 0 || isWorkspaceTaskRunning || isImportLocked;
  const isDialogueOverlayDisabled =
    project.shots.length === 0 || isWorkspaceTaskRunning || isImportLocked;

  const handleAiProjectChange = (nextProject: Project, nextStatus: string) =>
    applyAiProjectChange({
      markShotsDirty,
      nextProject,
      nextStatus,
      projectRef,
      setAutosaveRevision,
      setProject,
      setStatus,
      setWorkspaceSaveState
    });
  const workspaceBoardScrollClassName = `workspace-board-scroll ${
    isSpacePanActive ? "is-space-pan-active" : ""
  } ${isBoardPanning ? "is-space-panning" : ""}`;
  const parkingShelfElement = (
    <SortableContext items={parkedShots.map((shot) => `parked-${shot.id}`)} strategy={rectSortingStrategy}>
      <ParkingShelf
        shots={parkedShots}
        isOpen={isParkingShelfOpen}
        insertionIndicator={activeShotIds.length > 0 ? parkingInsertionIndicator : undefined}
        listRef={parkingListRef}
      />
    </SortableContext>
  );
  return (
    <main
      className={appShellClassName}
      onContextMenu={openSketchCanvasContextMenu}
      onDragOver={handleStoryboardScriptDragOver}
      onDrop={(event) => void handleStoryboardScriptDrop(event)}
    >
      <Topbar
        addShotMenuRef={addShotMenuRef}
        blankShotPreset={blankShotPreset}
        boardViewMode={boardViewMode}
        folderInputValue={folderInputValue}
        handleAddShot={handleAddShot}
        handleImportSwbFormat={handleImportSwbFormat}
        handleDisableSceneMatte={handleDisableSceneMatte}
        handleOpenFolderByPath={handleOpenFolderByPath}
        handlePlaceDialogueOnMatte={handlePlaceDialogueOnMatte}
        handleSaveProject={handleSaveProject}
        handleSetShotMatteMode={handleSetShotMatteMode}
        handleToggleAiPanel={handleToggleAiPanel}
        handleTogglePendingShelf={handleTogglePendingShelf}
        hasSwbWarning={hasSwbWarning}
        importHelpRef={importHelpRef}
        isAddShotMenuOpen={isAddShotMenuOpen}
        isAiPanelVisible={isAiPanelVisible}
        isImportHelpOpen={isImportHelpOpen}
        isImportLocked={isImportLocked}
        isImportNudging={isImportNudging}
        isMatteMenuOpen={isMatteMenuOpen}
        isParkingShelfOpen={isParkingShelfOpen}
        isRecentMenuOpen={isRecentMenuOpen}
        isSaveEmphasized={isSaveEmphasized}
        isSaveMenuOpen={isSaveMenuOpen}
        isWorkspaceTaskRunning={isWorkspaceTaskRunning}
        isDialogueOverlayDisabled={isDialogueOverlayDisabled}
        isMatteConfigurationDisabled={isMatteConfigurationDisabled}
        isSceneDialogueOverlayConfigured={isSceneDialogueOverlayConfigured}
        isSceneMatteConfigured={isSceneMatteConfigured}
        needsSwbImport={needsSwbImport}
        nudgeImportRequired={nudgeImportRequired}
        project={project}
        sceneMatteMode={sceneMatteMode}
        recentFolders={recentFolders}
        recentMenuRef={recentMenuRef}
        matteMenuRef={matteMenuRef}
        saveMenuRef={saveMenuRef}
        setBlankShotPreset={setBlankShotPreset}
        setBoardViewMode={setBoardViewMode}
        setFolderInputValue={setFolderInputValue}
        setIsAddShotMenuOpen={setIsAddShotMenuOpen}
        setIsImportHelpOpen={setIsImportHelpOpen}
        setIsMatteMenuOpen={setIsMatteMenuOpen}
        setIsRecentMenuOpen={setIsRecentMenuOpen}
        setIsSaveMenuOpen={setIsSaveMenuOpen}
        updateProjectName={updateProjectName}
        updateProjectNaming={updateProjectNaming}
        workspaceTask={workspaceTask}
      />

      <WorkspaceTaskProgressBanner workspaceTask={workspaceTask} />

      <SaveErrorModal
        message={saveErrorDialog}
        onDismiss={() => setSaveErrorDialog(undefined)}
      />

      <StoryboardScriptImportModal
        draft={storyboardScriptImportDraft}
        isWorkspaceTaskRunning={isWorkspaceTaskRunning}
        onCancel={() => setStoryboardScriptImportDraft(undefined)}
        onCreateProject={handleCreateProjectFromStoryboardScript}
        onSelectTargetFolder={handleSelectStoryboardScriptTargetFolder}
      />

      <div className="workspace-layout">
        <ToolRail
          activeSketchTool={activeSketchTool}
          blurRadius={blurRadius}
          brushColor={brushColor}
          closeRadialToolMenu={closeRadialToolMenu}
          onApplyBlur={() => void handleApplyBlurFromToolRail()}
          onClearCurrentLayer={handleClearCurrentLayerFromToolRail}
          setActiveSketchTool={setActiveSketchTool}
          setBlurRadius={setBlurRadius}
          setBrushColor={setBrushColor}
        />
        {radialToolMenu ? (
          <RadialToolMenu
            menu={toolRadialMenuConfig[radialToolMenu.tool]}
            tool={radialToolMenu.tool}
            x={radialToolMenu.x}
            y={radialToolMenu.y}
            isClosing={radialToolMenu.isClosing === true}
            settings={currentSketchToolSettings}
            onApplyPreset={applyRadialPresetAndClose}
            onAdjust={adjustRadialToolValue}
            onUpdateSlot={(index, slot) => updateRadialSlot(radialToolMenu.tool, index, slot)}
            onUpdateSlots={(slots) => updateRadialSlots(radialToolMenu.tool, slots)}
            onClose={closeRadialToolMenu}
          />
        ) : null}
        {isStoryboardBoardMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div
              className={workspaceBoardScrollClassName}
              ref={workspaceBoardScrollRef}
              onPointerDownCapture={handleBoardNavigationPointerDownCapture}
            >
              <SortableContext
                items={storyboardSortableItemIds}
                strategy={rectSortingStrategy}
              >
                <section
                  ref={boardGridRef}
                  className="board-grid"
                  style={boardZoomStyle}
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
                        {...layerPanelPropsForShot(shot.id)}
                        thumbnailRevision={autosaveRevision}
                        onAddLayer={(shotId) => void handleAddBitmapLayer(shotId)}
                        onRemoveLayer={(shotId, layerId) =>
                          void handleRemoveBitmapLayer(shotId, layerId)
                        }
                        onMergeLayers={(shotId, layerId, selectedLayerIds) =>
                          void handleMergeBitmapLayers(shotId, layerId, selectedLayerIds)
                        }
                        onMergeVisibleLayers={(shotId) => void handleMergeVisibleBitmapLayers(shotId)}
                        onClearLayer={(shotId, layerId) => void handleClearBitmapLayer(shotId, layerId)}
                        onSelectLayer={handleSelectLayer}
                        onUpdateLayer={handleUpdateLayer}
                        onMoveLayer={handleMoveLayer}
                        onMoveLayerGroup={handleMoveLayerGroup}
                        onSelectedLayerIdsChange={handleSelectedBitmapLayerIdsChange}
                        onUpdateLayerGroupOpacity={handleUpdateLayerGroupOpacity}
                        onCreateDialogue={handleCreateDialogue}
                        onDialogueText={handleDialogueText}
                        onDialogueBlur={handleDialogueBlur}
                        onSketchStroke={(layerId, stroke, renderedDataUrl, pendingStrokes) =>
                          handleBitmapStroke(shot, layerId, stroke, renderedDataUrl, pendingStrokes)
                        }
                        onSelectionTransform={(layerId, dataUrl) =>
                          handleBitmapSelectionTransform(shot, layerId, dataUrl)
                        }
                        onBitmapSelectionChange={handleBitmapSelectionChange}
                        onFill={(layerId, point, color) =>
                          handleBitmapFill(shot, layerId, point, color)
                        }
                        onPickColor={setBrushColor}
                        onSketchBeginInteraction={closeRadialToolMenu}
                      />
                    );
                  })}
                  {storyboardInsertionIndicatorElement}
                  <SelectionMarquee ref={selectionMarqueeRef} />
                </section>
              </SortableContext>
            </div>
            {parkingShelfElement}

            {storyboardDragOverlay}
          </DndContext>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div
              className={workspaceBoardScrollClassName}
              ref={workspaceBoardScrollRef}
              onPointerDownCapture={handleBoardNavigationPointerDownCapture}
            >
              <SortableContext
                items={japaneseStoryboardSortableItemIds}
                strategy={verticalListSortingStrategy}
              >
                <JapaneseStoryboardView
                  ref={boardGridRef}
                  activeSketchTool={activeSketchTool}
                  brushColor={brushColor}
                  brushOpacity={brushOpacity}
                  brushSize={brushSize}
                  brushSoftness={brushSoftness}
                  eraserOpacity={eraserOpacity}
                  eraserSize={eraserSize}
                  eraserSoftness={eraserSoftness}
                  folderPath={folderPath}
                  isZoomScrubbing={isZoomScrubbing}
                  marquee={
                    <>
                      {storyboardInsertionIndicatorElement}
                      <SelectionMarquee ref={selectionMarqueeRef} />
                    </>
                  }
                  onPointerDown={handleSelectionPointerDown}
                  project={project}
                  selectedShotIds={selectedShotIds}
                  zoomLevel={zoomLevel}
                  onActionText={handleShotScriptText}
                  onDialogueText={handleShotDialogueText}
                  onFill={(shot, layerId, point, color) =>
                    handleBitmapFill(shot, layerId, point, color)
                  }
                  onFocusShot={(shotId) => {
                    selectSingleShot(shotId);
                    setDeleteTarget({ type: "shot" });
                    setSelectedBitmapLayerIds(undefined);
                  }}
                  onPickColor={setBrushColor}
                  onSelectShot={(shotId, event) => handleShotSelect(shotId, event)}
                  onSelectionTransform={(shot, layerId, dataUrl) =>
                    handleBitmapSelectionTransform(shot, layerId, dataUrl)
                  }
                  onBitmapSelectionChange={handleBitmapSelectionChange}
                  onSketchBeginInteraction={closeRadialToolMenu}
                  onSketchStroke={(shot, layerId, stroke, renderedDataUrl, pendingStrokes) =>
                    handleBitmapStroke(shot, layerId, stroke, renderedDataUrl, pendingStrokes)
                  }
                />
              </SortableContext>
            </div>
            {parkingShelfElement}
            {storyboardDragOverlay}
          </DndContext>
        )}
        {isImportLocked ? (
          <button
            type="button"
            className="workspace-import-lock"
            onClick={nudgeImportRequired}
            aria-label={IMPORT_REQUIRED_HELP.title}
          />
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
          folderPath={folderPath}
          thumbnailRevision={autosaveRevision}
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
      <StatusPopover
        autosaveError={autosaveError}
        checkForUpdates={checkForUpdates}
        fileNameSyncState={fileNameSyncState}
        hasSwbWarning={hasSwbWarning}
        needsSwbImport={needsSwbImport}
        openUpdateDownload={openUpdateDownload}
        parkedShotCount={parkedShots.length}
        setAutosaveError={setAutosaveError}
        setUpdateNotice={setUpdateNotice}
        shotCount={project.shots.length}
        status={status}
        updateNotice={updateNotice}
        workspaceSaveState={workspaceSaveState}
      />
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
            onPointerDown={() => beginZoomScrubbing()}
            onPointerUp={endZoomScrubbing}
            onLostPointerCapture={endZoomScrubbing}
            onBlur={endZoomScrubbing}
            onChange={(event) => {
              handleZoomInputChange(Number(event.target.value));
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
