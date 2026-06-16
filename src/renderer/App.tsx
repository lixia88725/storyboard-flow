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
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent
} from "react";
import {
  applyRenamePlan,
  createProject,
  createRenamePlan,
  defaultProjectNaming,
  defaultSaveNaming,
  bitmapLayersForShot,
  copyBitmapLayerToShot,
  duplicateShotAfter,
  imageBitmapLayerId,
  mergeExternalImageChanges,
  mergeFolderImages,
  moveDialogueToShot,
  projectAcceptedExternalEdits,
  projectHasSwbWarning,
  projectNeedsSwbImport,
  parkShotGroup,
  restoreParkedShotGroup,
  reorderShotGroup,
  reorderShots,
  sortedShots,
  type ShotPlacement,
  bitmapLayerPath,
} from "../shared/projectOps";
import type {
  BitmapLayer,
  Dialogue,
  FolderScanPayload,
  Project,
  Shot,
  BlankShotPreset,
  SketchTool,
  StrokeTool
} from "../shared/types";
import { maxStoryboardZoom } from "./animationViewport";
import {
  activeVisibleBitmapLayerForShot,
  primaryShotFromSelection,
  primaryShotOrFirst
} from "./activeTargets";
import { autosaveErrorReducer, type AutosaveErrorNotice } from "./autosaveError";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  copySelectionFromProject,
  layerPasteTargetFromProject,
  shotAssetCopyPlan,
  type ClipboardSelection
} from "./clipboardSelection";
import { DialoguePreview, ShotStackPreview } from "./DragPreviews";
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
import { ShotCard, type CardFace } from "./ShotCard";
import { StatusPopover } from "./StatusPopover";
import { Timeline } from "./Timeline";
import { ToolRail } from "./ToolRail";
import { Topbar } from "./Topbar";
import { formatSaveFailureStatus } from "./saveErrors";
import { useStoryboardMarqueeController } from "./storyboardMarqueeController";
import { measureStoryboardGridColumnsFromDom } from "./storyboardGridMeasurement";
import { createTransparentLayerDataUrl } from "./bitmapLayerCanvas";
import {
  dragPreviewShotIds as chooseDragPreviewShotIds,
  inferDropPlacementFromDragEnd,
  inferShotPlacement,
  shouldShowStoryboardInsertionIndicator,
  storyboardSortableItemIds as realStoryboardSortableItemIds,
  type DragData
} from "./storyboardDnd";
import { useStoryboardInsertionController } from "./storyboardInsertionController";
import { dragEndInsideSelector } from "./dragHitTesting";
import { sameLayerSelection, useStoryboardInteractionState } from "./storyboardInteractionState";
import { hasOpenShortcutBlockingMenu } from "./shortcutMenuController";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { useBitmapLayerPaintingController } from "./bitmapLayerPaintingController";
import { useWorkspaceLifecycleState } from "./workspaceLifecycleState";
import { useUpdateNoticeController } from "./updateNoticeController";
import { useAnimationModeLayoutController } from "./animationModeLayoutController";
import { usePasteAnimationController } from "./pasteAnimationController";
import { hasOnlyCompatibleExternalEdits, hasUnsavedWorkspaceChanges, projectChangedDuringLoad, shouldAutosaveAfterLoad, shouldPersistLoadedProject } from "./workspacePersistenceController";
import {
  applyRadialPresetSlot,
  type RadialDragKind,
  type RadialPresetSlot,
  type RadialToolSlot
} from "./toolRadialMenu";
import {
  nextRadialSlotConfig,
  updateRadialDragSettings,
  useRadialToolMenuController
} from "./radialToolMenuController";
import { usePointerPositionController } from "./pointerPositionController";
import { useRecentFoldersController } from "./recentFoldersController";
import { useToolRadialSettingsController } from "./toolRadialSettingsController";
import { useWorkspaceTaskProgressController } from "./workspaceTaskProgressController";
import { useWorkspaceCloseGuardController } from "./workspaceCloseGuardController";
import { useWorkspaceExternalRefreshController } from "./workspaceExternalRefreshController";
import { useWorkspaceMenuController } from "./workspaceMenuController";
import { persistWorkspaceProject, useWorkspaceAutosaveController } from "./workspaceAutosaveController";
import { useAppKeyboardShortcutsController } from "./appKeyboardShortcutsController";
import { useLayerPanelController } from "./layerPanelController";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import { useRightSidebarController } from "./rightSidebarController";
import { createShotSelectionController } from "./shotSelectionController";
import { useAddShotController } from "./addShotController";
import { useProjectEditController } from "./projectEditController";
import { withStatus } from "./statusAction";
import {
  SaveErrorModal,
  StoryboardScriptImportModal,
  WorkspaceTaskProgressBanner,
  type StoryboardScriptImportDraft
} from "./WorkspaceOverlays";

