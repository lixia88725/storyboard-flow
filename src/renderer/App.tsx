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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import {
  createProject,
  defaultSaveNaming,
  bitmapLayersForShot,
  dialogueOverlayBitmapLayerId,
  imageBitmapLayerId,
  matteForShot,
  matteOverlayBitmapLayerId,
  mergeExternalImageChanges,
  mergeFolderImages,
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
import { pendingBakeForProject, initializeCompletedShot } from "../shared/pendingBake";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
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
import { historyDirtyShotIds, useProjectHistoryController } from "./projectHistoryController";
import { markdownPathFromDroppedFiles } from "./markdownDrop";
import {
  SelectionMarquee,
  type MarqueeOverlayHandle
} from "./SelectionMarquee";
import { ParkingShelf } from "./ParkingShelf";



import { useBoardViewState } from "./boardViewState";
import { useStoryboardZoomController } from "./storyboardZoomController";
import { RadialToolMenu } from "./RadialToolMenu";
import { ShotCard } from "./ShotCard";
import { StatusPopover } from "./StatusPopover";
import { createWorkspaceSession } from "./workspaceSession";
import { Timeline } from "./Timeline";
import { ToolRail } from "./ToolRail";
import { Topbar } from "./Topbar";
import { JapaneseStoryboardView } from "./JapaneseStoryboardView";
import { EmptyStoryboardDropZone } from "./EmptyStoryboardDropZone";
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
import { dragEndInsideSelector, isPointerInsideElement } from "./dragHitTesting";
import { sameLayerSelection, useStoryboardInteractionState } from "./storyboardInteractionState";
import { hasOpenShortcutBlockingMenu } from "./shortcutMenuController";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { useBitmapLayerPaintingController } from "./bitmapLayerPaintingController";
import { useWorkspaceLifecycleState, type WorkspaceTask } from "./workspaceLifecycleState";
import { useUpdateNoticeController } from "./updateNoticeController";
import { useAnimationModeLayoutController } from "./animationModeLayoutController";
import { usePasteAnimationController } from "./pasteAnimationController";
import {
  hasUnsavedWorkspaceChanges,
  runExclusiveWorkspaceAction,
  shouldEmphasizeSaveButton
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
import { useWorkspaceAutosaveController } from "./workspaceAutosaveController";
import { useAppKeyboardShortcutsController } from "./appKeyboardShortcutsController";
import {
  isLayerPanelOpenForShot,
  useLayerPanelController
} from "./layerPanelController";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import { useRightSidebarController } from "./rightSidebarController";
import { useStoryboardDragSessionController } from "./storyboardDragSessionController";
import { useStoryboardDragEndController } from "./storyboardDragEndController";
import { createShotSelectionController } from "./shotSelectionController";
import { prepareAddShotMatte, useAddShotController, type AddShotOperation } from "./addShotController";
import { prepareImportedImageMatte } from "./normalSaveImportMatte";


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
import { StoryboardMediaWindowProvider } from "./storyboardMediaWindow";
import { createStoryboardMediaWindowInteractionController } from "./storyboardMediaWindowInteraction";
import {
  bumpShotBitmapRevisions,
  bumpWorkspaceShotBitmapRevisions,
  changedShotIdsForBitmapRevision,
  shotIdsForBitmapPaths
} from "./shotBitmapRevision";
import { useStableEvent } from "./useStableEvent";

const minSketchSoftness = 0;
const maxSketchSoftness = 1;
const maxUndoHistory = 60;
const emptyDialogueList: Dialogue[] = [];

type ProjectUpdate = Project | ((currentProject: Project) => Project);
// Kept here with App's state wiring: this is only the existing image Import policy.
export const useImageImportAdmission = (
  projectRef: { current: Project },
  workspaceTask: WorkspaceTask | undefined,
  setWorkspaceTaskState: (task: WorkspaceTask | undefined) => void
) => {
  // Publish synchronous task transitions at the setter boundary, not during render.
  // Layout commit reconciles state; abandoned concurrent renders cannot alter admission.
  const workspaceTaskRef = useRef(workspaceTask);
  useLayoutEffect(() => { workspaceTaskRef.current = workspaceTask; }, [workspaceTask]);
  const setWorkspaceTask = useCallback((update: SetStateAction<WorkspaceTask | undefined>) => {
    const next = typeof update === "function" ? update(workspaceTaskRef.current) : update;
    workspaceTaskRef.current = next;
    setWorkspaceTaskState(next);
  }, [setWorkspaceTaskState]);
  const isImageImportLocked = useCallback(
    () => projectNeedsSwbImport(projectRef.current) && !workspaceTaskRef.current,
    [projectRef]
  );
  return { isImageImportLocked, setWorkspaceTask };
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
    setWorkspaceTask: setWorkspaceTaskState,
    fileNameSyncState,
    setFileNameSyncState,
    fileNameSyncStateRef,
    recentFolders,
    setRecentFolders,
    autosaveRevision,
    setAutosaveRevision
  } = useWorkspaceLifecycleState();
  const { isImageImportLocked, setWorkspaceTask } = useImageImportAdmission(
    projectRef, workspaceTask, setWorkspaceTaskState
  );
  const [activeDialogue, setActiveDialogue] = useState<Dialogue | undefined>();
  const [shotBitmapRevisionById, setShotBitmapRevisionById] = useState<
    Record<string, number>
  >({});
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
  const [storyboardScriptImportDraft, setStoryboardScriptImportDraftState] =
    useState<StoryboardScriptImportDraft | undefined>();
  const storyboardScriptImportDraftRef = useRef<StoryboardScriptImportDraft | undefined>(undefined);
  const storyboardScriptInspectRequestRef = useRef(0);
  const setStoryboardScriptImportDraft = (update: StoryboardScriptImportDraft | undefined |
    ((draft: StoryboardScriptImportDraft | undefined) => StoryboardScriptImportDraft | undefined)) => {
    const next = typeof update === "function" ? update(storyboardScriptImportDraftRef.current) : update;
    storyboardScriptImportDraftRef.current = next;
    storyboardScriptInspectRequestRef.current += 1;
    setStoryboardScriptImportDraftState(next);
  };
  const [clipboardSelection, setClipboardSelection] = useState<ClipboardSelection | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const {
    appShellClassName,
    isParkingShelfOpen,
    openPendingShelf,
    togglePendingShelf: handleTogglePendingShelf
  } = useRightSidebarController({ isAnimationMode });

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
  const selectionMarqueeRef = useRef<MarqueeOverlayHandle | null>(null);
  const storyboardMediaWindowInteractionController = useMemo(
    () => createStoryboardMediaWindowInteractionController(),
    []
  );
  const scriptImportCheckIdRef = useRef(0);
  const aiApplyWorkspaceIdentityRef = useRef<object>({});
  const dirtyShotIdsRef = useRef<Set<string>>(new Set());
  const clipboardSelectionRef = useRef<ClipboardSelection | undefined>(undefined);
  const selectedShotCountLabelRef = useRef<HTMLSpanElement | null>(null);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const parkingListRef = useRef<HTMLDivElement | null>(null);
  const storyboardInsertionLayoutRef = useRef<StoryboardInsertionLayout>("grid");
  const storyboardInsertionBlockedRef = useRef(false);
  const bitmapQueueGuardInputRef = useRef<() => { hasUnsavedChanges: boolean }>(() => ({ hasUnsavedChanges: true }));
  const bitmapLayerWriteQueueRef = useRef(createBitmapLayerWriteQueue({
    onBusyChange: busy => {
      if (!window.storyboard) throw new Error("Bitmap queue close guard unavailable");
      window.storyboard.updateBitmapQueueGuard({ busy, ...bitmapQueueGuardInputRef.current() });
    }
  }));

  const saveInFlightRef = useRef<Promise<boolean> | undefined>(undefined);
  const shotPresentationActionRef = useRef<Promise<void | boolean> | undefined>(undefined);
  const workspaceRecoveryRequiredRef = useRef<string | undefined>(undefined);
  const workspaceSession = createWorkspaceSession({
    owner: () => normalSaveAppAdapterRef.current?.owner,
    readRecovery: () => workspaceRecoveryRequiredRef.current,
    readDestination: () => ({ folderPath: folderPathRef.current, metadataPath: metadataPathRef.current }),
    readIdentity: () => aiApplyWorkspaceIdentityRef.current
  });
  const sceneMatteInheritanceRef = useRef<
    | ((
        baseProject: Project,
        mode: "expanded" | "embedded" | undefined,
        shotIds: readonly string[],
        options?: {
          dialogueOverlayEnabled?: boolean;
          expectedProject?: Project;
          isCurrent?: () => boolean;
          isWorkspaceCurrent?: () => boolean;
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
  const selectedShotIdSet = useMemo(() => new Set(selectedShotIds), [selectedShotIds]);
  const activeShotIdSet = useMemo(() => new Set(activeShotIds), [activeShotIds]);
  const dialogueByShotId = useMemo(() => {
    const grouped = new Map<string, Dialogue[]>();
    for (const dialogue of [...project.dialogues].sort((a, b) => a.order - b.order)) {
      const current = grouped.get(dialogue.shotId);
      if (current) {
        current.push(dialogue);
      } else {
        grouped.set(dialogue.shotId, [dialogue]);
      }
    }
    return grouped;
  }, [project.dialogues]);
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
    navigateShotSelection,
    selectSingleShot,
    selectShotsByIds
  } = createShotSelectionController({
    blurActiveFormControl,
    isEditableTarget: isKeyboardEditableTarget,
    orderedShotIds: orderedShots.map((shot) => shot.id),
    selectedBitmapLayerIdsRef,
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
    setDeleteTarget,
    setSelectedBitmapLayerIds,
    setSelectedShotIds
  });

  const { handleSelectionPointerDown } = useStoryboardMarqueeController({
    currentBoardScroll,
    interactionController: storyboardMediaWindowInteractionController,
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

  const { isLayerPanelOpen, toggleLayerPanelForShot } = useLayerPanelController({
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
    bitmapQueueGuardInputRef,
    normalSaveGuard: () => normalSaveAppAdapterRef.current!.owner.hasUnsavedWork(),
    settleNormalSave: () => bitmapLayerWriteQueueRef.current.drain(),
    dirtyShotIdsRef,
    fileNameSyncState,
    refreshKey: project,
    workspaceSaveState
  });
  const {
    clearShotsDirty,
    dirtyShotIds,
    markShotsDirty,
    resetDirtyShots: resetTrackedDirtyShots
  } = createDirtyShotTracker({ dirtyShotIdsRef, projectRef });
  const refreshChangedShotBitmapRevisions = useCallback(
    (previousProject: Project, nextProject: Project) => {
      const affectedShotIds = changedShotIdsForBitmapRevision(
        previousProject,
        nextProject
      );
      setShotBitmapRevisionById((current) =>
        bumpShotBitmapRevisions(current, affectedShotIds)
      );
    },
    []
  );
  const refreshRestoredBitmapPaths = useCallback((bitmapPaths: string[]) => {
    const affectedShotIds = shotIdsForBitmapPaths(projectRef.current, bitmapPaths);
    setShotBitmapRevisionById((current) =>
      bumpShotBitmapRevisions(current, affectedShotIds)
    );
  }, []);
  const {
    applyRedoEntry,
    applyUndoEntry,
    createHistoryEntry,
    createHistoryEntryFromLayerAssets,
    recordProjectUndoEntry,
    recordUndoEntry,
    resetHistoryStacks,
    rebasePendingHistory,
    invalidatePresentationHistory
  } = useProjectHistoryController({
    captureWorkspace: workspaceSession.captureHistory,
    captureEffectCompletion: () => normalSaveAppAdapterRef.current!.owner.captureEffectCompletion(),
    isImageImportLocked,
    getRecoveryRequiredMessage: () => workspaceRecoveryRequiredRef.current,
    api: window.storyboard,
    bitmapLayerWriteQueueRef,
    fileNameSyncStateRef,
    folderPathRef,
    markShotsDirty,
    maxEntries: maxUndoHistory,
    onLayerAssetsRestored: refreshRestoredBitmapPaths,
    publishProject: (p, ids) => normalSaveAppAdapterRef.current!.owner.publishEdit(p, ids),
    publishMetadataProject: (p, ids) => normalSaveAppAdapterRef.current!.owner.publishMetadataHistory(p, ids),
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

  // Every existing ensure caller already holds the bitmap/presentation queue.
  // Ensure stays in the existing queue/owner path, without an alternate App mode.
  const normalSaveAssetApi = {
    ...window.storyboard,
    ensureLayerAssets: async (payload: import("../shared/types").WorkspacePayload): Promise<import("../shared/types").WorkspacePayload> => {

      if (!await normalSaveAppAdapterRef.current!.ensureLayerAssets(payload)) throw new Error("Asset initialization incomplete; existing assets retained");
      return payload;
    }
  };
  const measureGridColumns = useCallback(measureStoryboardGridColumnsFromDom, []);
  // Add is a producer on a provisional Project (the active Project plus the shot it is
  // creating). Each Add gets its OWN operation handle (owner instance + workspace folder/
  // metadata + the actual blank return). The controller keeps that handle locally and uses
  // its bound api for every effect, so an interleaved newer Add cannot be borrowed. A newer
  // ready workspace (new instance) still refuses; metadata-only P2 merges stay allowed.
  // This is a limited operation-specific admission; it never relaxes the active-Project
  // identity gate used by ensure/export.
  type AddShotAdmissionArgs = { folderPath?: string; metadataPath?: string; bitmapPath?: string; project?: Project };
  type CapturedAddShotOperation = {
    admit: (args?: AddShotAdmissionArgs) => void;
    beginBlankRequest: () => void;
    recordBlankCompletion: (result: { imagePath: string; fileName?: string }) => void;
    registerBlankShot: (done: { shotId: string }) => { imagePath: string };
  };
  const buildAddShotAssetApi = (operation: CapturedAddShotOperation): Window["storyboard"] => {
    const guard = (args: AddShotAdmissionArgs) => {
      operation.admit(args);
      if (workspaceRecoveryRequiredRef.current) throw new Error(workspaceRecoveryRequiredRef.current);
    };
    return {
      ...window.storyboard,
      // The operation-bound api records the ACTUAL blank completion (the real call's own return)
      // into this operation; register can then only bind that recorded fact, never a caller path.
      createBlankShot: async (...args: Parameters<Window["storyboard"]["createBlankShot"]>) => {
        guard({ folderPath: typeof args[0] === "string" ? args[0] : undefined });
        // Claim the operation's single blank-request qualification synchronously BEFORE the real
        // irreversible createBlankShot effect. A second sequential or concurrent call — or an
        // automatic retry after a failure — is refused here, so exactly one underlying blank TIFF
        // can be created; the wrong-scope/recovery guard above never spends the qualification.
        operation.beginBlankRequest();
        const blank = await window.storyboard.createBlankShot(...args);
        if (blank) operation.recordBlankCompletion({ imagePath: blank.imagePath, fileName: blank.fileName });
        return blank;
      },
      writeLayerPng: (...args: Parameters<Window["storyboard"]["writeLayerPng"]>) => { guard({ folderPath: args[0]?.folderPath, bitmapPath: args[0]?.bitmapPath }); return window.storyboard.writeLayerPng(...args); },
      ensureLayerAssets: (...args: Parameters<Window["storyboard"]["ensureLayerAssets"]>) => { guard({ folderPath: args[0]?.folderPath, metadataPath: args[0]?.metadataPath, project: args[0]?.project }); return window.storyboard.ensureLayerAssets(...args); }
    };
  };
  const beginAddShotOperation = (): AddShotOperation | undefined => {
    const operation = normalSaveAppAdapterRef.current!.owner.captureAddShotOperation({
      folderPath: folderPathRef.current, metadataPath: metadataPathRef.current
    });
    return { api: buildAddShotAssetApi(operation), registerBlankShot: (done) => { operation.registerBlankShot(done); } };
  };

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
    const previousProject = projectRef.current;
    const nextProject =
      typeof projectUpdate === "function" ? projectUpdate(previousProject) : projectUpdate;
    const changedShotIds = changedShotIdsForBitmapRevision(
      previousProject,
      nextProject
    );

    if (recordUndo) {
      recordProjectUndoEntry();
    }

    {
      // Dirty marks are UI-only. Register outputs on the actual next Project, not old P.
      if (nextProject !== previousProject && !normalSaveAppAdapterRef.current!.owner.publishEdit(nextProject, historyDirtyShotIds(previousProject, nextProject, []))) {
        setStatus("Edit incomplete; workspace is not ready");
        return;
      }
    }
    setShotBitmapRevisionById((current) =>
      bumpShotBitmapRevisions(current, changedShotIds)
    );
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
    captureEnsureScope: () => normalSaveAppAdapterRef.current!.owner.captureEffectAdmission(),
    captureEffectCompletion: () => normalSaveAppAdapterRef.current!.owner.captureEffectCompletion(),
    isImageImportLocked,
    // Bind this render's destination as well as the existing load/Save generation.
    getWorkspaceIdentity: () => workspaceSession.identityForRender({ folderPath, metadataPath }),
    projectRef,
    folderPath,
    bitmapLayerWriteQueueRef,
    createTransparentLayerDataUrl,
    createHistoryEntry,
    getHistoryLayerAssets: entry => entry.layerAssets,
    rebaseAddHistoryEntry: (entry, project) => ({ ...entry, project }),
    recordUndoEntry,
    markShotsDirty,
    updateProject,
    setStatus
  });

  const { handleDeleteKeyPress } = useDeleteActionController({
    isImageImportLocked,
    deleteTargetRef,
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
    captureWorkspace: () => workspaceSession.capturePainting({ folderPath, metadataPath }),
    captureEffectCompletion: () => normalSaveAppAdapterRef.current!.owner.captureEffectCompletion(),
    projectRef,
    folderPath,
    bitmapLayerWriteQueueRef,
    createHistoryEntryFromLayerAssets,
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

  const normalSaveAppCallbacks = {
    captureSaveStatus: () => {
      const notice = autosaveError;
      return () => setAutosaveError(current => current === notice
        ? autosaveErrorReducer(current, { type: "saved" }) : current);
    },
    assertAdmission: () => {
      if (workspaceRecoveryRequiredRef.current) throw new Error(workspaceRecoveryRequiredRef.current);
      if (needsSwbImport) throw new Error("Import external changes before saving");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceSaveState("error");
      workspaceSaveStateRef.current = "error";
      setAutosaveError(current => autosaveErrorReducer(current, { type: "failed", message }));
      setSaveErrorDialog(message);
      setStatus(formatSaveFailureStatus(message));
      setWorkspaceTask(undefined);
    },
    onPendingPublication: ({ durable, namespace }: import("./normalSaveProjectOwner").PendingPublication) => {
      if (namespace) rebasePendingHistory(namespace.before, namespace.after, namespace.ids, namespace.update);
      setFileNameSyncState("unsynced");
      fileNameSyncStateRef.current = "unsynced";
      setWorkspaceSaveState(durable ? "saved" : "saving");
      workspaceSaveStateRef.current = durable ? "saved" : "saving";
      if (!durable) setAutosaveRevision(revision => revision + 1);
    },
    onSave: (saved: boolean) => {
      if (!saved) {
        setStatus("Save incomplete; newer edits or unknown output remain");
        setSaveErrorDialog("Save incomplete; newer edits or unknown output remain");
        return;
      }
      setWorkspaceSaveState("saved");
      workspaceSaveStateRef.current = "saved";
      setFileNameSyncState("synced");
      fileNameSyncStateRef.current = "synced";
      setStatus("Saved and synced file names");
      // Do not clear history or a newer producer's dirty state.
    }
  };
  const normalSaveAppCallbacksRef = useRef(normalSaveAppCallbacks);
  normalSaveAppCallbacksRef.current = normalSaveAppCallbacks;
  const normalSaveAppAdapterRef = useRef<ReturnType<typeof createNormalSaveAppAdapter> | undefined>(undefined);
  const readWorkspaceStatus = () => workspaceSession.status({
    metadataState: workspaceSaveState,
    message: status,
    project: projectRef.current
  });
  if (!normalSaveAppAdapterRef.current) {
    normalSaveAppAdapterRef.current = createNormalSaveAppAdapter({
      projectRef, setProject, queue: bitmapLayerWriteQueueRef.current,
      freshToken: () => crypto.randomUUID(), api: () => window.storyboard,
      paths: () => ({ folderPath: folderPathRef.current, metadataPath: metadataPathRef.current }),
      assertAdmission: () => normalSaveAppCallbacksRef.current.assertAdmission(),
      assertImportAdmission: () => { if (workspaceRecoveryRequiredRef.current) throw new Error(workspaceRecoveryRequiredRef.current); },
      onImportRecoveryRequired: (message, quiet) => {
        message = workspaceRecoveryRequiredRef.current ?? message;
        workspaceRecoveryRequiredRef.current = message;
        workspaceSaveStateRef.current = "error";
        if (quiet) return;
        setWorkspaceSaveState("error");
        setAutosaveError(current => autosaveErrorReducer(current, { type: "failed", message }));
        setSaveErrorDialog(message);
      },
      onError: error => normalSaveAppCallbacksRef.current.onError(error),
      onSave: saved => normalSaveAppCallbacksRef.current.onSave(saved),
      onPendingPublication: result => normalSaveAppCallbacksRef.current.onPendingPublication(result),
      onSaveNamespace: namespace => rebasePendingHistory(namespace.before, namespace.after, namespace.ids, namespace.update, true),
      captureSaveStatus: () => normalSaveAppCallbacksRef.current.captureSaveStatus(),
      onAutosave: () => {
        setWorkspaceSaveState("saved");
        setAutosaveError(current => autosaveErrorReducer(current, { type: "saved" }));
      }
    });
  }

  const persistWorkspace = async (
    projectToSave: Project,
    activeFolderPath = folderPath,
    activeMetadataPath = metadataPath
  ) => normalSaveAppAdapterRef.current!.autosave(projectToSave).then(() => undefined);

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

  const refreshExternalImportState = async () => {
    await refreshWorkspaceExternalImportState({
    api: window.storyboard,
    normalSaveRefresh: async (check, isCurrent) => {
        const adapter = normalSaveAppAdapterRef.current!, completion = adapter.owner.scriptCompletion;
        const accepted = await adapter.externalRefresh({
          check, isCurrent, blankShotPreset, dirtyShotIds: dirtyShotIds(), prepare: prepareNormalSaveImportMatte, published: normalSaveImageImportPublished,
          scriptPrepare: (...args) => prepareNormalSaveScriptMatte(...args), scriptPublished: (...args) => normalSaveScriptImportPublished(...args)
        });
        return { accepted, scriptImportNeeded: adapter.owner.scriptImportRemaining ? true :
          adapter.owner.scriptCompletion !== completion ? false : undefined };
      },
    checkIdRef: scriptImportCheckIdRef,
    folderPathRef,
    metadataPathRef,
    mergeExternalImageChanges,
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

  const publishNormalSaveFolderScan = (scan: FolderScanPayload, loaded: Project, nextStatus: string, resetDirtyShots: boolean, clearRecoveryRequired: boolean) => {
    aiApplyWorkspaceIdentityRef.current = {};
    scriptImportCheckIdRef.current += 1;
    folderPathRef.current = scan.folderPath; metadataPathRef.current = scan.metadataPath;
    setFolderPath(scan.folderPath); setFolderInputValue(scan.folderPath); setMetadataPath(scan.metadataPath);
    if (clearRecoveryRequired) workspaceRecoveryRequiredRef.current = undefined;
    setShotBitmapRevisionById(current => bumpWorkspaceShotBitmapRevisions(current, loaded));
    const obligations = Object.values(pendingBakeForProject(loaded).shots);
    const state = obligations.some(e => e.state === "unknown") ? "error" : obligations.some(e => e.state === "pending") ? "saving" : "saved";
    setWorkspaceSaveState(state); workspaceSaveStateRef.current = state;
    setFileNameSyncState("synced"); fileNameSyncStateRef.current = "synced";
    setScriptImportNeeded(Boolean(scan.scriptImportNeeded));
    resetHistoryStacks(); selectSingleShot(loaded.shots[0]?.id);
    if (resetDirtyShots) resetTrackedDirtyShots();
    setStatus(nextStatus); setWorkspaceTask(undefined);
  };
  const loadFolderScan = async (
    scan: FolderScanPayload,
    nextStatus: string,
    dirty = false,
    resetDirtyShots = true,
    clearRecoveryRequired = false
  ): Promise<Project | undefined> => {

      // Only completed owned operation snapshots reach this branch. Disk open uses
      // the reader form below, so no disk scan precedes old-I/O settlement.
      const loaded = await normalSaveAppAdapterRef.current!.load(async () => scan,
        (result, p) => publishNormalSaveFolderScan(result, p, nextStatus, resetDirtyShots, clearRecoveryRequired),
        { blankShotPreset, dirtyShotIds: dirtyShotIds(), prepare: prepareNormalSaveImportMatte, published: normalSaveImageImportPublished,
          scriptPrepare: (...args) => prepareNormalSaveScriptMatte(...args), scriptPublished: (...args) => normalSaveScriptImportPublished(...args) });
      return loaded ? projectRef.current : undefined;

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


      // Precise request scope: a newer open (same path or not) replaces the identity and rotates
      // the owner epoch, so this request's incomplete status must not be published into that new scope.
      const adapter = normalSaveAppAdapterRef.current!;
      let settled: { epoch: object; completed: boolean; project: Project } | undefined;
      try {
        const loaded = await adapter.load(
          () => window.storyboard.openFolderByPath(trimmedPath, { normalSave: true, initializePreviews: true }),
          (scan, project) => publishNormalSaveFolderScan(scan, project, "Folder opened; output compatibility checked", true, true),
          { blankShotPreset, dirtyShotIds: [], prepare: prepareNormalSaveImportMatte, published: normalSaveImageImportPublished,
          scriptPrepare: (...args) => prepareNormalSaveScriptMatte(...args), scriptPublished: (...args) => normalSaveScriptImportPublished(...args) },
          info => { settled = info; }
        );
        // A partial load (auto-import/migration refused) must not be presented as an opened,
        // ready workspace: the UI status reflects the incomplete result instead.
        if (!loaded && (!settled || adapter.owner.isRequestCurrent(settled.epoch))) setStatus("Open folder failed: output initialization incomplete");
      } catch (error) {
        if (!settled || adapter.owner.isRequestCurrent(settled.epoch)) setStatus(`Open folder failed: ${String(error)}`);
      }
      return;

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

    const request = ++storyboardScriptInspectRequestRef.current;
    const isCurrent = () => storyboardScriptInspectRequestRef.current === request;
    const result = await withStatus(
      "Storyboard script inspect failed",
      () => window.storyboard.inspectStoryboardScript(sourceMarkdownPath),
      (message) => { if (isCurrent()) setStatus(message); }
    );
    if (!isCurrent() || !result) {
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
    const initialDraft = storyboardScriptImportDraftRef.current;
    const request = storyboardScriptInspectRequestRef.current;
    const isCurrent = () => storyboardScriptImportDraftRef.current === initialDraft && storyboardScriptInspectRequestRef.current === request;
    if (!initialDraft) return;
    if (!window.storyboard) {
      setStatus("Cannot choose folder: Electron preload API is unavailable");
      return;
    }

    const selectedFolder = await withStatus(
      "Choose folder failed",
      () => window.storyboard.selectFolder(),
      (message) => { if (isCurrent()) setStatus(message); }
    );
    if (!isCurrent() || !selectedFolder) {
      return;
    }

    setStoryboardScriptImportDraft((draft) =>
      draft === initialDraft ? { ...initialDraft, targetFolderPath: selectedFolder } : draft
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


      const adapter = normalSaveAppAdapterRef.current!, draft = storyboardScriptImportDraft;
      const request = adapter.owner.capture();
      const isCurrent = () => storyboardScriptImportDraftRef.current === draft;
      setWorkspaceTask({ kind: "import", label: "Creating storyboard from script...", current: draft.entryCount, total: draft.entryCount });
      try {
        const created = await adapter.createFromScript({ sourceMarkdownPath: draft.sourceMarkdownPath, targetFolderPath,
          blankShotPreset, isCurrent, published: (scan, project) => {
            setStoryboardScriptImportDraft(undefined);
            publishNormalSaveFolderScan(scan, project, "Created storyboard from script", true, true);
          } });
        if (created) {
          const publishedEpoch = adapter.owner.capture().epoch;
          void window.storyboard.getRecentFolders?.().then(folders => {
            if (adapter.owner.isRequestCurrent(publishedEpoch)) setRecentFolders(folders);
          }).catch(() => undefined);
        }
      } finally {
        if (isCurrent() && adapter.owner.isRequestCurrent(request.epoch)) setWorkspaceTask(undefined);
      }
      return;

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


      if (projectRef.current !== project) return false;
      if (projectToSave !== project) normalSaveAppAdapterRef.current!.owner.publishEdit(projectToSave, []);
      return runExclusiveWorkspaceAction(saveInFlightRef, async () => {
        const operation = {};
        setWorkspaceTask({ operation, kind: "save", label: "Preparing save...", current: 0, total: 0 } as WorkspaceTask & { operation: object });
        try {
          return await normalSaveAppAdapterRef.current!.save();
        } finally {
          setWorkspaceTask(current => current && "operation" in current && current.operation === operation ? undefined : current);
        }
      });

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

  const publishNewShot = async (update: (p: Project) => Project, shotId: string, isCurrent: () => boolean) => {
        const published = await normalSaveAppAdapterRef.current!.owner.publishNewShot(update, shotId, isCurrent);
        if (published) updateProject(projectRef.current, true, false);
        return published;
      };

  const { handleAddShot } = useAddShotController({
    publishNewShot,
    beginAddShotOperation,
    isImageImportLocked,
    // Base api for folder ops. Effect calls use each Add's own bound operation api (returned by
    // beginAddShotOperation) so an interleaved newer Add cannot be borrowed. Token/H0 is
    // established by publishNewShot after matte completes.
    api: window.storyboard,
    blankShotPreset,
    captureWorkspace: workspaceSession.captureDestination,
    isCurrentWorkspace: workspaceSession.isCurrentDestination,
    createTransparentLayerDataUrl,
    folderPath,
    inheritSceneMatte: (baseProject, mode, shotIds, request) => window.storyboard
      ? prepareAddShotMatte(baseProject, mode, shotIds, request, {
          // The Add's own operation-scoped producer api for the provisional (new-shot-only) ensure.
          api: request.api ?? window.storyboard,
          queue: bitmapLayerWriteQueueRef.current
        })
      : Promise.resolve(undefined),
    loadFolderScan,
    markShotsDirty,
    metadataPath,
    // First-shot folder open: the owned readonly discovery + preview phase + current load,
    // in one place, without the retired raw open branch. Only a
    // fully completed load is adopted and the result is bound to the identity THIS load set.
    openOwnedFolder: async (target) => {
      const adapter = normalSaveAppAdapterRef.current!;
      let captured: FolderScanPayload | undefined;
      let identityAtPublish: object | undefined;
      let settled: { epoch: object; completed: boolean; project: Project } | undefined;
      const loaded = await adapter.load(
        () => window.storyboard.openFolderByPath(target, { normalSave: true, initializePreviews: true }),
        (scan, project) => {
          captured = scan;
          publishNormalSaveFolderScan(scan, project, "Folder opened; output compatibility checked", true, true);
          identityAtPublish = aiApplyWorkspaceIdentityRef.current;
        },
        { blankShotPreset, dirtyShotIds: dirtyShotIds(), prepare: prepareNormalSaveImportMatte, published: normalSaveImageImportPublished,
          scriptPrepare: (...args) => prepareNormalSaveScriptMatte(...args), scriptPublished: (...args) => normalSaveScriptImportPublished(...args) },
        info => { settled = info; }
      );
      // Adopt only a fully completed load whose OWN request epoch is still current, and return the
      // FINAL owner Project (post auto-import/migration) — never the initial scan snapshot, and
      // never a fresh ref re-captured after the await.
      if (!loaded || !captured || !identityAtPublish || !settled || !settled.completed) return undefined;
      if (!adapter.owner.isRequestCurrent(settled.epoch)) return undefined;
      return { identity: identityAtPublish, folderPath: captured.folderPath, metadataPath: captured.metadataPath, project: settled.project, loaded: true };
    },
    primarySelectedShotId,
    projectRef,
    selectSingleShot,
    setRecentFolders,
    setStatus,
    setWorkspaceTask,
    updateProject
  });


  const prepareNormalSaveImportMatte = async (p: Project, ids: string[], isCurrent: () => boolean, operation: import("./normalSaveAppAdapter").NormalSaveImportWorkspace): Promise<Project> => {
    // Derive scene configuration from the current original scene, excluding pristine
    // scanned shots that cannot yet carry its overlay. Never let the new image vote off.
    const original = normalSaveAppAdapterRef.current!.owner.capture().project;
    const scene = { ...original, shots: original.shots.filter(s => !ids.includes(s.id) || s.swb?.status !== "non-swb") };
    const mode = sceneMatteModeForProject(scene);
    if (!mode || !ids.length) return p;
    return prepareImportedImageMatte(p, mode, ids, {
      folderPath: operation.folderPath, metadataPath: operation.metadataPath, isCurrent,
      isWorkspaceCurrent: operation.isWorkspaceCurrent,
      setStatus, dialogueOverlayEnabled: sceneDialogueOverlayEnabledForProject(scene),
      onRecoveryRequired: message => {
        if (!operation.isWorkspaceCurrent()) return;
        workspaceRecoveryRequiredRef.current = message;
        normalSaveAppCallbacksRef.current.onError(new Error(message));
      }
    }, { api: window.storyboard, queue: { ...bitmapLayerWriteQueueRef.current, runExclusive: action => action() } });
  };
  // Script text Import keeps the legacy scene-inheritance behavior inside the single ordering
  // domain: genuinely new blank shots (and existing owned shots whose overlay no longer matches
  // the original scene) get a limited matte/dialogue preparation before the required persistence.
  // A pure text/order edit on a shot that already matches is never redrawn.
  const prepareNormalSaveScriptMatte = async (
    p: Project, newIds: string[], isCurrent: () => boolean, operation: import("./normalSaveAppAdapter").NormalSaveImportWorkspace,
    onPreparedAssets?: (ids: readonly string[]) => void
  ): Promise<Project> => {
    const original = normalSaveAppAdapterRef.current!.owner.capture().project;
    // The new blank shots cannot carry the scene overlay yet; never let them vote the mode off.
    const scene = { ...original, shots: original.shots.filter(s => !newIds.includes(s.id)) };
    const mode = sceneMatteModeForProject(scene);
    if (!mode) return p;
    const dialogueOverlayEnabled = sceneDialogueOverlayEnabledForProject(scene);
    const targetIds = p.shots.filter(shot => shot.swb?.status === "owned" &&
      (newIds.includes(shot.id) || !matteForShot(shot) ||
        dialogueOverlayEnabled !== bitmapLayersForShot(shot).some(layer => layer.id === dialogueOverlayBitmapLayerId))
    ).map(shot => shot.id);
    if (!targetIds.length) return p;
    return prepareImportedImageMatte(p, mode, targetIds, {
      folderPath: operation.folderPath, metadataPath: operation.metadataPath, isCurrent,
      isWorkspaceCurrent: operation.isWorkspaceCurrent, setStatus, dialogueOverlayEnabled,
      onPreparedAssets,
      onRecoveryRequired: message => {
        if (!operation.isWorkspaceCurrent()) return;
        workspaceRecoveryRequiredRef.current = message;
        normalSaveAppCallbacksRef.current.onError(new Error(message));
      }
    }, { api: window.storyboard, queue: { ...bitmapLayerWriteQueueRef.current, runExclusive: action => action() } });
  };
  const normalSaveImageImportPublished = (scan: FolderScanPayload, durable = true) => {
    const ids = [...new Set((scan.normalSaveImportEffects ?? []).flatMap(e => [e.sourceShotId, e.shotId]))];
    const paths = [...project.shots, ...(project.parkedShots ?? []), ...projectRef.current.shots, ...(projectRef.current.parkedShots ?? [])]
      .filter(s => ids.includes(s.id)).flatMap(s => (s.layers ?? []).map(l => l.bitmapPath));
    invalidatePresentationHistory(projectRef.current, ids, [...new Set(paths)]);
    normalSaveAppCallbacksRef.current.onPendingPublication({ durable });
    if (scan.normalSaveScriptInput !== undefined) {
      setScriptImportNeeded(true);
      setStatus("Image Import completed; storyboard script Import remains incomplete");
    } else setStatus(durable ? "Imported images into Storyboard Flow Format; output pending Save" : "Import output completed; newer edits await autosave, Save incomplete");
  };
  const normalSaveScriptImportPublished = (scan: FolderScanPayload, durable = true, changedAssetShotIds: string[] = []) => {
    // Script text Import changes the script-owned Project fields and, when preparation materializes
    // a scene matte on a genuinely new OR newly mismatched owned shot, that shot's internal PNG.
    // Reuse the approved image-Import History continuity policy for the changed shots so an old
    // History entry's metadata is never restored onto the new PNG. A pure text/order Import
    // changes no asset and reports no ids, so it never churns the stacks.
    const ids = [...new Set(changedAssetShotIds)];
    if (ids.length) {
      const paths = [...project.shots, ...(project.parkedShots ?? []), ...projectRef.current.shots, ...(projectRef.current.parkedShots ?? [])]
        .filter(s => ids.includes(s.id)).flatMap(s => (s.layers ?? []).map(l => l.bitmapPath));
      invalidatePresentationHistory(projectRef.current, ids, [...new Set(paths)]);
    }
    void scan;
    normalSaveAppCallbacksRef.current.onPendingPublication({ durable });
    setScriptImportNeeded(false);
    setStatus(durable ? "Imported storyboard script changes; output pending Save" : "Script Import completed; newer edits await autosave, Save incomplete");
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

    if (needsImageImport) {
      setIsImportHelpOpen(false);
      const operation = {};
      const task: WorkspaceTask & { operation: object } = { operation, kind: "import", label: "Importing workspace changes...", current: 0,
        total: [...project.shots, ...(project.parkedShots ?? [])].filter(shot => shot.swb?.status !== "owned").length || project.shots.length };
      setWorkspaceTask(task);
      try {
        return await normalSaveAppAdapterRef.current!.imageImport({
          blankShotPreset, dirtyShotIds: dirtyShotIds(),
          prepare: prepareNormalSaveImportMatte,
          published: normalSaveImageImportPublished,
          scriptPrepare: (...args) => prepareNormalSaveScriptMatte(...args),
          scriptPublished: (...args) => normalSaveScriptImportPublished(...args)
        });
      } finally {
        // Do not clear a newer workspace operation's progress on late completion.
        setWorkspaceTask(current => current && "operation" in current && current.operation === operation ? undefined : current);
      }
    }

    if (scriptImportNeeded && !needsImageImport) {
      // Script-only Import: the parsed storyboard-script.md is applied by the owner in the
      // existing single ordering domain (capture → execution recheck → real main read/parse/
      // merge → latest-Project merge + required JSON/MD → publication → release). It never
      // falls back to the legacy direct call + full folder rescan.
      setIsImportHelpOpen(false);
      return normalSaveAppAdapterRef.current!.scriptImport({
        blankShotPreset, dirtyShotIds: dirtyShotIds(),
        prepare: prepareNormalSaveScriptMatte,
        published: normalSaveScriptImportPublished
      });
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
    captureEnsureScope: () => normalSaveAppAdapterRef.current!.owner.captureAssetScope(),
    isImageImportLocked,
    api: typeof window === "undefined" ? undefined : normalSaveAssetApi,
    captureWorkspace: workspaceSession.captureDestination,
    isCurrentWorkspace: workspaceSession.isCurrentDestination,
    refreshHistoryEntry: (entry) => createHistoryEntryFromLayerAssets(entry.layerAssets),
    bitmapLayerWriteQueueRef,
    clipboardSelectionRef,
    publishNewShot,
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
    isImageImportLocked,
    activeSketchTool,
    isAddShotMenuOpen,
    isAnimationMode,
    isImportHelpOpen,
    isRecentMenuOpen,
    isSaveMenuOpen,
    orderedShots,
    selectedBitmapLayerIdsRef,
    selectedShotIdsRef,
    navigateShotSelection,
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

  const pendingTransition = useCallback(
    (kind: "park" | "restore", update: (project: Project) => Project, shotIds: string[]) =>
      normalSaveAppAdapterRef.current!.pending(kind, update, shotIds),
    []
  );
  const { handleDragEnd } = useStoryboardDragEndController({
    pendingTransition,
    capturePendingScope: () => {
      const adapter = normalSaveAppAdapterRef.current!, capture = adapter.owner.capture();
      const folder = folderPathRef.current, metadata = metadataPathRef.current;
      return () => adapter.owner.capture().epoch === capture.epoch && folderPathRef.current === folder && metadataPathRef.current === metadata;
    },
    pendingVersion: () => normalSaveAppAdapterRef.current!.owner.capture().sequence,
    flushInsertionTargetsFromDragEnd,
    inheritSceneMatte: (baseProject, mode, shotIds, options) => {
      const expectedProject = projectRef.current;
      return (
        sceneMatteInheritanceRef.current?.(baseProject, mode, shotIds, {
          ...options,
          dialogueOverlayEnabled:
            options?.dialogueOverlayEnabled ?? sceneDialogueOverlayEnabledForProject(expectedProject),
          expectedProject
        }) ?? Promise.resolve(false)
      );
    },
    isDragEndInsideParkingShelf: (event) =>
      dragEndInsideSelector(event, ".parking-shelf.is-open", lastPointerPositionRef.current),
    isDragEndPointerInsideStoryboard: () => {
      const pointer = lastPointerPositionRef.current;
      return pointer ? isPointerInsideElement(document.querySelector(".workspace-board-scroll"), pointer) : false;
    },
    isDragEndInsideStoryboard: (event) =>
      dragEndInsideSelector(event, ".workspace-board-scroll", lastPointerPositionRef.current),
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
    activeShotCount:
      activeShotIds.length +
      activeParkedShotIds.length,
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
          bitmapRevisionByShotId={shotBitmapRevisionById}
          variant="thumbnail"
        />
      ) : null}
      {!activeDialogue && dragPreviewShotIds.length === 0 && activeParkedShotIds.length > 0 ? (
        <ShotStackPreview
          shots={parkedShots.filter((shot) => activeParkedShotIds.includes(shot.id))}
          folderPath={folderPath}
          bitmapRevisionByShotId={shotBitmapRevisionById}
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
    invalidatePresentationHistory: invalidatePresentationHistory,
    captureEnsureScope: () => normalSaveAppAdapterRef.current!.owner.captureAssetScope(),
    isEffectAdmissible: () => normalSaveAppAdapterRef.current!.owner.captureEffectAdmission()(),
    api: normalSaveAssetApi,
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



  const selectShotForCard = useStableEvent(
    (shotId: string, event: React.MouseEvent<HTMLElement>) =>
      handleShotSelect(shotId, event)
  );
  const focusShotForCanvas = useStableEvent((shotId: string) => {
    selectSingleShot(shotId);
    if (deleteTargetRef.current.type !== "shot") {
      setDeleteTarget({ type: "shot" });
    }
    if (selectedBitmapLayerIdsRef.current) {
      selectedBitmapLayerIdsRef.current = undefined;
      setSelectedBitmapLayerIds(undefined);
    }
  });
  const toggleLayerPanel = useStableEvent((shotId: string) =>
    toggleLayerPanelForShot(shotId)
  );
  const addBitmapLayer = useStableEvent((shotId: string) => {
    void handleAddBitmapLayer(shotId);
  });
  const removeBitmapLayer = useStableEvent((shotId: string, layerId: string) => {
    void handleRemoveBitmapLayer(shotId, layerId);
  });
  const mergeBitmapLayers = useStableEvent(
    (shotId: string, layerId: string, selectedLayerIds: string[]) => {
      void handleMergeBitmapLayers(shotId, layerId, selectedLayerIds);
    }
  );
  const mergeVisibleBitmapLayers = useStableEvent((shotId: string) => {
    void handleMergeVisibleBitmapLayers(shotId);
  });
  const clearBitmapLayer = useStableEvent((shotId: string, layerId: string) => {
    void handleClearBitmapLayer(shotId, layerId);
  });
  const selectBitmapLayer = useStableEvent(handleSelectLayer);
  const updateBitmapLayer = useStableEvent(handleUpdateLayer);
  const moveBitmapLayer = useStableEvent(handleMoveLayer);
  const moveBitmapLayerGroup = useStableEvent(handleMoveLayerGroup);
  const updateSelectedBitmapLayerIds = useStableEvent(handleSelectedBitmapLayerIdsChange);
  const updateBitmapLayerGroupOpacity = useStableEvent(handleUpdateLayerGroupOpacity);
  const createShotDialogue = useStableEvent(handleCreateDialogue);
  const updateDialogueText = useStableEvent(handleDialogueText);
  const blurDialogue = useStableEvent(handleDialogueBlur);
  const paintBitmapStroke = useStableEvent(handleBitmapStroke);
  const transformBitmapSelection = useStableEvent(handleBitmapSelectionTransform);
  const fillBitmapLayer = useStableEvent(handleBitmapFill);
  const updateShotScriptText = useStableEvent(handleShotScriptText);
  const updateShotDialogueText = useStableEvent(handleShotDialogueText);
  const closeSketchRadialMenu = useStableEvent(closeRadialToolMenu);
  const selectTimelineShot = useStableEvent((shotId: string) => {
    selectSingleShot(shotId);
    setDeleteTarget({ type: "shot" });
    if (selectedBitmapLayerIdsRef.current) {
      selectedBitmapLayerIdsRef.current = undefined;
      setSelectedBitmapLayerIds(undefined);
    }
  });
  const workspaceBoardScrollClassName = `workspace-board-scroll ${
    isSpacePanActive ? "is-space-pan-active" : ""
  } ${isBoardPanning ? "is-space-panning" : ""}`;
  const parkingShelfElement = (
    <SortableContext
      items={[
        ...parkedShots.map((shot) => `parked-${shot.id}`)
      ]}
      strategy={rectSortingStrategy}
    >
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
        handleTogglePendingShelf={handleTogglePendingShelf}
        hasSwbWarning={hasSwbWarning}
        importHelpRef={importHelpRef}
        isAddShotMenuOpen={isAddShotMenuOpen}
        isImportHelpOpen={isImportHelpOpen}
        isImportLocked={isImportLocked}
        isImportNudging={isImportNudging}
        isMatteMenuOpen={isMatteMenuOpen}
        isParkingShelfOpen={isParkingShelfOpen}
        isRecentMenuOpen={isRecentMenuOpen}
        isSaveEmphasized={isSaveEmphasized || readWorkspaceStatus().state !== "saved"}
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
        onCancel={() => {
          setStoryboardScriptImportDraft(undefined);
          setWorkspaceTask(task => task?.kind === "import" ? undefined : task);
        }}
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
            <StoryboardMediaWindowProvider
              interactionController={storyboardMediaWindowInteractionController}
              rootRef={workspaceBoardScrollRef}
              scopeKey="storyboard"
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
                    {folderPath && orderedShots.length === 0 ? <EmptyStoryboardDropZone /> : null}
                    {renderedShotEntries.map((entry) => {
                      const { shot, index } = entry;
                      const previousOnionShot =
                        isAnimationMode && shot.id === primarySelectedShotId
                          ? onionSkinNeighbors.previous
                          : undefined;
                      const nextOnionShot =
                        isAnimationMode && shot.id === primarySelectedShotId
                          ? onionSkinNeighbors.next
                          : undefined;
                      return (
                        <ShotCard
                          key={shot.id}
                          shot={shot}
                          index={index}
                          dialogues={dialogueByShotId.get(shot.id) ?? emptyDialogueList}
                          folderPath={folderPath}
                          isSelected={selectedShotIds.length > 1 && selectedShotIdSet.has(shot.id)}
                          isPrimarySelected={shot.id === primarySelectedShotId}
                          isAnimationFocused={isAnimationMode && shot.id === primarySelectedShotId}
                          isZoomScrubbing={isZoomScrubbing}
                          disableSortableTransform={activeShotIds.length > 0}
                          keepDraggingSourceVisible={activeShotIdSet.has(shot.id)}
                          activeDragType={activeDragType}
                          activeSketchTool={activeSketchTool}
                          brushColor={brushColor}
                          brushOpacity={brushOpacity}
                          brushSize={brushSize}
                          brushSoftness={brushSoftness}
                          eraserOpacity={eraserOpacity}
                          eraserSize={eraserSize}
                          eraserSoftness={eraserSoftness}
                          onionSkinPreviousShot={previousOnionShot}
                          onionSkinNextShot={nextOnionShot}
                          onionSkinPreviousRevision={
                            previousOnionShot
                              ? shotBitmapRevisionById[previousOnionShot.id] ?? 0
                              : undefined
                          }
                          onionSkinNextRevision={
                            nextOnionShot
                              ? shotBitmapRevisionById[nextOnionShot.id] ?? 0
                              : undefined
                          }
                          editingDialogueId={editingDialogueId}
                          onSelect={selectShotForCard}
                          onFocusShot={focusShotForCanvas}
                          isLayerPanelOpen={isLayerPanelOpenForShot(
                            isLayerPanelOpen,
                            shot.id,
                            primarySelectedShotId
                          )}
                          onToggleLayerPanel={toggleLayerPanel}
                          bitmapRevision={shotBitmapRevisionById[shot.id] ?? 0}
                          onAddLayer={addBitmapLayer}
                          onRemoveLayer={removeBitmapLayer}
                          onMergeLayers={mergeBitmapLayers}
                          onMergeVisibleLayers={mergeVisibleBitmapLayers}
                          onClearLayer={clearBitmapLayer}
                          onSelectLayer={selectBitmapLayer}
                          onUpdateLayer={updateBitmapLayer}
                          onMoveLayer={moveBitmapLayer}
                          onMoveLayerGroup={moveBitmapLayerGroup}
                          onSelectedLayerIdsChange={updateSelectedBitmapLayerIds}
                          onUpdateLayerGroupOpacity={updateBitmapLayerGroupOpacity}
                          onCreateDialogue={createShotDialogue}
                          onDialogueText={updateDialogueText}
                          onDialogueBlur={blurDialogue}
                          onSketchStroke={paintBitmapStroke}
                          onSelectionTransform={transformBitmapSelection}
                          onBitmapSelectionChange={handleBitmapSelectionChange}
                          onFill={fillBitmapLayer}
                          onPickColor={setBrushColor}
                          onSketchBeginInteraction={closeSketchRadialMenu}
                        />
                      );
                    })}
                    {storyboardInsertionIndicatorElement}
                  </section>
                </SortableContext>
              </div>
            </StoryboardMediaWindowProvider>
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
            <StoryboardMediaWindowProvider
              interactionController={storyboardMediaWindowInteractionController}
              rootRef={workspaceBoardScrollRef}
              scopeKey="japanese-storyboard"
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
                    bitmapRevisionByShotId={shotBitmapRevisionById}
                    isZoomScrubbing={isZoomScrubbing}
                    marquee={
                      <>
                        {folderPath && orderedShots.length === 0 ? <EmptyStoryboardDropZone /> : null}
                        {storyboardInsertionIndicatorElement}
                      </>
                    }
                    onPointerDown={handleSelectionPointerDown}
                    project={project}
                    selectedShotIds={selectedShotIds}
                    zoomLevel={zoomLevel}
                    onActionText={updateShotScriptText}
                    onDialogueText={updateShotDialogueText}
                    onFill={fillBitmapLayer}
                    onFocusShot={focusShotForCanvas}
                    onPickColor={setBrushColor}
                    onSelectShot={selectShotForCard}
                    onSelectionTransform={transformBitmapSelection}
                    onBitmapSelectionChange={handleBitmapSelectionChange}
                    onSketchBeginInteraction={closeSketchRadialMenu}
                    onSketchStroke={paintBitmapStroke}
                  />
                </SortableContext>
              </div>
            </StoryboardMediaWindowProvider>
            {parkingShelfElement}
            {storyboardDragOverlay}
          </DndContext>
        )}
        <SelectionMarquee ref={selectionMarqueeRef} />
        {isImportLocked ? (
          <button
            type="button"
            className="workspace-import-lock"
            onClick={nudgeImportRequired}
            aria-label={IMPORT_REQUIRED_HELP.title}
          />
        ) : null}
      </div>

      {isAnimationMode && orderedShots.length > 0 ? (
        <Timeline
          folderPath={folderPath}
          thumbnailRevisionByShotId={shotBitmapRevisionById}
          shots={orderedShots}
          selectedShotIds={selectedShotIds}
          onSelect={selectTimelineShot}
        />
      ) : null}

      {!folderPath && orderedShots.length === 0 ? (
        <section className="empty-state">
          <h2>Paste a folder path to start arranging the board.</h2>
          <p>V1 keeps the workflow narrow: order shots, move dialogue, and draw rough notes.</p>
        </section>
      ) : null}
      <StatusPopover
        readWorkspaceStatus={readWorkspaceStatus}
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
        <span className="selected-count" ref={selectedShotCountLabelRef}>
          {selectedShotIds.length} selected
        </span>
      </footer>
    </main>
  );
};
