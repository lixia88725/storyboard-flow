import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  addBitmapLayer,
  addDialogue,
  addGeneratedShot,
  addImportedImages,
  applyRenamePlan,
  createProject,
  createRenamePlan,
  defaultProjectNaming,
  defaultSaveNaming,
  bitmapLayersForShot,
  clearBitmapLayer,
  deleteShots,
  deleteBitmapLayer,
  getNextStoryboardIndex,
  imageBitmapLayerId,
  markBitmapLayerPainted,
  mergeFolderImages,
  moveDialogueToShot,
  moveBitmapLayer,
  projectAcceptedExternalEdits,
  projectHasSwbWarning,
  projectNeedsSwbImport,
  removeDialogue,
  reorderShotGroup,
  reorderShots,
  selectBitmapLayer,
  sortedShots,
  type ShotPlacement,
  updateDialogueText,
  updateBitmapLayer,
} from "../shared/projectOps";
import type {
  BitmapLayer,
  BitmapSelectionMode,
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
import { DialoguePreview, ShotStackPreview } from "./DragPreviews";
import {
  defaultKeyboardShortcuts,
  duplicateShortcutValues,
  formatShortcutFromKeyboardEvent,
  keyboardEventMatchesShortcut,
  normalizeKeyboardShortcuts,
  shortcutActions,
  type KeyboardShortcuts,
  type ShortcutAction
} from "./keyboardShortcuts";
import { BrushIcon, ClearIcon, EraserIcon, GearIcon, SelectIcon } from "./icons";
import { getOnionSkinNeighbors } from "./onionSkin";
import { SelectionMarquee } from "./SelectionMarquee";
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
  drawStrokePathOnCanvas
} from "./sketchRendering";
import { sketchCanvasSize } from "./sketchGeometry";
import type { DragData } from "./storyboardDnd";
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

type WorkspaceSaveState = "saved" | "saving" | "error";
type FileNameSyncState = "synced" | "unsynced";
type WorkspaceTask = {
  kind: "save" | "import";
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

const shortcutLabels: Array<{ action: ShortcutAction; label: string }> = [
  { action: "brush", label: "Brush" },
  { action: "eraser", label: "Eraser" },
  { action: "select", label: "Select" },
  { action: "clearLayer", label: "Clear layer" },
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

const shouldIgnoreWorkbenchWheel = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "input, textarea, select, .recent-menu, .add-shot-menu, .save-menu, .sketch-settings-menu, .shortcut-menu, .layer-panel"
    )
  );