const defaultBrushColor = "#f05a28";
const defaultBrushSize = 4;
const defaultEraserSize = 18;
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
  const [activeSketchTool, setActiveSketchTool] = useState<SketchTool>("brush");
  const [brushColor, setBrushColor] = useState(defaultBrushColor);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSize, setBrushSize] = useState(defaultBrushSize);
  const [brushSoftness, setBrushSoftness] = useState(0);
  const [eraserSize, setEraserSize] = useState(defaultEraserSize);
  const [eraserOpacity, setEraserOpacity] = useState(1);
  const [eraserSoftness, setEraserSoftness] = useState(0);
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
    isRecentMenuOpen,
    isSaveMenuOpen,
    recentMenuRef,
    saveMenuRef,
    setIsAddShotMenuOpen,
    setIsImportHelpOpen,
    setIsRecentMenuOpen,
    setIsSaveMenuOpen
  } = useWorkspaceMenuController();
  const [blankShotPreset, setBlankShotPreset] = useState<BlankShotPreset>("16:9");
  const [isImportNudging, setIsImportNudging] = useState(false);
  const [cardFace, setCardFace] = useState<CardFace>("image");
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
  const bitmapLayerWriteQueueRef = useRef(createBitmapLayerWriteQueue());
  const appShellRef = useRef<HTMLElement | null>(null);
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
  const {
    radialToolMenu,
    closeRadialToolMenu,
    openSketchCanvasContextMenu
  } = useRadialToolMenuController({
    activeSketchTool,
    needsSwbImport,
    setStatus
  });

  const { queueAnimation: queuePasteAnimation } = usePasteAnimationController(project);

  const {
    beginZoomScrubbing,
    boardGridRef,
    boardZoomStyle,
    currentBoardScroll,
    endZoomScrubbing,
    handleZoomInputChange,
    scrollBoardBy,
    workspaceBoardScrollRef,
    zoomInputRef,
    zoomValueLabelRef
  } = useStoryboardZoomController({
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
  });
  const {
    flushInsertionTargetsFromDragEnd,
    queueInsertionTargetsFromDrag,
    resetInsertionDragState
  } = useStoryboardInsertionController({
    boardGridRef,
    currentBoardScroll,
    isAnimationModeRef,
    lastPointerPositionRef,
    parkingListRef,
    selectedShotIdsRef,
    setParkingInsertionIndicator,
    setStoryboardInsertionIndicator
  });

  useEffect(() => {
    clipboardSelectionRef.current = clipboardSelection;
  }, [clipboardSelection]);

  const {
    clearSelectedShots,
    selectSingleShot,
    selectShotsByIds,
    selectShotWithMode
  } = createShotSelectionController({
    orderedShotIds: orderedShots.map((shot) => shot.id),
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
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

  const persistWorkspace = async (
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
              dirtyShotIds: dirtyShotIds(),
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
            dirtyShotIds: dirtyShotIds(),
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
        dirtyShotIds: dirtyShotIds()
      });

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

    await loadFolderScan(
      result,
      needsImageImport
        ? "Imported images into Storyboard Flow Format"
        : "Imported storyboard script changes",
      false,
      false
    );
  };

  const {
    handleCreateDialogue,
    handleDialogueBlur,
    handleDialogueText
  } = useDialogueActionController({
    setEditingDialogueId,
    updateProject
  });

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
  });

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

    queuePasteAnimation("shot", sourceShot.id, pastedShotId);
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

    queuePasteAnimation("layer", sourceLayer.id, pastedLayerId);
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

  const handleDragStart = (event: DragStartEvent) => {
    resetInsertionDragState();
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

  const handleDragMove = (event: DragMoveEvent) => {
    queueInsertionTargetsFromDrag(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    queueInsertionTargetsFromDrag(event);
  };

  const handleDragCancel = () => {
    setActiveDragType(undefined);
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setActiveParkedShotIds([]);
    resetInsertionDragState();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const {
      storyboardInsertionTarget: dragEndStoryboardInsertionTarget,
      parkingInsertionTarget: dragEndParkingInsertionTarget
    } = flushInsertionTargetsFromDragEnd(event);
    setActiveDragType(undefined);
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setActiveParkedShotIds([]);
    resetInsertionDragState();

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

      queuePasteAnimation("shot", "", "");
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
  const handleClearCurrentLayerFromToolRail = useCallback(() => {
    if (!primarySelectedShot) {
      setStatus("Select a shot before clearing a layer");
      return;
    }

    const activeLayer = activeVisibleBitmapLayerForShot(primarySelectedShot);
    if (activeLayer) {
      void handleClearBitmapLayer(primarySelectedShot.id, activeLayer.id);
    }
  }, [handleClearBitmapLayer, primarySelectedShot, setStatus]);

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
  return (
    <main
      ref={appShellRef}
      className={appShellClassName}
      onContextMenu={openSketchCanvasContextMenu}
      onDragOver={handleStoryboardScriptDragOver}
      onDrop={(event) => void handleStoryboardScriptDrop(event)}
    >
      <Topbar
        addShotMenuRef={addShotMenuRef}
        blankShotPreset={blankShotPreset}
        folderInputValue={folderInputValue}
        handleAddShot={handleAddShot}
        handleImportSwbFormat={handleImportSwbFormat}
        handleOpenFolderByPath={handleOpenFolderByPath}
        handleSaveProject={handleSaveProject}
        handleToggleAiPanel={handleToggleAiPanel}
        handleTogglePendingShelf={handleTogglePendingShelf}
        hasSwbWarning={hasSwbWarning}
        importHelpRef={importHelpRef}
        isAddShotMenuOpen={isAddShotMenuOpen}
        isAiPanelVisible={isAiPanelVisible}
        isImportHelpOpen={isImportHelpOpen}
        isImportLocked={isImportLocked}
        isImportNudging={isImportNudging}
        isParkingShelfOpen={isParkingShelfOpen}
        isRecentMenuOpen={isRecentMenuOpen}
        isSaveMenuOpen={isSaveMenuOpen}
        isWorkspaceTaskRunning={isWorkspaceTaskRunning}
        needsSwbImport={needsSwbImport}
        nudgeImportRequired={nudgeImportRequired}
        project={project}
        recentFolders={recentFolders}
        recentMenuRef={recentMenuRef}
        saveMenuRef={saveMenuRef}
        setBlankShotPreset={setBlankShotPreset}
        setFolderInputValue={setFolderInputValue}
        setIsAddShotMenuOpen={setIsAddShotMenuOpen}
        setIsImportHelpOpen={setIsImportHelpOpen}
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
          brushColor={brushColor}
          cardFace={cardFace}
          closeRadialToolMenu={closeRadialToolMenu}
          onClearCurrentLayer={handleClearCurrentLayerFromToolRail}
          setActiveSketchTool={setActiveSketchTool}
          setBrushColor={setBrushColor}
          setCardFace={setCardFace}
        />
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
            onPointerDown={beginZoomScrubbing}
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
