import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  addBitmapLayer,
  addDialogue,
  addGeneratedShot,
  applyRenamePlan,
  createProject,
  createRenamePlan,
  defaultProjectNaming,
  defaultSaveNaming,
  bitmapLayersForShot,
  clearBitmapLayer,
  copyBitmapLayerToShot,
  copyDialogueToShot,
  deleteShots,
  deleteBitmapLayer,
  duplicateShotAfter,
  ensureBitmapLayerMetadata,
  getNextStoryboardIndex,
  imageBitmapLayerId,
  markBitmapLayerPainted,
  mergeBitmapLayerDown,
  mergeExternalImageChanges,
  mergeSelectedBitmapLayers,
  mergeVisibleBitmapLayers,
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
import type {
  BitmapLayer,
  Dialogue,
  FolderScanPayload,
  Project,
  ProjectNaming,
  Shot,
  BlankShotPreset,
  SketchStroke,
  SketchTool
} from "../shared/types";
import { getAnimationViewport, getStableBoardTop, maxStoryboardZoom } from "./animationViewport";
import {
  activeVisibleBitmapLayerForShot,
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
import { DialoguePreview, ShotStackPreview } from "./DragPreviews";
import {
  resolveDeleteTarget,
  type DeleteTarget
} from "./deleteTarget";
import {
  defaultKeyboardShortcuts,
  duplicateShortcutValues,
  formatShortcutFromKeyboardEvent,
  historyActionFromKeyboardEvent,
  keyboardEventMatchesShortcut,
  normalizeKeyboardShortcuts,
  shortcutActions,
  type KeyboardShortcuts,
  type ShortcutAction
} from "./keyboardShortcuts";
import { BrushIcon, ClearIcon, EraserIcon, GearIcon, SelectIcon, SidePanelIcon } from "./icons";
import { getOnionSkinNeighbors } from "./onionSkin";
import { SelectionMarquee } from "./SelectionMarquee";
import { ParkingShelf } from "./ParkingShelf";
import { BrushSwatchPicker, SketchSettingSlider } from "./SketchSettingsControls";
import { ShotCard, type CardFace } from "./ShotCard";
import { Timeline } from "./Timeline";
import { formatSaveFailureStatus } from "./saveErrors";
import {
  createMarqueeBox,
  marqueeEdgeScrollDelta,
  shotIdsInMarqueeBox,
  updateMarqueeBox,
  type MarqueeBox
} from "./storyboardMarquee";
import {
  canvasSizeForShot,
  drawImageUrl,
  drawStrokePathOnCanvas,
  shouldDrawStrokeToBitmapLayer
} from "./sketchRendering";
import { sketchCanvasSize } from "./sketchGeometry";
import {
  dragPreviewShotIds as chooseDragPreviewShotIds,
  type DragData
} from "./storyboardDnd";
import { scrollDeltaToCenterInReservedViewport } from "./viewportGeometry";

const defaultBrushColor = "#f05a28";
const defaultBrushSwatches = ["#f05a28", "#1f6f62", "#2d6cdf", "#f3c14b", "#211f1a"];
const defaultBrushSize = 4;
const defaultEraserSize = 18;
const maxUndoHistory = 60;
const blankShotPresets: Array<{ id: BlankShotPreset; label: string; detail: string }> = [
  { id: "16:9", label: "16:9", detail: "1920 x 1080" },
  { id: "2.39:1", label: "2.39:1", detail: "2581 x 1080" },
  { id: "1.43:1", label: "1.43:1 IMAX", detail: "1544 x 1080" }
];
const autosaveDelayMs = 600;
const animationReservedBottom = 180;
const animationViewportMargin = 14;

const projectChangedDuringLoad = (before: Project, after: Project): boolean => {
  if (before.shots.length !== after.shots.length) {
    return true;
  }

  const beforeShotsById = new Map(before.shots.map((shot) => [shot.id, shot]));
  return after.shots.some((afterShot) => {
    const beforeShot = beforeShotsById.get(afterShot.id);
    return (
      !beforeShot ||
      beforeShot.previewPath !== afterShot.previewPath ||
      beforeShot.fileName !== afterShot.fileName ||
      beforeShot.activeLayerId !== afterShot.activeLayerId ||
      JSON.stringify(beforeShot.layers ?? []) !== JSON.stringify(afterShot.layers ?? []) ||
      JSON.stringify(beforeShot.sketchLayers ?? []) !== JSON.stringify(afterShot.sketchLayers ?? [])
    );
  });
};

const ensureProjectBitmapMetadata = (project: Project): Project => ({
  ...project,
  shots: project.shots.map((shot) => ensureBitmapLayerMetadata(shot)),
  parkedShots: project.parkedShots?.map((shot) => ensureBitmapLayerMetadata(shot))
});

type WorkspaceSaveState = "saved" | "saving" | "error";
type FileNameSyncState = "synced" | "unsynced";
type WorkspaceTask = {
  kind: "save" | "import" | "open";
  label: string;
  current: number;
  total: number;
};
type SketchSettingsMenu = { tool: SketchTool; x: number; y: number };
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
type CopyDragState =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "layer"; shotId: string; layerId: string };
type SelectedBitmapLayerIds = { shotId: string; layerIds: string[] };

const sameLayerSelection = (
  current: SelectedBitmapLayerIds | undefined,
  shotId: string,
  layerIds: string[]
) =>
  current?.shotId === shotId &&
  current.layerIds.length === layerIds.length &&
  current.layerIds.every((layerId, index) => layerId === layerIds[index]);

const shortcutLabels: Array<{ action: ShortcutAction; label: string }> = [
  { action: "brush", label: "Brush" },
  { action: "eraser", label: "Eraser" },
  { action: "select", label: "Select" },
  { action: "clearLayer", label: "Clear layer" },
  { action: "mergeDown", label: "Merge" },
  { action: "save", label: "Save" },
  { action: "addShot", label: "Add Shot" },
  { action: "onionSkin", label: "Onion Skin" },
  { action: "previousShot", label: "Previous shot" },
  { action: "nextShot", label: "Next shot" },
  { action: "undo", label: "Undo" },
  { action: "redo", label: "Redo" }
];

const isKeyboardEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest("textarea, select")) {
    return true;
  }

  const input = target.closest("input");
  if (!input) {
    return false;
  }

  return !["button", "checkbox", "color", "file", "radio", "submit"].includes(input.type);
};

const isRangeInputTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const input = target.closest("input");
  return input?.type === "range";
};