export const App = () => {
  const [project, setProject] = useState<Project>(() => createProject("Untitled Storyboard"));
  const [folderPath, setFolderPath] = useState<string | undefined>();
  const [folderInputValue, setFolderInputValue] = useState("");
  const [metadataPath, setMetadataPath] = useState<string | undefined>();
  const [activeDialogue, setActiveDialogue] = useState<Dialogue | undefined>();
  const [activeShotIds, setActiveShotIds] = useState<string[]>([]);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [activeSketchTool, setActiveSketchTool] = useState<SketchTool>("brush");
  const [brushColor, setBrushColor] = useState(defaultBrushColor);
  const [brushSwatches, setBrushSwatches] = useState(defaultBrushSwatches);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSize, setBrushSize] = useState(defaultBrushSize);
  const [eraserSize, setEraserSize] = useState(defaultEraserSize);
  const [eraserOpacity, setEraserOpacity] = useState(1);
  const [selectionMode, setSelectionMode] = useState<BitmapSelectionMode>("lasso");
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
  const [cardFace, setCardFace] = useState<CardFace>("image");
  const [scriptImportNeeded, setScriptImportNeeded] = useState(false);
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(defaultKeyboardShortcuts);
  const [capturingShortcutAction, setCapturingShortcutAction] = useState<ShortcutAction | undefined>();
  const [shortcutError, setShortcutError] = useState("");
  const [autosaveError, setAutosaveError] = useState<AutosaveErrorNotice | undefined>();
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [selectionBox, setSelectionBox] = useState<MarqueeBox | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const selectionBoxRef = useRef<MarqueeBox | undefined>(undefined);
  const projectRef = useRef(project);
  const folderPathRef = useRef(folderPath);
  const metadataPathRef = useRef(metadataPath);
  const scriptImportCheckIdRef = useRef(0);
  const dirtyShotIdsRef = useRef<Set<string>>(new Set());
  const fileNameSyncStateRef = useRef<FileNameSyncState>(fileNameSyncState);
  const selectedShotIdsRef = useRef<string[]>([]);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const saveMenuRef = useRef<HTMLDivElement | null>(null);
  const recentMenuRef = useRef<HTMLDivElement | null>(null);
  const addShotMenuRef = useRef<HTMLDivElement | null>(null);
  const shortcutMenuRef = useRef<HTMLDivElement | null>(null);
  const importHelpRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLElement | null>(null);
  const boardGridRef = useRef<HTMLElement | null>(null);
  const orderedShots = useMemo(() => sortedShots(project.shots), [project.shots]);
  const needsImageImport = useMemo(() => projectNeedsSwbImport(project), [project]);
  const needsSwbImport = needsImageImport || scriptImportNeeded;
  const hasSwbWarning = useMemo(() => projectHasSwbWarning(project), [project]) || scriptImportNeeded;
  const isWorkspaceTaskRunning = Boolean(workspaceTask);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const primarySelectedShotId = selectedShotIds[0];
  const primarySelectedShot = useMemo(
    () => primaryShotFromSelection(orderedShots, selectedShotIds),
    [orderedShots, selectedShotIds]
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

  useEffect(() => {
    fileNameSyncStateRef.current = fileNameSyncState;
  }, [fileNameSyncState]);

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
    if (!isShortcutMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
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

    const handlePointerDown = (event: globalThis.PointerEvent) => {
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

    const handlePointerDown = (event: globalThis.PointerEvent) => {
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
          ? { ...task, current: progress.current, total: progress.total }
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
      const shortcutAction = shortcutActions.find((action) =>
        keyboardEventMatchesShortcut(event, keyboardShortcuts[action])
      );
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
        handleDeleteSelectedShots();
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
      setUndoStack((current) =>
        appendHistoryEntry(current, {
          project: projectRef.current,
          selectedShotIds: selectedShotIdsRef.current,
          fileNameSyncState: fileNameSyncStateRef.current
        })
      );
    }
    setRedoStack([]);
    const acceptedExternalEdits = projectAcceptedExternalEdits(nextProject);

    setProject(nextProject);
    setWorkspaceSaveState("saving");
    if (markFileNamesUnsynced) {
      setFileNameSyncState("unsynced");
    }
    setAutosaveRevision((revision) => revision + 1);
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
    setStatus(
      selectedIds.length === 1
        ? "Storyboard deleted; Save will move its file to Trash"
        : `${selectedIds.length} storyboards deleted; Save will move their files to Trash`
    );
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
    setUndoStack((current) => appendHistoryEntry(current, entry));
    setRedoStack([]);
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
      const redoEntry = await createHistoryEntry(affectedPaths);
      await restoreHistoryLayerAssets(previous);

      setRedoStack((current) => appendHistoryEntry(current, redoEntry));
      setUndoStack((current) => current.slice(0, -1));
      setProject(previous.project);
      projectRef.current = previous.project;
      setSelectedShotIds(previous.selectedShotIds);
      setFileNameSyncState(previous.fileNameSyncState);
      setWorkspaceSaveState("saving");
      markAllShotsDirty();
      setAutosaveRevision((revision) => revision + 1);
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
      const undoEntry = await createHistoryEntry(affectedPaths);
      await restoreHistoryLayerAssets(next);

      setUndoStack((current) => appendHistoryEntry(current, undoEntry));
      setRedoStack((current) => current.slice(0, -1));
      setProject(next.project);
      projectRef.current = next.project;
      setSelectedShotIds(next.selectedShotIds);
      setFileNameSyncState(next.fileNameSyncState);
      setWorkspaceSaveState("saving");
      markAllShotsDirty();
      setAutosaveRevision((revision) => revision + 1);
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
      const nextProject = addImportedImages(projectToCheck, result.images);
      if (nextProject !== projectToCheck) {
        setProject(nextProject);
      }
      setScriptImportNeeded(result.scriptImportNeeded);
    }
  };

  const handleBitmapStroke = async (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => {
    if (!window.storyboard || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    const undoEntry = await createHistoryEntry([layer.bitmapPath]);
    let dataUrl = renderedDataUrl;

    if (!dataUrl) {
      const blankDataUrl = await createTransparentLayerDataUrl(layer.width, layer.height);
      const sourceDataUrl = layer.cleared
        ? blankDataUrl
        : (await window.storyboard
            .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
            .catch(() => undefined)) ??
          (layer.kind === "image" ? window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath) : blankDataUrl);
      dataUrl = await drawStrokeOnBitmapLayer(sourceDataUrl, layer, stroke);
    }

    await window.storyboard.writeLayerPng({
      folderPath,
      bitmapPath: layer.bitmapPath,
      dataUrl
    });
    markShotsDirty([shot.id]);
    recordUndoEntry(undoEntry);
    updateProject((currentProject) => markBitmapLayerPainted(currentProject, shot.id, layer.id), false, false);
    return dataUrl;
  };

  const handleBitmapSelectionTransform = async (shot: Shot, layerId: string, dataUrl: string) => {
    if (!window.storyboard || !folderPath) {
      return;
    }

    const layer = bitmapLayersForShot(shot).find((item) => item.id === layerId);
    if (!layer || layer.locked) {
      return;
    }

    const undoEntry = await createHistoryEntry([layer.bitmapPath]);
    await window.storyboard.writeLayerPng({
      folderPath,
      bitmapPath: layer.bitmapPath,
      dataUrl
    });
    markShotsDirty([shot.id]);
    recordUndoEntry(undoEntry);
    updateProject((currentProject) => markBitmapLayerPainted(currentProject, shot.id, layer.id), false, false);
    return dataUrl;
  };

  const handleClearBitmapLayer = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    const undoEntry = await createHistoryEntry([layer.bitmapPath]);
    await window.storyboard.writeLayerPng({
      folderPath,
      bitmapPath: layer.bitmapPath,
      dataUrl: await createTransparentLayerDataUrl(layer.width, layer.height)
    });
    markShotsDirty([shotId]);
    recordUndoEntry(undoEntry);
    updateProject((currentProject) => clearBitmapLayer(currentProject, shotId, layerId), false, false);
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
      ? projectWithDefaults
      : mergeFolderImages(projectWithDefaults, scan.images);
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
    setUndoStack([]);
    setRedoStack([]);
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

    const result = await withStatus(
      "Open folder failed",
      () => window.storyboard.openFolderByPath(trimmedPath),
      setStatus
    );

    if (!result) {
      return;
    }

    await loadFolderScan(result, "Folder opened", !result.project);
    void window.storyboard.getRecentFolders().then(setRecentFolders).catch(() => undefined);
  };

  const handleSaveProject = async () => {
    if (!window.storyboard) {
      setStatus("Cannot save: Electron preload API is unavailable");
      return;
    }

    if (!folderPath || !metadataPath) {
      setStatus("Open a folder or add shots before saving");
      return;
    }

    const trimmedProjectName = project.name.trim();
    if (!trimmedProjectName) {
      setStatus("Project name is required before Save can rename image files");
      return;
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
        return;
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
      label: "Saving layered TIFFs...",
      current: 0,
      total: projectToSave.shots.length
    });

    const result = await (async () => {
      try {
        await persistWorkspace(projectToSave);
        const renamePlan = createRenamePlan(projectToSave, {
          allowDefaultNamingFields: missingNamingFields.length > 0
        });
        const renamedProject = applyRenamePlan(projectToSave, renamePlan);
        try {
          return await window.storyboard.saveWorkspace({
            project: { ...renamedProject, updatedAt: new Date().toISOString() },
            folderPath,
            metadataPath,
            renamePlan,
            dirtyShotIds: [...dirtyShotIdsRef.current]
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus(formatSaveFailureStatus(message));
          return undefined;
        }
      } finally {
        setWorkspaceTask(undefined);
      }
    })();

    if (!result) {
      return;
    }

    setProject(result.project);
    setFolderPath(result.folderPath);
    setFolderInputValue(result.folderPath);
    setMetadataPath(result.metadataPath);
    setWorkspaceSaveState("saved");
    setFileNameSyncState("synced");
    dirtyShotIdsRef.current = new Set();
    setUndoStack([]);
    setRedoStack([]);
    setStatus("Saved and synced file names");
  };

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
        ? project.shots.filter((shot) => shot.swb?.status !== "owned").length || project.shots.length
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

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;

    if (data?.type === "shot") {
      const movingShotIds = selectedShotIdsRef.current.includes(data.shotId)
        ? selectedShotIdsRef.current
        : [data.shotId];
      setActiveShotIds(movingShotIds);

      if (!selectedShotIdsRef.current.includes(data.shotId)) {
        setSelectedShotIds([data.shotId]);
      }
    }

    if (data?.type === "dialogue") {
      setActiveDialogue(project.dialogues.find((dialogue) => dialogue.id === data.dialogueId));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDialogue(undefined);
    setActiveShotIds([]);

    const activeData = event.active.data.current as DragData | undefined;
    const overData = event.over?.data.current as DragData | undefined;

    if (!activeData || !overData) {
      return;
    }

    if (activeData.type === "shot" && (overData.type === "shot" || overData.type === "drop-zone")) {
      const movingShotIds = selectedShotIdsRef.current.includes(activeData.shotId)
        ? selectedShotIdsRef.current
        : [activeData.shotId];
      const targetShotId = overData.shotId;
      const placement = inferShotPlacement(project, movingShotIds, targetShotId, activeData.shotId);
      const nextProject =
        movingShotIds.length > 1
          ? reorderShotGroup(project, movingShotIds, targetShotId, placement)
          : reorderShots(project, activeData.shotId, targetShotId, placement);
      updateProject(nextProject);
    }

    if (activeData.type === "dialogue") {
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
      className={`app-shell ${isAnimationMode ? "is-animation-mode" : ""}`}
      onContextMenu={openSketchSettingsMenu}
    >
      <header className="topbar">
        <div className="import-control" ref={importHelpRef}>
          <button
            type="button"
            onClick={() => void handleImportSwbFormat()}
            disabled={!needsSwbImport || isWorkspaceTaskRunning}
            title="Import image or storyboard-script.md changes into Storyboard Workbench"
          >
            {workspaceTask?.kind === "import" ? "Importing..." : "Import"}
          </button>
          {hasSwbWarning ? (
            <button
              type="button"
              className="import-warning"
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
                onClick={() => {
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
          <div className="save-menu-container" ref={saveMenuRef}>
            <div className="save-split-button">
              <button
                type="button"
                className="primary save-main-button"
                disabled={isWorkspaceTaskRunning}
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
                disabled={isWorkspaceTaskRunning}
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
      </header>

      {workspaceTask ? (
        <div className="workspace-task-progress" role="status" aria-live="polite">
          <div className="workspace-task-progress-copy">
            <span>{workspaceTask.label}</span>
            <span>
              {workspaceTask.current} / {workspaceTask.total} shots
            </span>
          </div>
          <div className="workspace-task-progress-track" aria-hidden="true">
            <div className="workspace-task-progress-line" />
          </div>
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
            ) : (
              <div className="selection-mode-menu" aria-label="Selection mode">
                <button
                  type="button"
                  className={selectionMode === "lasso" ? "is-selected" : ""}
                  onClick={() => {
                    setSelectionMode("lasso");
                    setSketchSettingsMenu(undefined);
                  }}
                >
                  Lasso
                </button>
                <button
                  type="button"
                  className={selectionMode === "rectangle" ? "is-selected" : ""}
                  onClick={() => {
                    setSelectionMode("rectangle");
                    setSketchSettingsMenu(undefined);
                  }}
                >
                  Rectangle
                </button>
              </div>
            )}
          </div>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={renderedShotEntries.map(({ shot }) => shot.id)} strategy={rectSortingStrategy}>
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
                  activeSketchTool={activeSketchTool}
                  selectionMode={selectionMode}
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
                  onFocusShot={() => setSelectedShotIds([shot.id])}
                  isLayerPanelOpen={isLayerPanelOpen && shot.id === primarySelectedShotId}
                  thumbnailRevision={autosaveRevision}
                  onToggleLayerPanel={() => {
                    setSelectedShotIds([shot.id]);
                    setIsLayerPanelOpen((isOpen) => (shot.id === primarySelectedShotId ? !isOpen : true));
                  }}
                  onAddLayer={(shotId) => void handleAddBitmapLayer(shotId)}
                  onRemoveLayer={(shotId, layerId) =>
                    void handleRemoveBitmapLayer(shotId, layerId)
                  }
                  onClearLayer={(shotId, layerId) => void handleClearBitmapLayer(shotId, layerId)}
                  onSelectLayer={(shotId, layerId) =>
                    updateProject((currentProject) => selectBitmapLayer(currentProject, shotId, layerId), false, false)
                  }
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
                  onSketchStroke={(layerId, stroke) => handleBitmapStroke(shot, layerId, stroke)}
                  onSelectionTransform={(layerId, dataUrl) =>
                    handleBitmapSelectionTransform(shot, layerId, dataUrl)
                  }
                />
              ))}
              {selectionBox ? <SelectionMarquee box={selectionBox} /> : null}
            </section>
          </SortableContext>

          <DragOverlay>
            {activeDialogue ? <DialoguePreview dialogue={activeDialogue} /> : null}
            {!activeDialogue && activeShotIds.length > 0 ? (
              <ShotStackPreview
                shots={orderedShots.filter((shot) => activeShotIds.includes(shot.id))}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {isAnimationMode && orderedShots.length > 0 ? (
        <Timeline
          shots={orderedShots}
          selectedShotIds={selectedShotIds}
          onSelect={(shotId) => setSelectedShotIds([shotId])}
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
  stroke: SketchStroke
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceUrl;
  }

  await drawImageUrl(context, sourceUrl, canvas.width, canvas.height);

  if (stroke.points.length >= 4) {
    drawStrokePathOnCanvas(context, stroke);
  }

  return canvas.toDataURL("image/png");
};

const aspectRatioForShot = (shot: Shot): number => {
  const canvasSize = canvasSizeForShot(shot);
  return canvasSize.width / canvasSize.height;
};