const hasOpenShortcutBlockingMenu = (): boolean =>
  Boolean(
    document.querySelector(
      ".shortcut-menu, .save-menu, .recent-menu, .add-shot-menu, .sketch-settings-menu"
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

const visibleLayerBelow = (
  layers: BitmapLayer[],
  sourceLayerId: string
): BitmapLayer | undefined => {
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceLayerId);
  if (sourceIndex <= 0) {
    return undefined;
  }

  return [...layers.slice(0, sourceIndex)].reverse().find((layer) => layer.visible);
};

const shouldIgnoreWorkbenchWheel = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "input, textarea, select, .recent-menu, .add-shot-menu, .save-menu, .sketch-settings-menu, .shortcut-menu, .layer-panel"
    )
  );

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

const isCopyModifierEvent = (event: Event): boolean => {
  return "altKey" in event && Boolean(event.altKey);
};

export const App = () => {
  const [project, setProject] = useState<Project>(() => createProject("Untitled Storyboard"));
  const [folderPath, setFolderPath] = useState<string | undefined>();
  const [folderInputValue, setFolderInputValue] = useState("");
  const [metadataPath, setMetadataPath] = useState<string | undefined>();
  const [activeDialogue, setActiveDialogue] = useState<Dialogue | undefined>();
  const [activeShotIds, setActiveShotIds] = useState<string[]>([]);
  const [dragPreviewShotIds, setDragPreviewShotIds] = useState<string[]>([]);
  const [copyShotDropTargetId, setCopyShotDropTargetId] = useState<string | undefined>();
  const [activeParkedShotIds, setActiveParkedShotIds] = useState<string[]>([]);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [activeSketchTool, setActiveSketchTool] = useState<SketchTool>("brush");
  const [brushColor, setBrushColor] = useState(defaultBrushColor);
  const [brushSwatches, setBrushSwatches] = useState(defaultBrushSwatches);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSize, setBrushSize] = useState(defaultBrushSize);
  const [eraserSize, setEraserSize] = useState(defaultEraserSize);
  const [eraserOpacity, setEraserOpacity] = useState(1);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<WorkspaceSaveState>("saved");
  const [workspaceTask, setWorkspaceTask] = useState<WorkspaceTask | undefined>();
  const [fileNameSyncState, setFileNameSyncState] = useState<FileNameSyncState>("synced");
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isAnimationMode, setIsAnimationMode] = useState(false);
  const [isOnionSkinEnabled, setIsOnionSkinEnabled] = useState(false);
  const [animationImageSize, setAnimationImageSize] = useState({ width: 430, height: 271 });
  const [animationFrameSize, setAnimationFrameSize] = useState({ width: 430, height: 271 });
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [editingDialogueId, setEditingDialogueId] = useState<string | undefined>();
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const [isRecentMenuOpen, setIsRecentMenuOpen] = useState(false);
  const [isAddShotMenuOpen, setIsAddShotMenuOpen] = useState(false);
  const [blankShotPreset, setBlankShotPreset] = useState<BlankShotPreset>("16:9");
  const [sketchSettingsMenu, setSketchSettingsMenu] = useState<SketchSettingsMenu | undefined>();
  const [isStatusPanelOpen, setIsStatusPanelOpen] = useState(false);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [isShortcutMenuOpen, setIsShortcutMenuOpen] = useState(false);
  const [isImportHelpOpen, setIsImportHelpOpen] = useState(false);
  const [isImportNudging, setIsImportNudging] = useState(false);
  const [cardFace, setCardFace] = useState<CardFace>("image");
  const [scriptImportNeeded, setScriptImportNeeded] = useState(false);
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(defaultKeyboardShortcuts);
  const [capturingShortcutAction, setCapturingShortcutAction] = useState<ShortcutAction | undefined>();
  const [shortcutError, setShortcutError] = useState("");
  const [autosaveError, setAutosaveError] = useState<AutosaveErrorNotice | undefined>();
  const [saveErrorDialog, setSaveErrorDialog] = useState<string | undefined>();
  const [storyboardScriptImportDraft, setStoryboardScriptImportDraft] =
    useState<StoryboardScriptImportDraft | undefined>();
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [selectionBox, setSelectionBox] = useState<MarqueeBox | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>({ type: "shot" });
  const [selectedBitmapLayerIds, setSelectedBitmapLayerIds] = useState<SelectedBitmapLayerIds | undefined>();
  const [isParkingShelfOpen, setIsParkingShelfOpen] = useState(false);
  const [copyDrag, setCopyDrag] = useState<CopyDragState | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const selectionBoxRef = useRef<MarqueeBox | undefined>(undefined);
  const projectRef = useRef(project);
  const folderPathRef = useRef(folderPath);
  const metadataPathRef = useRef(metadataPath);
  const scriptImportCheckIdRef = useRef(0);
  const dirtyShotIdsRef = useRef<Set<string>>(new Set());
  const selectedBitmapLayerIdsRef = useRef<SelectedBitmapLayerIds | undefined>(undefined);
  const copyDragRef = useRef<CopyDragState | undefined>(undefined);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const workspaceSaveStateRef = useRef<WorkspaceSaveState>(workspaceSaveState);
  const fileNameSyncStateRef = useRef<FileNameSyncState>(fileNameSyncState);
  const selectedShotIdsRef = useRef<string[]>([]);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const bitmapLayerWriteQueueRef = useRef(createBitmapLayerWriteQueue());
  const saveMenuRef = useRef<HTMLDivElement | null>(null);
  const recentMenuRef = useRef<HTMLDivElement | null>(null);
  const addShotMenuRef = useRef<HTMLDivElement | null>(null);
  const shortcutMenuRef = useRef<HTMLDivElement | null>(null);
  const importHelpRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLElement | null>(null);
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
  const onionSkinNeighbors = useMemo(
    () => getOnionSkinNeighbors(orderedShots, primarySelectedShotId, isAnimationMode && isOnionSkinEnabled),
    [isAnimationMode, isOnionSkinEnabled, orderedShots, primarySelectedShotId]
  );

  useEffect(() => {
    const element = appShellRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: globalThis.WheelEvent) => {
      if (shouldIgnoreWorkbenchWheel(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setZoomLevel((current) => {
        const direction = event.deltaY < 0 ? 1 : -1;
        const nextZoom = Math.round(current / 5) * 5 + direction * 5;
        return Math.min(maxStoryboardZoom, Math.max(25, nextZoom));
      });
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    selectedShotIdsRef.current = selectedShotIds;
  }, [selectedShotIds]);

  useEffect(() => {
    selectedBitmapLayerIdsRef.current = selectedBitmapLayerIds;
  }, [selectedBitmapLayerIds]);

  const handleSelectedBitmapLayerIdsChange = useCallback((shotId: string, layerIds: string[]) => {
    setSelectedBitmapLayerIds((current) =>
      sameLayerSelection(current, shotId, layerIds) ? current : { shotId, layerIds }
    );
  }, []);

  useEffect(() => {
    folderPathRef.current = folderPath;
  }, [folderPath]);

  useEffect(() => {
    metadataPathRef.current = metadataPath;
  }, [metadataPath]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

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
    fileNameSyncStateRef.current = fileNameSyncState;
  }, [fileNameSyncState]);

  useEffect(() => {
    workspaceSaveStateRef.current = workspaceSaveState;
  }, [workspaceSaveState]);

  useEffect(() => {
    let isMounted = true;

    window.storyboard
      .getKeyboardShortcuts()
      .then((shortcuts) => {
        if (isMounted) {
          setKeyboardShortcuts(normalizeKeyboardShortcuts(shortcuts));
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Keyboard shortcuts unavailable: ${message}`);
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
    if (!isShortcutMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
      if (!shortcutMenuRef.current?.contains(event.target as Node)) {
        setIsShortcutMenuOpen(false);
        setShortcutError("");
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (capturingShortcutAction) {
        return;
      }

      if (event.key === "Escape") {
        setIsShortcutMenuOpen(false);
        setShortcutError("");
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [capturingShortcutAction, isShortcutMenuOpen]);

  useEffect(() => {
    if (!isSaveMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
      if (!saveMenuRef.current?.contains(event.target as Node)) {
        setIsSaveMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSaveMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSaveMenuOpen]);

  useEffect(() => {
    if (!isRecentMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
      if (!recentMenuRef.current?.contains(event.target as Node)) {
        setIsRecentMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsRecentMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRecentMenuOpen]);

  useEffect(() => {
    if (!isAddShotMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!addShotMenuRef.current?.contains(event.target as Node)) {
        setIsAddShotMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAddShotMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAddShotMenuOpen]);

  useEffect(() => {
    if (!isImportHelpOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!importHelpRef.current?.contains(event.target as Node)) {
        setIsImportHelpOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImportHelpOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImportHelpOpen]);

  useEffect(() => {
    if (!sketchSettingsMenu) {
      return;
    }

    const handlePointerDown = () => {
      setSketchSettingsMenu(undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSketchSettingsMenu(undefined);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sketchSettingsMenu]);

  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);

    const removeOpenListener = window.storyboard.onOpenRecentFolder((nextFolderPath) => {
      setFolderInputValue(nextFolderPath);
      void handleOpenFolderByPath(nextFolderPath);
    });
    const removeChangedListener = window.storyboard.onRecentFoldersChanged(setRecentFolders);
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
    if (autosaveRevision === 0 || !activeFolderPath || !activeMetadataPath || !window.storyboard) {
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
      hasUnsavedChanges:
        dirtyShotIdsRef.current.size > 0 ||
        workspaceSaveState !== "saved" ||
        fileNameSyncState !== "synced"
    });
  }, [fileNameSyncState, project, workspaceSaveState]);

  useEffect(() => {
    selectionBoxRef.current = selectionBox;
  }, [selectionBox]);

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
    const board = boardGridRef.current;
    const firstShot = board?.querySelector<HTMLElement>("[data-shot-id]");

    if (!board || !firstShot) {
      setIsAnimationMode(false);
      return;
    }

    const boardRect = board.getBoundingClientRect();
    const viewportShot = primarySelectedShot ?? orderedShots[0];
    const viewport = getAnimationViewport({
      boardWidth: boardRect.width,
      boardTop: getStableBoardTop(boardRect.top, window.scrollY),
      viewportHeight: window.innerHeight,
      reservedBottom: animationReservedBottom,
      margin: animationViewportMargin,
      zoomLevel,
      maxZoomLevel: maxStoryboardZoom,
      isAnimationMode,
      imageAspectRatio: viewportShot ? aspectRatioForShot(viewportShot) : 420 / 265
    });
    setIsAnimationMode(viewport.isAnimationMode);
    setAnimationImageSize({ width: viewport.imageWidth, height: viewport.imageHeight });
    setAnimationFrameSize({ width: viewport.frameWidth, height: viewport.frameHeight });
  }, [isAnimationMode, orderedShots, primarySelectedShot, zoomLevel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureAnimationMode);
    window.addEventListener("resize", measureAnimationMode);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureAnimationMode);
    };
  }, [measureAnimationMode, orderedShots.length, zoomLevel]);

  useEffect(() => {
    if (!isAnimationMode || !selectedShotIds[0]) {
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
        height: window.innerHeight,
        reservedBottom,
        margin: animationViewportMargin
      }
    );

    if (delta !== 0) {
      window.scrollBy({ top: delta, behavior: "instant" });
    }
  }, [animationImageSize.height, animationImageSize.width, isAnimationMode, selectedShotIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isMenuOpen =
        isShortcutMenuOpen ||
        isSaveMenuOpen ||
        isRecentMenuOpen ||
        isAddShotMenuOpen ||
        isImportHelpOpen ||
        Boolean(sketchSettingsMenu) ||
        hasOpenShortcutBlockingMenu();
      if (isMenuOpen) {
        return;
      }

      const key = event.key.toLowerCase();
      const configuredShortcutAction = shortcutActions.find((action) =>
        keyboardEventMatchesShortcut(event, keyboardShortcuts[action])
      );
      const shortcutAction = configuredShortcutAction ?? historyActionFromKeyboardEvent(event);
      const allowsRangeTarget =
        isAnimationMode &&
        isRangeInputTarget(target) &&
        (shortcutAction === "previousShot" || shortcutAction === "nextShot");

      if (isKeyboardEditableTarget(target) && !allowsRangeTarget) {
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
          return [orderedShots[nextIndex].id];
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
    keyboardShortcuts,
    measureGridColumns,
    orderedShots,
    primarySelectedShot,
    sketchSettingsMenu
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
    setSelectedShotIds(nextSelectedShot ? [nextSelectedShot.id] : []);
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
      setSelectedShotIds(previous.selectedShotIds);
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
      setSelectedShotIds(next.selectedShotIds);
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
    if (dirtyShotIdsRef.current.size > 0) {
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
        hasOnlyCompatibleExternalEdits(nextProject) &&
        !hasDirtyCompatibleExternalEdit(nextProject, dirtyShotIdsRef.current)
      ) {
        const imported = await withStatus(
          "Import external Photoshop edits failed",
          () =>
            window.storyboard.importSwbFormat({
              project: nextProject,
              folderPath: nextFolderPath,
              metadataPath: nextMetadataPath,
              blankShotPreset,
              dirtyShotIds: []
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

  const handleClearBitmapLayer = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    await bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      const currentShot = projectRef.current.shots.find((item) => item.id === shotId);
      const currentLayer = currentShot ? bitmapLayersForShot(currentShot).find((item) => item.id === layerId) : undefined;
      if (!currentLayer || currentLayer.locked) {
        return;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      await window.storyboard.writeLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath,
        dataUrl: await createTransparentLayerDataUrl(currentLayer.width, currentLayer.height)
      });
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject((currentProject) => clearBitmapLayer(currentProject, shotId, layerId), false, false);
    });
  };

  const handleRemoveBitmapLayer = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    const undoEntry = await createHistoryEntry([layer.bitmapPath]);
    await window.storyboard.deleteLayerPng({
      folderPath,
      bitmapPath: layer.bitmapPath
    });
    markShotsDirty([shotId]);
    recordUndoEntry(undoEntry);
    updateProject((currentProject) => deleteBitmapLayer(currentProject, shotId, layerId), false, false);
  };

  const handleMergeBitmapLayerDown = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const sourceLayer = layers.find((item) => item.id === layerId && item.visible);
    const targetLayer = sourceLayer ? visibleLayerBelow(layers, sourceLayer.id) : undefined;

    if (!window.storyboard || !folderPath || !shot || !sourceLayer) {
      return;
    }

    if (!targetLayer) {
      setStatus("No visible layer below to merge into");
      return;
    }

    if (sourceLayer.locked || targetLayer.locked) {
      setStatus("Unlock both layers before merging down");
      return;
    }

    try {
      const undoEntry = await createHistoryEntry([targetLayer.bitmapPath, sourceLayer.bitmapPath]);
      await window.storyboard.mergeLayerDown({
        folderPath,
        sourceBitmapPath: sourceLayer.bitmapPath,
        targetBitmapPath: targetLayer.bitmapPath,
        width: targetLayer.width,
        height: targetLayer.height,
        sourceOpacity: sourceLayer.opacity,
        sourceBlendMode: sourceLayer.blendMode,
        targetOpacity: targetLayer.opacity,
        targetBlendMode: targetLayer.blendMode
      });
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) =>
          mergeBitmapLayerDown(currentProject, shotId, sourceLayer.id, targetLayer.id),
        false,
        false
      );
      setStatus(`Merged "${sourceLayer.name}" down into "${targetLayer.name}"`);
    } catch (error) {
      setStatus(`Merge down failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMergeBitmapLayers = async (
    shotId: string,
    layerId: string,
    selectedLayerIds: string[]
  ) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const selectedLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));

    if (selectedLayers.length < 2) {
      await handleMergeBitmapLayerDown(shotId, layerId);
      return;
    }

    if (!window.storyboard || !folderPath || !shot) {
      return;
    }

    if (selectedLayers.some((layer) => layer.locked)) {
      setStatus("Unlock selected layers before merging");
      return;
    }

    if (selectedLayers.some((layer) => !layer.visible)) {
      setStatus("Show selected layers before merging");
      return;
    }

    const targetLayer = selectedLayers[0];
    const sourceLayers = selectedLayers.slice(1);

    try {
      const undoEntry = await createHistoryEntry(selectedLayers.map((layer) => layer.bitmapPath));
      await window.storyboard.mergeVisibleLayers({
        folderPath,
        targetBitmapPath: targetLayer.bitmapPath,
        width: targetLayer.width,
        height: targetLayer.height,
        layers: selectedLayers.map((layer) => ({
          bitmapPath: layer.bitmapPath,
          opacity: layer.opacity,
          blendMode: layer.blendMode
        })),
        deleteBitmapPaths: sourceLayers.map((layer) => layer.bitmapPath)
      });
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject(
        (currentProject) =>
          mergeSelectedBitmapLayers(currentProject, shotId, selectedLayers.map((layer) => layer.id)),
        false,
        false
      );
      setStatus(`Merged ${selectedLayers.length} selected layers`);
    } catch (error) {
      setStatus(`Merge failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMergeVisibleBitmapLayers = async (shotId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const visibleLayers = layers.filter((layer) => layer.visible);
    const targetLayer = visibleLayers[0];

    if (!window.storyboard || !folderPath || !shot || !targetLayer) {
      return;
    }

    if (visibleLayers.length < 2) {
      setStatus("Need at least two visible layers to merge");
      return;
    }

    const nextProject = mergeVisibleBitmapLayers(projectRef.current, shotId);
    const nextShot = nextProject.shots.find((item) => item.id === shotId);
    const existingLayerIds = new Set(layers.map((layer) => layer.id));
    const mergedLayer = nextShot
      ? bitmapLayersForShot(nextShot).find((layer) => !existingLayerIds.has(layer.id))
      : undefined;

    if (!mergedLayer) {
      setStatus("Could not create merged layer");
      return;
    }

    try {
      const undoEntry = await createHistoryEntry([
        ...visibleLayers.map((layer) => layer.bitmapPath),
        mergedLayer.bitmapPath
      ]);
      await window.storyboard.mergeVisibleLayers({
        folderPath,
        targetBitmapPath: mergedLayer.bitmapPath,
        width: mergedLayer.width,
        height: mergedLayer.height,
        layers: visibleLayers.map((layer) => ({
          bitmapPath: layer.bitmapPath,
          opacity: layer.opacity,
          blendMode: layer.blendMode
        })),
        deleteBitmapPaths: visibleLayers
          .filter((layer) => !layer.locked)
          .map((layer) => layer.bitmapPath)
      });
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject(nextProject, false, false);
      setStatus("Merged visible layers");
    } catch (error) {
      setStatus(`Merge visible failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleAddBitmapLayer = async (shotId: string) => {
    const currentProject = projectRef.current;
    const targetShot = currentProject.shots.find((item) => item.id === shotId);
    const canvasSize = targetShot ? canvasSizeForShot(targetShot) : sketchCanvasSize;
    const existingLayerIds = new Set(
      targetShot ? bitmapLayersForShot(targetShot).map((layer) => layer.id) : []
    );
    const nextProject = addBitmapLayer(currentProject, shotId, {
      name: "Layer",
      width: canvasSize.width,
      height: canvasSize.height
    });
    const nextShot = nextProject.shots.find((item) => item.id === shotId);
    const addedLayer = nextShot
      ? bitmapLayersForShot(nextShot).find((layer) => !existingLayerIds.has(layer.id))
      : undefined;
    const undoEntry = await createHistoryEntry(addedLayer ? [addedLayer.bitmapPath] : []);

    recordUndoEntry(undoEntry);
    markShotsDirty([shotId]);
    updateProject(nextProject, false, false);
  };

  const loadFolderScan = async (
    scan: FolderScanPayload,
    nextStatus: string,
    dirty = false,
    resetDirtyShots = true
  ) => {
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
            dirtyShotIds: []
          }),
        setStatus
      );
      if (imported) {
        await loadFolderScan(imported, "Imported external Photoshop edits", false, true);
        return;
      }
    }
    const acceptedExternalEdits = projectAcceptedExternalEdits(nextProject);
    const loadedProjectChanged = projectChangedDuringLoad(projectWithDefaults, nextProject);
    let nextScriptImportNeeded = Boolean(scan.scriptImportNeeded);

    setProject(nextProject);
    setFolderPath(scan.folderPath);
    setFolderInputValue(scan.folderPath);
    setMetadataPath(scan.metadataPath);
    setWorkspaceSaveState(dirty || acceptedExternalEdits || loadedProjectChanged ? "saving" : "saved");
    setFileNameSyncState("synced");
    setStatus(acceptedExternalEdits ? "External TIFF edits accepted as new base" : nextStatus);
    setUndoStackSynced([]);
    setRedoStackSynced([]);
    setSelectedShotIds(nextProject.shots[0] ? [nextProject.shots[0].id] : []);
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

    if (
      scan.preserveProjectWithoutImageMerge &&
      loadedProjectChanged &&
      !dirty &&
      !acceptedExternalEdits &&
      !nextScriptImportNeeded
    ) {
      void persistWorkspace(nextProject, scan.folderPath, scan.metadataPath).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setWorkspaceSaveState("error");
        setAutosaveError((current) => autosaveErrorReducer(current, { type: "failed", message }));
        setStatus(`Autosave failed: ${message}`);
      });
      return;
    }

    if ((dirty || acceptedExternalEdits || loadedProjectChanged) && !nextScriptImportNeeded) {
      setAutosaveRevision((revision) => revision + 1);
    }
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

    if (!folderPath || !metadataPath) {
      setStatus("Open a folder path before adding a shot");
      return;
    }

    const image = await withStatus(
      "Add shot failed",
      () => window.storyboard.createBlankShot(folderPath, { preset: blankShotPreset }),
      setStatus
    );

    if (!image) {
      return;
    }

    const nextProject = addGeneratedShot(project, image, primarySelectedShotId);
    updateProject(nextProject, true, false);
    const nextShotId = nextProject.shots.find((shot) => shot.imagePath === image.imagePath)?.id;
    if (nextShotId) {
      markShotsDirty([nextShotId]);
    }
    setSelectedShotIds(nextShotId ? [nextShotId] : []);
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
      setStatus("All images are already in Storyboard Workbench Format");
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
        ? "Imported images into Storyboard Workbench Format"
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

  const handleCopyShot = async (sourceShotId: string, targetShotId?: string) => {
    if (!window.storyboard || !folderPath) {
      setStatus("Cannot copy storyboard: Electron preload API is unavailable");
      return;
    }

    const currentProject = projectRef.current;
    const sourceShot = currentProject.shots.find((shot) => shot.id === sourceShotId);
    if (!sourceShot) {
      return;
    }

    const copiedShotId = crypto.randomUUID();
    const sourceLayers = bitmapLayersForShot(sourceShot);
    const layerCopies = sourceLayers.map((layer) => ({
      sourceBitmapPath: layer.bitmapPath,
      targetBitmapPath: bitmapLayerPath(copiedShotId, layer.id)
    }));
    const copiedAssets = await withStatus(
      "Copy storyboard failed",
      () =>
        window.storyboard.copyShotAssets({
          folderPath,
          sourceImagePath: sourceShot.imagePath,
          fileName: sourceShot.fileName,
          layerCopies
        }),
      setStatus
    );

    if (!copiedAssets) {
      return;
    }

    const nextProject = duplicateShotAfter(currentProject, sourceShotId, targetShotId, {
      shotId: copiedShotId,
      imagePath: copiedAssets.imagePath,
      fileName: copiedAssets.fileName,
      previewPath: copiedAssets.previewPath
    });
    updateProject(nextProject);
    markShotsDirty([copiedShotId]);
    setSelectedShotIds([copiedShotId]);
    setDeleteTarget({ type: "shot" });
    setStatus("Storyboard copied");
  };

  const handleCopyDialogue = (dialogueId: string, targetShotId: string) => {
    const dialogue = projectRef.current.dialogues.find((item) => item.id === dialogueId);
    if (!dialogue) {
      return;
    }

    const copiedDialogueId = crypto.randomUUID();
    updateProject((currentProject) =>
      copyDialogueToShot(currentProject, dialogueId, targetShotId, copiedDialogueId)
    );
    setEditingDialogueId(copiedDialogueId);
    setStatus("Dialogue copied");
  };

  const handleCopyBitmapLayerToShot = async (
    sourceShotId: string,
    layerId: string,
    targetShotId: string,
    placementLayerId?: string,
    placement?: "before" | "after"
  ) => {
    if (!window.storyboard || !folderPath) {
      setStatus("Cannot copy layer: Electron preload API is unavailable");
      return;
    }

    const sourceShot = projectRef.current.shots.find((shot) => shot.id === sourceShotId);
    const sourceLayer = sourceShot
      ? bitmapLayersForShot(sourceShot).find((layer) => layer.id === layerId)
      : undefined;
    const targetShot = projectRef.current.shots.find((shot) => shot.id === targetShotId);
    if (!sourceLayer || !targetShot) {
      return;
    }

    const copiedLayerId = `layer-${crypto.randomUUID()}`;
    const targetBitmapPath = bitmapLayerPath(targetShotId, copiedLayerId);
    const undoEntry = await createHistoryEntry([targetBitmapPath]);
    const copied = await withStatus(
      "Copy layer failed",
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

    recordUndoEntry(undoEntry);
    markShotsDirty([targetShotId]);
    updateProject(
      (currentProject) =>
        copyBitmapLayerToShot(
          currentProject,
          sourceShotId,
          layerId,
          targetShotId,
          copiedLayerId,
          placementLayerId,
          placement
        ),
      false
    );
    setSelectedShotIds([targetShotId]);
    setDeleteTarget({ type: "layer", shotId: targetShotId, layerId: copiedLayerId });
    setStatus(`Copied layer "${sourceLayer.name}"`);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    const isCopyDrag = isCopyModifierEvent(event.activatorEvent);

    if (isCopyDrag && (data?.type === "shot" || data?.type === "dialogue")) {
      setCopyDrag(data);
      copyDragRef.current = data;
      setStatus(data.type === "shot" ? "Copy storyboard" : "Copy dialogue");
    } else {
      setCopyDrag(undefined);
      copyDragRef.current = undefined;
    }

    if (data?.type === "shot") {
      const movingShotIds = isCopyDrag
        ? [data.shotId]
        : selectedShotIdsRef.current.includes(data.shotId)
        ? selectedShotIdsRef.current
        : [data.shotId];
      setActiveShotIds(movingShotIds);
      setDragPreviewShotIds(
        chooseDragPreviewShotIds({
          activeShotId: data.shotId,
          selectedShotIds: selectedShotIdsRef.current,
          orderedShotIds: orderedShots.map((shot) => shot.id),
          isCopyDrag
        })
      );

      if (!selectedShotIdsRef.current.includes(data.shotId)) {
        setSelectedShotIds([data.shotId]);
      }
    }

    if (data?.type === "parked-shot") {
      setActiveParkedShotIds([data.shotId]);
      setIsParkingShelfOpen(true);
    }

    if (data?.type === "dialogue") {
      setActiveDialogue(project.dialogues.find((dialogue) => dialogue.id === data.dialogueId));
    }
  };

  const handleDragCancel = () => {
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setCopyShotDropTargetId(undefined);
    setActiveParkedShotIds([]);
    setCopyDrag(undefined);
    copyDragRef.current = undefined;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const activeData = event.active.data.current as DragData | undefined;
    const overData = event.over?.data.current as DragData | undefined;
    const activeCopyDrag = copyDragRef.current;

    if (activeCopyDrag?.type !== "shot" || activeData?.type !== "shot") {
      if (copyShotDropTargetId !== undefined) {
        setCopyShotDropTargetId(undefined);
      }
      return;
    }

    const targetShotId =
      overData?.type === "shot" || overData?.type === "drop-zone" ? overData.shotId : undefined;
    setCopyShotDropTargetId(targetShotId);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDialogue(undefined);
    setActiveShotIds([]);
    setDragPreviewShotIds([]);
    setActiveParkedShotIds([]);

    const activeData = event.active.data.current as DragData | undefined;
    const overData = event.over?.data.current as DragData | undefined;
    const activeCopyDrag = copyDragRef.current;
    const copyTargetShotId = copyShotDropTargetId;
    setCopyShotDropTargetId(undefined);
    setCopyDrag(undefined);
    copyDragRef.current = undefined;

    if (!activeData) {
      return;
    }

    if (activeCopyDrag?.type === "shot" && activeData.type === "shot") {
      const targetShotId =
        overData?.type === "shot" || overData?.type === "drop-zone"
          ? overData.shotId
          : copyTargetShotId;
      void handleCopyShot(activeData.shotId, targetShotId);
      return;
    }

    if (
      activeCopyDrag?.type === "dialogue" &&
      activeData.type === "dialogue" &&
      (overData?.type === "shot" || overData?.type === "drop-zone")
    ) {
      handleCopyDialogue(activeData.dialogueId, overData.shotId);
      return;
    }

    if (
      activeData.type === "shot" &&
      dragEndInsideSelector(event, ".parking-shelf.is-open", lastPointerPositionRef.current)
    ) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const nextProject = parkShotGroup(projectRef.current, movingShotIds);
      updateProject(nextProject);
      const nextSelectedShot = sortedShots(nextProject.shots)[0];
      setSelectedShotIds(nextSelectedShot ? [nextSelectedShot.id] : []);
      setDeleteTarget({ type: "shot" });
      setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to pending`);
      return;
    }

    if (!overData) {
      return;
    }

    if (
      activeData.type === "shot" &&
      (overData.type === "parking-zone" || overData.type === "parked-shot")
    ) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const nextProject = parkShotGroup(projectRef.current, movingShotIds);
      updateProject(nextProject);
      const nextSelectedShot = sortedShots(nextProject.shots)[0];
      setSelectedShotIds(nextSelectedShot ? [nextSelectedShot.id] : []);
      setDeleteTarget({ type: "shot" });
      setStatus(`${movingShotIds.length} storyboard${movingShotIds.length === 1 ? "" : "s"} moved to pending`);
      return;
    }

    if (activeData.type === "shot" && (overData.type === "shot" || overData.type === "drop-zone")) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const targetShotId = overData.shotId;
      const currentProject = projectRef.current;
      const placement = inferShotPlacement(currentProject, movingShotIds, targetShotId, activeData.shotId);
      const nextProject =
        movingShotIds.length > 1
          ? reorderShotGroup(currentProject, movingShotIds, targetShotId, placement)
          : reorderShots(currentProject, activeData.shotId, targetShotId, placement);
      updateProject(nextProject);
    }

    if (activeData.type === "parked-shot" && (overData.type === "shot" || overData.type === "drop-zone")) {
      const targetShotId = overData.shotId;
      const placement = inferDropPlacementFromDragEnd(event);
      const nextProject = restoreParkedShotGroup(projectRef.current, [activeData.shotId], targetShotId, placement);
      updateProject(nextProject);
      setSelectedShotIds([activeData.shotId]);
      setDeleteTarget({ type: "shot" });
      setStatus("Storyboard restored from pending");
    }

    if (activeData.type === "dialogue" && (overData.type === "shot" || overData.type === "drop-zone")) {
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

    if (event.shiftKey || event.metaKey) {
      setSelectedShotIds((current) =>
        current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]
      );
      return;
    }

    setSelectedShotIds([shotId]);
  };

  const handleSelectionPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0) {
      return;
    }

    const nextBox = createMarqueeBox({
      clientX: event.clientX,
      clientY: event.clientY,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    });
    setSelectionBox(nextBox);
    setDeleteTarget({ type: "shot" });
    setSelectedShotIds([]);
    let latestPointer = { clientX: event.clientX, clientY: event.clientY };
    let scrollFrame: number | undefined;

    const updateMarqueeSelection = () => {
      const scrollDelta = marqueeEdgeScrollDelta({
        pointerY: latestPointer.clientY,
        viewportHeight: window.innerHeight
      });
      if (scrollDelta !== 0) {
        window.scrollBy({ top: scrollDelta, left: 0, behavior: "auto" });
      }

      const movedBox = updateMarqueeBox(nextBox, {
        clientX: latestPointer.clientX,
        clientY: latestPointer.clientY,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });
      selectionBoxRef.current = movedBox;
      setSelectionBox(movedBox);
      setSelectedShotIds(shotIdsInSelectionBox(movedBox));

      scrollFrame =
        scrollDelta === 0 ? undefined : window.requestAnimationFrame(updateMarqueeSelection);
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      if (scrollFrame === undefined) {
        updateMarqueeSelection();
      }
    };

    const handlePointerUp = () => {
      setSelectionBox(undefined);
      if (scrollFrame !== undefined) {
        window.cancelAnimationFrame(scrollFrame);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const openSketchSettingsMenu = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (
      !target.closest(".image-stage") ||
      target.closest("input, textarea, select, .save-menu, .sketch-settings-menu")
    ) {
      return;
    }

    event.preventDefault();
    if (activeSketchTool === "select") {
      setSketchSettingsMenu(undefined);
      return;
    }

    const menuWidth = 236;
    const menuHeight = 136;
    const margin = 12;
    setSketchSettingsMenu({
      tool: activeSketchTool,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - margin),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - margin)
    });
  };

  const handleShortcutCapture = async (action: ShortcutAction, event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const nextShortcut = event.key === "Backspace" || event.key === "Delete"
      ? ""
      : formatShortcutFromKeyboardEvent(event.nativeEvent);
    if (nextShortcut === "" && event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    const nextShortcuts = normalizeKeyboardShortcuts({
      ...keyboardShortcuts,
      [action]: nextShortcut
    });
    const duplicates = duplicateShortcutValues(nextShortcuts);
    if (duplicates.length > 0) {
      setShortcutError(`${duplicates.join(", ")} is already assigned`);
      return;
    }

    setShortcutError("");
    setKeyboardShortcuts(nextShortcuts);
    const saved = await withStatus(
      "Keyboard shortcut save failed",
      () => window.storyboard.setKeyboardShortcuts(nextShortcuts),
      setStatus
    );
    if (saved) {
      setKeyboardShortcuts(normalizeKeyboardShortcuts(saved));
    }
  };

  const handleNativeShortcutCapture = async (action: ShortcutAction, event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const nextShortcut = event.key === "Backspace" || event.key === "Delete"
      ? ""
      : formatShortcutFromKeyboardEvent(event);
    if (nextShortcut === "" && event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    const nextShortcuts = normalizeKeyboardShortcuts({
      ...keyboardShortcuts,
      [action]: nextShortcut
    });
    const duplicates = duplicateShortcutValues(nextShortcuts);
    if (duplicates.length > 0) {
      setShortcutError(`${duplicates.join(", ")} is already assigned`);
      return;
    }

    setShortcutError("");
    setKeyboardShortcuts(nextShortcuts);
    const saved = await withStatus(
      "Keyboard shortcut save failed",
      () => window.storyboard.setKeyboardShortcuts(nextShortcuts),
      setStatus
    );
    if (saved) {
      setKeyboardShortcuts(normalizeKeyboardShortcuts(saved));
    }
  };

  useEffect(() => {
    if (!capturingShortcutAction) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      void handleNativeShortcutCapture(capturingShortcutAction, event);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [capturingShortcutAction, keyboardShortcuts]);

  return (
    <main
      ref={appShellRef}
      className={[
        "app-shell",
        isAnimationMode ? "is-animation-mode" : "",
        isParkingShelfOpen ? "has-parking-shelf-open" : ""
      ].filter(Boolean).join(" ")}
      onContextMenu={openSketchSettingsMenu}
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
            title="Import image or storyboard-script.md changes into Storyboard Workbench"
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
                Workbench。在你点击 Import 之前，软件内的编辑仍然是当前工作状态。
              </p>
              <p>
                原始 TIFF 会先移动到 Archive，然后 Storyboard Workbench 接管工作文件。
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
                className="primary save-main-button"
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
                className="primary save-menu-toggle"
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
                Add Shot
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
            onClick={() => setIsParkingShelfOpen((isOpen) => !isOpen)}
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
            {cardFace === "image" ? "文" : "图"}
          </button>
          <div className="shortcut-menu-container" ref={shortcutMenuRef}>
            <button
              type="button"
              className={isShortcutMenuOpen ? "selected" : ""}
              onClick={() => {
                setIsShortcutMenuOpen((isOpen) => !isOpen);
                setShortcutError("");
              }}
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
                  <span>Press a key combo. Backspace/Delete clears.</span>
                </div>
                <div className="shortcut-list">
                  {shortcutLabels.map(({ action, label }) => (
                    <label key={action} className="shortcut-field">
                      <span>{label}</span>
                      <input
                        className="shortcut-key-input"
                        value={keyboardShortcuts[action]}
                        readOnly
                        onKeyDown={(event) => void handleShortcutCapture(action, event)}
                        onFocus={(event) => {
                          setCapturingShortcutAction(action);
                          event.currentTarget.select();
                        }}
                        onBlur={() => setCapturingShortcutAction(undefined)}
                        aria-label={`${label} shortcut`}
                      />
                    </label>
                  ))}
                </div>
                {shortcutError ? <p className="shortcut-error">{shortcutError}</p> : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={activeSketchTool === "brush" ? "selected" : ""}
            onClick={() => setActiveSketchTool("brush")}
            title="Brush"
            aria-label="Brush"
          >
            <BrushIcon />
          </button>
          <button
            type="button"
            className={activeSketchTool === "eraser" ? "selected" : ""}
            onClick={() => setActiveSketchTool("eraser")}
            title="Eraser"
            aria-label="Eraser"
          >
            <EraserIcon />
          </button>
          <button
            type="button"
            className={activeSketchTool === "select" ? "selected" : ""}
            onClick={() => setActiveSketchTool("select")}
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
          <label className="color-control" title="Brush color">
            <input
              aria-label="Brush color"
              type="color"
              value={brushColor}
              onChange={(event) => setBrushColor(event.target.value)}
            />
          </label>
        </aside>
        {sketchSettingsMenu ? (
          <div
            className="sketch-settings-menu"
            style={{ left: sketchSettingsMenu.x, top: sketchSettingsMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {sketchSettingsMenu.tool === "brush" ? (
              <>
                <BrushSwatchPicker
                  swatches={brushSwatches}
                  activeColor={brushColor}
                  onPickColor={setBrushColor}
                  onChangeSwatch={(index, color) => {
                    setBrushSwatches((current) =>
                      current.map((swatch, swatchIndex) => (swatchIndex === index ? color : swatch))
                    );
                    setBrushColor(color);
                  }}
                />
                <SketchSettingSlider
                  label="Brush size"
                  value={brushSize}
                  min={1}
                  max={28}
                  step={1}
                  suffix="px"
                  onChange={setBrushSize}
                />
                <SketchSettingSlider
                  label="Brush opacity"
                  value={Math.round(brushOpacity * 100)}
                  min={20}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(value) => setBrushOpacity(value / 100)}
                />
              </>
            ) : sketchSettingsMenu.tool === "eraser" ? (
              <>
                <SketchSettingSlider
                  label="Eraser size"
                  value={eraserSize}
                  min={4}
                  max={64}
                  step={1}
                  suffix="px"
                  onChange={setEraserSize}
                />
                <SketchSettingSlider
                  label="Eraser opacity"
                  value={Math.round(eraserOpacity * 100)}
                  min={20}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(value) => setEraserOpacity(value / 100)}
                />
              </>
            ) : null}
          </div>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={renderedShotEntries.map(({ shot }) => shot.id)}
            strategy={rectSortingStrategy}
          >
            <section
              ref={boardGridRef}
              className="board-grid"
              style={
                {
                  "--shot-scale": zoomLevel / 100,
                  "--animation-image-width": `${animationImageSize.width}px`,
                  "--animation-image-height": `${animationImageSize.height}px`,
                  "--animation-frame-width": `${animationFrameSize.width}px`,
                  "--animation-frame-height": `${animationFrameSize.height}px`
                } as CSSProperties
              }
              onPointerDown={handleSelectionPointerDown}
            >
              {renderedShotEntries.map(({ shot, index }) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  index={index}
                  project={project}
                  folderPath={folderPath}
                  isSelected={selectedShotIds.length > 1 && selectedShotIds.includes(shot.id)}
                  isPrimarySelected={shot.id === primarySelectedShotId}
                  isAnimationFocused={isAnimationMode && shot.id === primarySelectedShotId}
                  isCopyDraggingSource={copyDrag?.type === "shot" && copyDrag.shotId === shot.id}
                  activeSketchTool={activeSketchTool}
                  brushColor={brushColor}
                  brushOpacity={brushOpacity}
                  brushSize={brushSize}
                  eraserOpacity={eraserOpacity}
                  eraserSize={eraserSize}
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
                    setSelectedShotIds([shot.id]);
                    setDeleteTarget({ type: "shot" });
                    setSelectedBitmapLayerIds(undefined);
                  }}
                    isLayerPanelOpen={isLayerPanelOpen && shot.id === primarySelectedShotId}
                    thumbnailRevision={autosaveRevision}
                    onToggleLayerPanel={() => {
                      setSelectedShotIds([shot.id]);
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
                    onCopyLayerToShot={(shotId, layerId, targetShotId, targetLayerId, placement) =>
                      void handleCopyBitmapLayerToShot(shotId, layerId, targetShotId, targetLayerId, placement)
                    }
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
                  />
              ))}
              {selectionBox ? <SelectionMarquee box={selectionBox} /> : null}
            </section>
          </SortableContext>
          <SortableContext items={parkedShots.map((shot) => `parked-${shot.id}`)} strategy={rectSortingStrategy}>
            <ParkingShelf
              shots={parkedShots}
              isOpen={isParkingShelfOpen}
            />
          </SortableContext>

          <DragOverlay>
            {copyDrag && copyDrag.type !== "shot" ? (
              <div className="copy-drag-badge">
                {copyDrag.type === "dialogue" ? "Copy dialogue" : "Copy layer"}
              </div>
            ) : null}
            {activeDialogue ? <DialoguePreview dialogue={activeDialogue} /> : null}
            {!activeDialogue && dragPreviewShotIds.length > 0 ? (
              <ShotStackPreview
                shots={dragPreviewShotIds
                  .map((shotId) => shotById.get(shotId))
                  .filter((shot): shot is Shot => Boolean(shot))}
                folderPath={folderPath}
                variant={copyDrag?.type === "shot" ? "copy" : "move"}
              />
            ) : null}
            {!activeDialogue && dragPreviewShotIds.length === 0 && activeParkedShotIds.length > 0 ? (
              <ShotStackPreview
                shots={parkedShots.filter((shot) => activeParkedShotIds.includes(shot.id))}
                folderPath={folderPath}
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

      {isAnimationMode && orderedShots.length > 0 ? (
        <Timeline
          shots={orderedShots}
          selectedShotIds={selectedShotIds}
          onSelect={(shotId) => {
            setSelectedShotIds([shotId]);
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
            <span>{project.shots.length} shots</span>
            <span>{parkedShots.length} pending</span>
            <span>Workspace {workspaceSaveState}</span>
            <span>File names {fileNameSyncState}</span>
            <span>{needsSwbImport ? "SWB import needed" : hasSwbWarning ? "SWB warning" : "SWB ready"}</span>
          </div>
        ) : null}
        <button
          type="button"
          className={`status-toggle ${
            workspaceSaveState === "error" || fileNameSyncState === "unsynced" || hasSwbWarning
              ? "needs-attention"
              : ""
          }`}
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
            type="range"
            min="25"
            max={maxStoryboardZoom}
            step="5"
            value={zoomLevel}
            onChange={(event) => setZoomLevel(Number(event.target.value))}
          />
        </label>
        <span>{zoomLevel}%</span>
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
        <span>{selectedShotIds.length} selected</span>
      </footer>
    </main>
  );
};

const inferShotPlacement = (
  project: Project,
  movingShotIds: string[],
  targetShotId: string,
  fallbackShotId: string
): ShotPlacement => {
  const ordered = sortedShots(project.shots);
  const targetIndex = ordered.findIndex((shot) => shot.id === targetShotId);
  const activeIndex = ordered.findIndex((shot) => shot.id === fallbackShotId);
  const movingIndexes = movingShotIds
    .map((shotId) => ordered.findIndex((shot) => shot.id === shotId))
    .filter((index) => index !== -1);

  if (targetIndex === -1 || activeIndex === -1 || movingIndexes.length === 0) {
    return "before";
  }

  return targetIndex > Math.max(...movingIndexes) ? "after" : "before";
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

const hasOnlyCompatibleExternalEdits = (project: Project): boolean => {
  let hasCompatibleEdit = false;
  for (const shot of [...project.shots, ...(project.parkedShots ?? [])]) {
    if (shot.swb?.status === "compatible-external-edit") {
      hasCompatibleEdit = true;
      continue;
    }

    if (shot.swb?.status === "non-swb" || shot.swb?.status === "incompatible-external-edit") {
      return false;
    }
  }

  return hasCompatibleEdit;
};

const hasDirtyCompatibleExternalEdit = (project: Project, dirtyShotIds: Set<string>): boolean =>
  [...project.shots, ...(project.parkedShots ?? [])].some(
    (shot) => shot.swb?.status === "compatible-external-edit" && dirtyShotIds.has(shot.id)
  );

const shotIdsInSelectionBox = (box: MarqueeBox): string[] => {
  const shots = Array.from(document.querySelectorAll<HTMLElement>("[data-shot-id]"))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const shotId = element.dataset.shotId;
      return shotId
        ? {
            shotId,
            rect: {
              left: rect.left + window.scrollX,
              right: rect.right + window.scrollX,
              top: rect.top + window.scrollY,
              bottom: rect.bottom + window.scrollY
            }
          }
        : undefined;
    })
    .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));

  return shotIdsInMarqueeBox(box, shots);
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

const aspectRatioForShot = (shot: Shot): number => {
  const canvasSize = canvasSizeForShot(shot);
  return canvasSize.width / canvasSize.height;
};
