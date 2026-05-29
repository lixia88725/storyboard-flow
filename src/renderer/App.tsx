import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Fragment,
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
import { Layer, Line, Stage } from "react-konva";
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
  deleteBitmapLayer,
  dialoguesForShot,
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
  sketchBlendModes,
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
  SketchBlendMode,
  SketchStroke,
  SketchTool,
  StrokeTool
} from "../shared/types";
import { getAnimationViewport, getStableBoardTop, maxStoryboardZoom } from "./animationViewport";
import {
  readLayerAssetSnapshots,
  restoreLayerAssetSnapshots,
  type LayerAssetSnapshot
} from "./bitmapLayerHistory";
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
import { getOnionSkinNeighbors } from "./onionSkin";
import {
  bitmapSelectionBounds,
  bitmapSelectionHandleRadiusForStage,
  bitmapSelectionHitTarget,
  blendMenuDirectionFromRects,
  layerDropPlacementFromClientY,
  layerOpacityFromClientX,
  layerRowDragIntentFromDelta,
  latestStrokeSegment,
  scaleBitmapSelectionBounds,
  shouldRenderLiveStroke,
  shouldAppendStrokePoint,
  sketchCanvasSize,
  sketchPointFromClientPoint
} from "./sketchGeometry";
import type { LayerRowDragIntent } from "./sketchGeometry";
import type { Bounds, CanvasSize, Point, SelectionCorner } from "./sketchGeometry";
import { scrollDeltaToCenterInReservedViewport } from "./viewportGeometry";

type DragData =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "drop-zone"; shotId: string };

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
const maxDialogueRows = 3;

type WorkspaceSaveState = "saved" | "saving" | "error";
type FileNameSyncState = "synced" | "unsynced";
type SelectionBox = { startX: number; startY: number; currentX: number; currentY: number };
type SketchSettingsMenu = { tool: SketchTool; x: number; y: number };
type LayerRowGesture = {
  layerId: string;
  startX: number;
  startY: number;
  intent?: LayerRowDragIntent;
};
type LayerRowGestureVisual = {
  layerId: string;
  intent: LayerRowDragIntent;
  deltaY: number;
};
type BlendMenuState = {
  layerId: string;
  direction: "down" | "up";
};
type BitmapSelection = {
  mode: BitmapSelectionMode;
  points: Point[];
  bounds: Bounds;
};
type BitmapSelectionDraft = {
  mode: BitmapSelectionMode;
  points: Point[];
};
type BitmapTransformDraft = {
  type: "move" | "scale";
  startPoint: Point;
  startBounds: Bounds;
  currentBounds: Bounds;
  corner?: SelectionCorner;
};
type PreparedBitmapTransform = {
  layerId: string;
  selection: BitmapSelection;
  sourceCanvas: HTMLCanvasElement;
  patchCanvas: HTMLCanvasElement;
};
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
      "input, textarea, select, .recent-menu, .add-shot-menu, .save-menu, .sketch-settings-menu, .shortcut-menu"
    )
  );

const dialogueLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

const clampDialogueText = (text: string) => dialogueLines(text).slice(0, maxDialogueRows).join("\n");

const dialogueRowsForText = (text: string) =>
  Math.min(maxDialogueRows, Math.max(1, dialogueLines(text).length));

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
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(defaultKeyboardShortcuts);
  const [capturingShortcutAction, setCapturingShortcutAction] = useState<ShortcutAction | undefined>();
  const [shortcutError, setShortcutError] = useState("");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const selectionBoxRef = useRef<SelectionBox | undefined>(undefined);
  const projectRef = useRef(project);
  const folderPathRef = useRef(folderPath);
  const fileNameSyncStateRef = useRef<FileNameSyncState>(fileNameSyncState);
  const selectedShotIdsRef = useRef<string[]>([]);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const saveMenuRef = useRef<HTMLDivElement | null>(null);
  const recentMenuRef = useRef<HTMLDivElement | null>(null);
  const addShotMenuRef = useRef<HTMLDivElement | null>(null);
  const shortcutMenuRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLElement | null>(null);
  const boardGridRef = useRef<HTMLElement | null>(null);
  const orderedShots = useMemo(() => sortedShots(project.shots), [project.shots]);
  const needsSwbImport = useMemo(() => projectNeedsSwbImport(project), [project]);
  const hasSwbWarning = useMemo(() => projectHasSwbWarning(project), [project]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const primarySelectedShotId = selectedShotIds[0];
  const primarySelectedShot = useMemo(
    () => orderedShots.find((shot) => shot.id === primarySelectedShotId),
    [orderedShots, primarySelectedShotId]
  );
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

    return () => {
      removeOpenListener();
      removeChangedListener();
    };
  }, []);

  useEffect(() => {
    if (autosaveRevision === 0 || !folderPath || !metadataPath || !window.storyboard) {
      return;
    }

    setWorkspaceSaveState("saving");
    const timer = window.setTimeout(() => {
      void persistWorkspace(project).catch((error) => {
        setWorkspaceSaveState("error");
        setStatus(`Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, autosaveDelayMs);

    return () => window.clearTimeout(timer);
  }, [autosaveRevision, folderPath, metadataPath, project]);

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
          const activeShot = primarySelectedShot ?? orderedShots[0];
          const activeLayer =
            activeShot
              ? bitmapLayersForShot(activeShot).find((layer) => layer.id === activeShot.activeLayerId) ??
                bitmapLayersForShot(activeShot)[0]
              : undefined;

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
      setSelectedShotIds(previous.selectedShotIds);
      setFileNameSyncState(previous.fileNameSyncState);
      setWorkspaceSaveState("saving");
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
      setSelectedShotIds(next.selectedShotIds);
      setFileNameSyncState(next.fileNameSyncState);
      setWorkspaceSaveState("saving");
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

  const persistWorkspace = async (projectToSave: Project) => {
    if (!window.storyboard || !folderPath || !metadataPath) {
      return;
    }

    await window.storyboard.autosaveWorkspace({
      project: { ...projectToSave, updatedAt: new Date().toISOString() },
      folderPath,
      metadataPath
    });
    setWorkspaceSaveState("saved");
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
    recordUndoEntry(undoEntry);
    updateProject((currentProject) => markBitmapLayerPainted(currentProject, shot.id, layer.id), false, false);
    return dataUrl;
  };

  const handleClearBitmapLayer = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer) {
      return;
    }

    const undoEntry = await createHistoryEntry([layer.bitmapPath]);
    await window.storyboard.writeLayerPng({
      folderPath,
      bitmapPath: layer.bitmapPath,
      dataUrl: await createTransparentLayerDataUrl(layer.width, layer.height)
    });
    recordUndoEntry(undoEntry);
    updateProject((currentProject) => clearBitmapLayer(currentProject, shotId, layerId), false, false);
  };

  const handleRemoveBitmapLayer = async (shotId: string, layerId: string) => {
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer) {
      return;
    }

    const undoEntry = await createHistoryEntry([layer.bitmapPath]);
    await window.storyboard.deleteLayerPng({
      folderPath,
      bitmapPath: layer.bitmapPath
    });
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
    updateProject(nextProject, false, false);
  };

  const loadFolderScan = (scan: FolderScanPayload, nextStatus: string, dirty = false) => {
    const baseProject = scan.project ?? createProject(scan.folderName || "Untitled Storyboard");
    const nextProject = mergeFolderImages(
      {
        ...baseProject,
        name: scan.project ? baseProject.name : scan.folderName || baseProject.name,
        naming: {
          ...defaultProjectNaming,
          ...baseProject.naming
        }
      },
      scan.images
    );
    const acceptedExternalEdits = projectAcceptedExternalEdits(nextProject);

    setProject(nextProject);
    setFolderPath(scan.folderPath);
    setFolderInputValue(scan.folderPath);
    setMetadataPath(scan.metadataPath);
    setWorkspaceSaveState(dirty || acceptedExternalEdits ? "saving" : "saved");
    setFileNameSyncState("synced");
    setStatus(acceptedExternalEdits ? "External TIFF edits accepted as new base" : nextStatus);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedShotIds(nextProject.shots[0] ? [nextProject.shots[0].id] : []);
    if (dirty || acceptedExternalEdits) {
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

    loadFolderScan(result, "Folder opened", !result.project);
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

    await persistWorkspace(projectToSave);
    const renamePlan = createRenamePlan(projectToSave, {
      allowDefaultNamingFields: missingNamingFields.length > 0
    });
    const renamedProject = applyRenamePlan(projectToSave, renamePlan);
    const result = await withStatus("Save failed", () =>
      window.storyboard.saveWorkspace({
        project: { ...renamedProject, updatedAt: new Date().toISOString() },
        folderPath,
        metadataPath,
        renamePlan
      }),
      setStatus
    );

    if (!result) {
      return;
    }

    setProject(result.project);
    setFolderPath(result.folderPath);
    setFolderInputValue(result.folderPath);
    setMetadataPath(result.metadataPath);
    setWorkspaceSaveState("saved");
    setFileNameSyncState("synced");
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

    const result = await withStatus(
      "Import failed",
      () =>
        window.storyboard.importSwbFormat({
          project,
          folderPath,
          metadataPath
        }),
      setStatus
    );

    if (!result) {
      return;
    }

    loadFolderScan(result, "Imported images into Storyboard Workbench Format");
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

    const nextBox = {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY
    };
    setSelectionBox(nextBox);
    setSelectedShotIds([]);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const movedBox = {
        ...nextBox,
        currentX: moveEvent.clientX,
        currentY: moveEvent.clientY
      };
      selectionBoxRef.current = movedBox;
      setSelectionBox(movedBox);
      setSelectedShotIds(shotIdsInSelectionBox(movedBox));
    };

    const handlePointerUp = () => {
      setSelectionBox(undefined);
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
        <div className="import-control">
          <button
            type="button"
            onClick={() => void handleImportSwbFormat()}
            disabled={!needsSwbImport}
            title="Convert non-SWB images into Storyboard Workbench Format"
          >
            Import
          </button>
          {hasSwbWarning ? (
            <span
              className="import-warning"
              title="Import will move original files to Archive/YYYY-MM-DD-HHMMSS. Compatible external TIFF edits are accepted automatically; incompatible edits require manual import or resolve."
            >
              !
            </span>
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
                onClick={() => {
                  setIsSaveMenuOpen(false);
                  void handleSaveProject();
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="primary save-menu-toggle"
                aria-label="Save naming options"
                aria-expanded={isSaveMenuOpen}
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

      <div className="workspace-layout">
        <aside className="tool-rail" aria-label="Sketch tools">
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
              const activeLayer =
                bitmapLayersForShot(primarySelectedShot).find(
                  (layer) => layer.id === primarySelectedShot.activeLayerId
                ) ?? bitmapLayersForShot(primarySelectedShot)[0];
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
          <SortableContext items={orderedShots.map((shot) => shot.id)} strategy={rectSortingStrategy}>
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
              {orderedShots.map((shot, index) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  index={index}
                  project={project}
                  folderPath={folderPath}
                  isSelected={selectedShotIds.length > 1 && selectedShotIds.includes(shot.id)}
                  isAnimationFocused={isAnimationMode && shot.id === primarySelectedShotId}
                  activeSketchTool={activeSketchTool}
                  selectionMode={selectionMode}
                  brushColor={brushColor}
                  brushOpacity={brushOpacity}
                  brushSize={brushSize}
                  eraserOpacity={eraserOpacity}
                  eraserSize={eraserSize}
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
                  onUpdateLayer={(shotId, layerId, patch) =>
                    updateProject((currentProject) =>
                      updateBitmapLayer(currentProject, shotId, layerId, patch)
                    , false)
                  }
                  onMoveLayer={(shotId, layerId, targetLayerId, placement) =>
                    updateProject((currentProject) =>
                      moveBitmapLayer(currentProject, shotId, layerId, targetLayerId, placement)
                    , false)
                  }
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

const shotIdsInSelectionBox = (box: SelectionBox): string[] => {
  const left = Math.min(box.startX, box.currentX);
  const right = Math.max(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const bottom = Math.max(box.startY, box.currentY);

  return Array.from(document.querySelectorAll<HTMLElement>("[data-shot-id]"))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
    })
    .map((element) => element.dataset.shotId)
    .filter((shotId): shotId is string => Boolean(shotId));
};

const SelectionMarquee = ({ box }: { box: SelectionBox }) => {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);

  return <div className="selection-marquee" style={{ left, top, width, height }} />;
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

const GearIcon = () => (
  <svg className="tool-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M13.5 5h5l.8 3.2 2.7 1.1 2.8-1.7 3.5 3.5-1.7 2.8 1.1 2.7 3.3.9v5l-3.3.8-1.1 2.7 1.7 2.8-3.5 3.5-2.8-1.7-2.7 1.1-.8 3.3h-5l-.8-3.3-2.7-1.1-2.8 1.7-3.5-3.5 1.7-2.8-1.1-2.7-3.3-.8v-5l3.3-.9 1.1-2.7-1.7-2.8 3.5-3.5 2.8 1.7 2.7-1.1z" />
    <circle cx="16" cy="18" r="4.2" />
  </svg>
);

const BrushIcon = () => (
  <svg className="tool-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M20.5 5.5 26.5 11.5 14 24 8 18z" />
    <path d="M7.5 18.5c-2.5 2-2.5 5.5-1 7 1.5-2 4.5-1.5 6.5-4z" />
  </svg>
);

const EraserIcon = () => (
  <svg className="tool-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M9 20 19 10c1.4-1.4 3.5-1.4 4.9 0l2.1 2.1c1.4 1.4 1.4 3.5 0 4.9l-9 9H8l-2-2z" />
    <path d="M14 15 21 22" />
    <path d="M16 26h10" />
  </svg>
);

const SelectIcon = () => (
  <svg className="tool-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M10.5 8.5c-3.1 1.5-4.8 4-4.1 6.5 1 3.9 7 5.7 13.5 4.1 4.9-1.2 7.9-3.6 7.5-6.1-.4-2.6-4.5-3.9-9.2-2.9-3.4.7-5.7 2.2-5.4 3.6.3 1.3 2.9 1.8 5.9 1.1" />
    <path d="M19.2 19.2 14.5 27l-2.1-8.6" />
    <path d="M14.5 27 9.7 23.6" />
  </svg>
);

const ClearIcon = () => (
  <svg className="tool-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M9 10h14" />
    <path d="M12 10l1 16h6l1-16" />
    <path d="M13 10l1-4h4l1 4" />
    <path d="M15 14v8" />
    <path d="M18 14v8" />
  </svg>
);

type SketchSettingSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
};

const SketchSettingSlider = ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: SketchSettingSliderProps) => (
  <label className="sketch-setting">
    <span>{label}</span>
    <strong>
      {value}
      {suffix}
    </strong>
    <input
      aria-label={label}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

const BrushSwatchPicker = ({
  swatches,
  activeColor,
  onPickColor,
  onChangeSwatch
}: {
  swatches: string[];
  activeColor: string;
  onPickColor: (color: string) => void;
  onChangeSwatch: (index: number, color: string) => void;
}) => {
  const colorInputs = useRef<Array<HTMLInputElement | null>>([]);

  return (
    <div className="brush-swatch-picker" aria-label="Brush swatches">
      {swatches.map((color, index) => (
        <button
          key={index}
          type="button"
          className={color.toLowerCase() === activeColor.toLowerCase() ? "is-selected" : ""}
          style={{ backgroundColor: color }}
          aria-label={`Brush swatch ${index + 1}`}
          title="Click to pick, double-click to edit"
          onClick={() => onPickColor(color)}
          onDoubleClick={() => colorInputs.current[index]?.click()}
        >
          <input
            ref={(element) => {
              colorInputs.current[index] = element;
            }}
            aria-label={`Brush swatch ${index + 1} color`}
            type="color"
            value={color}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChangeSwatch(index, event.target.value)}
          />
        </button>
      ))}
    </div>
  );
};

type LayerPanelProps = {
  shot?: Shot;
  folderPath?: string;
  thumbnailRevision: number;
  isOpen: boolean;
  isRendered: boolean;
  onToggle: () => void;
  onAddLayer: (shotId: string) => void;
  onRemoveLayer: (shotId: string, layerId: string) => void;
  onClearLayer: (shotId: string, layerId: string) => void;
  onSelectLayer: (shotId: string, layerId: string) => void;
  onUpdateLayer: (
    shotId: string,
    layerId: string,
    patch: Partial<Pick<BitmapLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>
  ) => void;
  onMoveLayer: (
    shotId: string,
    layerId: string,
    targetLayerId: string,
    placement: "before" | "after"
  ) => void;
};

const LayerPanel = ({
  shot,
  folderPath,
  thumbnailRevision,
  isOpen,
  isRendered,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onClearLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer
}: LayerPanelProps) => {
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const displayLayers = [...layers].reverse();
  const activeLayer = layers.find((layer) => layer.id === shot?.activeLayerId) ?? layers[0];
  const activeLayerId = activeLayer?.id;
  const [openBlendMenu, setOpenBlendMenu] = useState<BlendMenuState | undefined>();
  const [rowGestureVisual, setRowGestureVisual] = useState<LayerRowGestureVisual | undefined>();

  const interactiveLayerRowTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement
      ? target.closest("button, textarea, select, .layer-blend-menu")
      : null;
  };

  const layerRowFromPoint = (clientX: number, clientY: number, excludedLayerId?: string) => {
    const directRow = document
      .elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.classList.contains("layer-row") &&
        element.dataset.layerId !== excludedLayerId
      );
    if (directRow) {
      return directRow;
    }

    const layerList = document
      .elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("layer-list")
      );
    if (!layerList) {
      return undefined;
    }

    const rows = Array.from(layerList.querySelectorAll<HTMLElement>(".layer-row")).filter(
      (row) => row.dataset.layerId !== excludedLayerId
    );
    return clientY < (rows[0]?.getBoundingClientRect().top ?? 0) ? rows[0] : rows.at(-1);
  };

  const beginLayerRowGesture = (event: PointerEvent<HTMLDivElement>, layer: BitmapLayer) => {
    if (!shot || event.button !== 0 || interactiveLayerRowTarget(event.target)) {
      return;
    }

    event.stopPropagation();
    onSelectLayer(shot.id, layer.id);
    setOpenBlendMenu(undefined);
    const initialTarget = event.target;

    const gesture: LayerRowGesture = {
      layerId: layer.id,
      startX: event.clientX,
      startY: event.clientY
    };

    const updateOpacity = (clientX: number) => {
      const row = document.querySelector<HTMLElement>(`[data-layer-id="${gesture.layerId}"]`);
      if (!row) {
        return;
      }

      const rect = row.getBoundingClientRect();
      onUpdateLayer(
        shot.id,
        gesture.layerId,
        { opacity: layerOpacityFromClientX(clientX, rect.left, rect.width) }
      );
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - gesture.startX;
      const deltaY = moveEvent.clientY - gesture.startY;

      if (!gesture.intent) {
        const intent = layerRowDragIntentFromDelta(deltaX, deltaY);
        if (!intent) {
          return;
        }
        moveEvent.preventDefault();
        if (initialTarget instanceof HTMLInputElement) {
          initialTarget.blur();
        }
        gesture.intent = intent;
        setRowGestureVisual({ layerId: gesture.layerId, intent, deltaY: intent === "reorder" ? deltaY : 0 });
      }

      if (gesture.intent === "opacity") {
        moveEvent.preventDefault();
        updateOpacity(moveEvent.clientX);
      } else if (gesture.intent === "reorder") {
        moveEvent.preventDefault();
        setRowGestureVisual({ layerId: gesture.layerId, intent: "reorder", deltaY });
      }
    };

    const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
      if (gesture.intent) {
        upEvent.preventDefault();
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      setRowGestureVisual(undefined);

      if (gesture.intent === "reorder") {
        const targetRow = layerRowFromPoint(upEvent.clientX, upEvent.clientY, gesture.layerId);
        const targetLayerId = targetRow?.dataset.layerId;
        if (targetRow && targetLayerId && targetLayerId !== gesture.layerId) {
          const rect = targetRow.getBoundingClientRect();
          onMoveLayer(
            shot.id,
            gesture.layerId,
            targetLayerId,
            layerDropPlacementFromClientY(upEvent.clientY, rect.top, rect.height)
          );
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
  };

  return (
    <div
      className={`shot-layer-popover ${isRendered ? (isOpen ? "is-open" : "is-closing") : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => event.stopPropagation()}
      onDragOver={(event) => event.stopPropagation()}
      onDrop={(event) => event.stopPropagation()}
    >
      {isRendered ? (
        <section
          className="layer-panel"
          aria-label="Storyboard layers"
        >
          {shot ? (
            <div className="layer-list">
              {displayLayers.map((layer) => {
                const layerBlendMode = layer.blendMode ?? "normal";
                const rowVisual =
                  rowGestureVisual?.layerId === layer.id ? rowGestureVisual : undefined;
                return (
                  <div
                    key={layer.id}
                    data-layer-id={layer.id}
                    className={`layer-row ${rowVisual ? `is-${rowVisual.intent}-dragging is-dragging-layer` : ""} ${
                      layer.id === activeLayerId ? "is-active" : ""
                    } ${
                      layer.visible ? "" : "is-hidden"
                    }`}
                    style={{
                      "--layer-opacity-width": `${Math.round((layer.opacity ?? 1) * 100)}%`,
                      transform:
                        rowVisual?.intent === "reorder"
                          ? `translateY(${rowVisual.deltaY}px)`
                          : undefined
                    } as CSSProperties}
                    onClick={() => onSelectLayer(shot.id, layer.id)}
                    onPointerDown={(event) => beginLayerRowGesture(event, layer)}
                  >
                    <button
                      type="button"
                      className="layer-select"
                      draggable={false}
                      title={layer.visible ? "Hide layer" : "Show layer"}
                      aria-label={layer.visible ? "Hide layer" : "Show layer"}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateLayer(shot.id, layer.id, { visible: !layer.visible });
                      }}
                    >
                      <span className={layer.visible ? "layer-eye is-on" : "layer-eye"} />
                    </button>
                    <BitmapLayerThumbnail
                      layer={layer}
                      shot={shot}
                      folderPath={folderPath}
                      revision={thumbnailRevision}
                    />
                    <input
                      aria-label="Layer name"
                      value={layer.name}
                      draggable={false}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onUpdateLayer(shot.id, layer.id, { name: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className={`layer-blend-dot layer-blend-dot-${layerBlendMode}`}
                      draggable={false}
                      title={`Blend mode: ${blendModeLabel(layerBlendMode)}`}
                      aria-label={`Layer blend mode: ${layerBlendMode}`}
                      aria-expanded={openBlendMenu?.layerId === layer.id}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rowRect = event.currentTarget
                          .closest(".layer-row")
                          ?.getBoundingClientRect();
                        const listRect = event.currentTarget
                          .closest(".layer-list")
                          ?.getBoundingClientRect();
                        const direction =
                          rowRect && listRect
                            ? blendMenuDirectionFromRects(
                                rowRect.top,
                                rowRect.bottom,
                                listRect.top,
                                listRect.bottom
                              )
                            : "down";
                        setOpenBlendMenu((current) => {
                          if (current?.layerId === layer.id) {
                            return undefined;
                          }

                          return {
                            layerId: layer.id,
                            direction
                          };
                        });
                      }}
                    />
                    {openBlendMenu?.layerId === layer.id ? (
                      <div
                        className={`layer-blend-menu layer-blend-menu-${openBlendMenu.direction}`}
                        role="menu"
                        aria-label="Layer blend mode options"
                      >
                        {sketchBlendModes.map((blendMode) => (
                          <button
                            key={blendMode}
                            type="button"
                            className={layerBlendMode === blendMode ? "is-selected" : ""}
                            role="menuitem"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpdateLayer(shot.id, layer.id, { blendMode });
                              setOpenBlendMenu(undefined);
                            }}
                          >
                            <span className={`layer-blend-dot layer-blend-dot-${blendMode}`} />
                            {blendModeLabel(blendMode)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="layer-empty">Select a shot to edit layers.</p>
          )}
          <div className="layer-panel-footer">
            <button
              type="button"
              onClick={() => {
                if (shot) {
                  onAddLayer(shot.id);
                }
              }}
              disabled={!shot}
              title="Add layer"
              aria-label="Add layer"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                if (shot && activeLayer) {
                  onRemoveLayer(shot.id, activeLayer.id);
                }
              }}
              disabled={!shot || !activeLayer || layers.length <= 1}
              title="Delete current layer"
              aria-label="Delete current layer"
            >
              -
            </button>
          </div>
        </section>
      ) : null}
      <button
        type="button"
        className={`layer-toggle ${isOpen ? "is-open" : ""}`}
        onClick={onToggle}
        title="Layers"
        aria-label="Toggle shot layers"
        aria-expanded={isOpen}
      />
    </div>
  );
};

const BitmapLayerThumbnail = ({
  layer,
  shot,
  folderPath,
  revision
}: {
  layer: BitmapLayer;
  shot: Shot;
  folderPath?: string;
  revision: number;
}) => {
  const fallbackImageSrc =
    layer.kind === "image" && !layer.cleared
      ? window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)
      : undefined;
  const [thumbnailSrc, setThumbnailSrc] = useState<string | undefined>(fallbackImageSrc);

  useEffect(() => {
    let cancelled = false;

    const loadThumbnail = async () => {
      if (layer.cleared) {
        setThumbnailSrc(undefined);
        return;
      }

      const layerDataUrl = folderPath
        ? await window.storyboard
            .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
            .catch(() => undefined)
        : undefined;

      if (!cancelled) {
        setThumbnailSrc(layerDataUrl ?? fallbackImageSrc);
      }
    };

    void loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [fallbackImageSrc, folderPath, layer.bitmapPath, layer.cleared, revision]);

  return (
    <div
      className={`layer-thumb ${layer.kind === "image" ? "layer-thumb-image" : ""}`}
      aria-hidden="true"
    >
      {thumbnailSrc ? <img src={thumbnailSrc} alt="" draggable={false} /> : null}
    </div>
  );
};

const blendModeLabel = (blendMode: SketchBlendMode): string => {
  if (blendMode === "multiply") {
    return "Multiply";
  }

  if (blendMode === "screen") {
    return "Screen";
  }

  return "Normal";
};

const canvasBlendMode = (blendMode: SketchBlendMode | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "source-over";
};

const cssBlendMode = (blendMode: BitmapLayer["blendMode"] | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "normal";
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

const drawStrokePathOnCanvas = (
  context: CanvasRenderingContext2D,
  stroke: SketchStroke,
  segment?: readonly [number, number, number, number]
) => {
  context.save();
  context.globalAlpha = stroke.opacity ?? 1;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  if (segment) {
    context.moveTo(segment[0], segment[1]);
    context.lineTo(segment[2], segment[3]);
  } else {
    context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index], stroke.points[index + 1]);
    }
  }

  context.stroke();
  context.restore();
};

const drawImageUrl = (
  context: CanvasRenderingContext2D,
  sourceUrl: string,
  width: number,
  height: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve();
    };
    image.onerror = () => reject(new Error("Could not load layer bitmap"));
    image.src = sourceUrl;
  });

const BitmapSelectionOverlay = ({
  selection,
  draft,
  transformBounds,
  stageSize,
  canvasSize
}: {
  selection?: BitmapSelection;
  draft?: BitmapSelectionDraft;
  transformBounds?: Bounds;
  stageSize: CanvasSize;
  canvasSize: CanvasSize;
}) => {
  const scaleX = stageSize.width / canvasSize.width;
  const scaleY = stageSize.height / canvasSize.height;
  const activeBounds = transformBounds ?? selection?.bounds;
  const draftSelection = draft ? buildOverlaySelection(draft) : undefined;
  const points = draftSelection?.points ?? selection?.points;
  const pathPoints = points?.map((point) => `${point.x * scaleX},${point.y * scaleY}`).join(" ");

  return (
    <svg className="bitmap-selection-overlay" viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}>
      {pathPoints ? <polygon className="bitmap-selection-outline" points={pathPoints} /> : null}
      {activeBounds ? (
        <>
          <rect
            className="bitmap-selection-bounds"
            x={activeBounds.x * scaleX}
            y={activeBounds.y * scaleY}
            width={activeBounds.width * scaleX}
            height={activeBounds.height * scaleY}
          />
          {[
            [activeBounds.x, activeBounds.y],
            [activeBounds.x + activeBounds.width, activeBounds.y],
            [activeBounds.x, activeBounds.y + activeBounds.height],
            [activeBounds.x + activeBounds.width, activeBounds.y + activeBounds.height]
          ].map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              className="bitmap-selection-handle"
              x={x * scaleX - 4}
              y={y * scaleY - 4}
              width={8}
              height={8}
            />
          ))}
        </>
      ) : null}
    </svg>
  );
};

const buildOverlaySelection = (draft: BitmapSelectionDraft): BitmapSelection | undefined => {
  const points =
    draft.mode === "rectangle" && draft.points.length >= 2
      ? [
          draft.points[0],
          { x: draft.points[1].x, y: draft.points[0].y },
          draft.points[1],
          { x: draft.points[0].x, y: draft.points[1].y }
        ]
      : draft.points;
  const bounds = bitmapSelectionBounds(points);
  return bounds ? { mode: draft.mode, points, bounds } : undefined;
};

const canvasSizeForShot = (shot: Shot): CanvasSize => {
  const width = shot.swb?.canvasWidth;
  const height = shot.swb?.canvasHeight;

  return width && height ? { width, height } : sketchCanvasSize;
};

const aspectRatioForShot = (shot: Shot): number => {
  const canvasSize = canvasSizeForShot(shot);
  return canvasSize.width / canvasSize.height;
};

type ShotCardProps = {
  shot: Shot;
  index: number;
  project: Project;
  folderPath?: string;
  isSelected: boolean;
  isAnimationFocused: boolean;
  activeSketchTool: SketchTool;
  selectionMode: BitmapSelectionMode;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  editingDialogueId?: string;
  isLayerPanelOpen: boolean;
  thumbnailRevision: number;
  onSelect: (event: MouseEvent) => void;
  onFocusShot: () => void;
  onToggleLayerPanel: () => void;
  onAddLayer: (shotId: string) => void;
  onRemoveLayer: (shotId: string, layerId: string) => void;
  onClearLayer: (shotId: string, layerId: string) => void;
  onSelectLayer: (shotId: string, layerId: string) => void;
  onUpdateLayer: (
    shotId: string,
    layerId: string,
    patch: Partial<Pick<BitmapLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>
  ) => void;
  onMoveLayer: (
    shotId: string,
    layerId: string,
    targetLayerId: string,
    placement: "before" | "after"
  ) => void;
  onCreateDialogue: (shotId: string) => void;
  onDialogueText: (dialogueId: string, text: string) => void;
  onDialogueBlur: (dialogue: Dialogue) => void;
  onSketchStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string) => Promise<string | undefined>;
};

const ShotCard = ({
  shot,
  index,
  project,
  folderPath,
  isSelected,
  isAnimationFocused,
  activeSketchTool,
  selectionMode,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  onionSkinPreviousShot,
  onionSkinNextShot,
  editingDialogueId,
  isLayerPanelOpen,
  thumbnailRevision,
  onSelect,
  onFocusShot,
  onToggleLayerPanel,
  onAddLayer,
  onRemoveLayer,
  onClearLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onCreateDialogue,
  onDialogueText,
  onDialogueBlur,
  onSketchStroke,
  onSelectionTransform
}: ShotCardProps) => {
  const [isLayerPanelRendered, setIsLayerPanelRendered] = useState(isLayerPanelOpen);
  const sortable = useSortable({
    id: shot.id,
    data: { type: "shot", shotId: shot.id } satisfies DragData
  });
  const dropZone = useDroppable({
    id: `dialogue-zone-${shot.id}`,
    data: { type: "drop-zone", shotId: shot.id } satisfies DragData
  });
  const dialogues = dialoguesForShot(project, shot.id);
  const isLayerPanelVisible = isLayerPanelOpen || isLayerPanelRendered;
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };

  useEffect(() => {
    if (isLayerPanelOpen) {
      setIsLayerPanelRendered(true);
      return;
    }

    const timeout = window.setTimeout(() => setIsLayerPanelRendered(false), 140);
    return () => window.clearTimeout(timeout);
  }, [isLayerPanelOpen]);

  return (
    <article
      ref={sortable.setNodeRef}
      className={`shot-card ${sortable.isDragging ? "is-dragging" : ""} ${
        isSelected ? "is-selected" : ""
      } ${isAnimationFocused ? "is-animation-focus" : ""} ${
        isLayerPanelVisible ? "has-layer-panel-open" : ""
      }`}
      style={style}
      data-shot-id={shot.id}
      onClick={onSelect}
    >
      <div
        className="shot-head"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        title="Drag to reorder shot"
      >
        <span className="shot-index">{String(index + 1).padStart(3, "0")}</span>
        <span className="shot-head-grip" aria-hidden="true" />
      </div>

      <div className={`shot-image-shell ${isLayerPanelVisible ? "has-layer-panel" : ""}`}>
        <SketchPad
          shot={shot}
          folderPath={folderPath}
          tool={activeSketchTool}
          selectionMode={selectionMode}
          brushColor={brushColor}
          brushOpacity={brushOpacity}
          brushSize={brushSize}
          eraserOpacity={eraserOpacity}
          eraserSize={eraserSize}
          onionSkinPreviousShot={onionSkinPreviousShot}
          onionSkinNextShot={onionSkinNextShot}
          onStroke={onSketchStroke}
          onSelectionTransform={onSelectionTransform}
          onFocusShot={onFocusShot}
        />
        <LayerPanel
          shot={shot}
          folderPath={folderPath}
          thumbnailRevision={thumbnailRevision}
          isOpen={isLayerPanelOpen}
          isRendered={isLayerPanelVisible}
          onToggle={onToggleLayerPanel}
          onAddLayer={onAddLayer}
          onRemoveLayer={onRemoveLayer}
          onClearLayer={onClearLayer}
          onSelectLayer={onSelectLayer}
          onUpdateLayer={onUpdateLayer}
          onMoveLayer={onMoveLayer}
        />
      </div>

      <div
        ref={dropZone.setNodeRef}
        className={`dialogue-zone ${dropZone.isOver ? "is-over" : ""}`}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".dialogue-card")) {
            return;
          }
          onCreateDialogue(shot.id);
        }}
      >
        {dialogues.length === 0 ? (
          <p className="drop-hint">Double-click to type dialogue</p>
        ) : null}
        {dialogues.map((dialogue) => (
          <DialogueCard
            key={dialogue.id}
            dialogue={dialogue}
            isEditing={dialogue.id === editingDialogueId}
            onChange={(text) => onDialogueText(dialogue.id, text)}
            onBlur={() => onDialogueBlur(dialogue)}
          />
        ))}
      </div>
    </article>
  );
};

type DialogueCardProps = {
  dialogue: Dialogue;
  isEditing: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
};

const DialogueCard = ({ dialogue, isEditing, onChange, onBlur }: DialogueCardProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rows = dialogueRowsForText(dialogue.text);
  const sortable = useSortable({
    id: dialogue.id,
    data: {
      type: "dialogue",
      dialogueId: dialogue.id,
      shotId: dialogue.shotId
    } satisfies DragData
  });

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
    }
  }, [isEditing]);

  return (
    <div
      ref={sortable.setNodeRef}
      className="dialogue-card"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition
      }}
    >
      <button
        type="button"
        className="dialogue-grip"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        title="Drag dialogue to another shot"
      >
        ::
      </button>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={dialogue.text}
        onChange={(event) => onChange(clampDialogueText(event.target.value))}
        onBlur={onBlur}
      />
    </div>
  );
};

const DialoguePreview = ({ dialogue }: { dialogue: Dialogue }) => {
  return <div className="dialogue-preview">{dialogue.text || "Empty dialogue"}</div>;
};

const Timeline = ({
  shots,
  selectedShotIds,
  onSelect
}: {
  shots: Shot[];
  selectedShotIds: string[];
  onSelect: (shotId: string) => void;
}) => {
  return (
    <aside className="timeline" aria-label="Timeline">
      {shots.map((shot, index) => (
        <button
          type="button"
          key={shot.id}
          className={`timeline-shot ${selectedShotIds.includes(shot.id) ? "is-selected" : ""}`}
          onClick={() => onSelect(shot.id)}
          title={shot.fileName}
        >
          <img
            src={window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)}
            alt=""
            draggable={false}
          />
          <span>{String(index + 1).padStart(3, "0")}</span>
        </button>
      ))}
    </aside>
  );
};

const ShotStackPreview = ({ shots }: { shots: Shot[] }) => {
  const visibleShots = shots.slice(0, 4);

  return (
    <div className="shot-stack-preview">
      {visibleShots.map((shot, index) => (
        <div
          key={shot.id}
          className="shot-stack-card"
          style={{
            transform: `translate(${index * 10}px, ${index * 8}px) rotate(${index * 1.5 - 2}deg)`,
            zIndex: visibleShots.length - index
          }}
        >
          <img
            src={window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)}
            alt=""
            draggable={false}
          />
          <span>{shot.fileName}</span>
        </div>
      ))}
      {shots.length > 1 ? <strong>{shots.length}</strong> : null}
    </div>
  );
};

type SketchPadProps = {
  shot: Shot;
  folderPath?: string;
  tool: SketchTool;
  selectionMode: BitmapSelectionMode;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string) => Promise<string | undefined>;
  onFocusShot: () => void;
};

const SketchPad = ({
  shot,
  folderPath,
  tool,
  selectionMode,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  onionSkinPreviousShot,
  onionSkinNextShot,
  onStroke,
  onSelectionTransform,
  onFocusShot
}: SketchPadProps) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftStroke, setDraftStroke] = useState<SketchStroke | undefined>();
  const [stageSize, setStageSize] = useState(sketchCanvasSize);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef(false);
  const draftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const draftStrokeRenderFrameRef = useRef<number | undefined>(undefined);
  const pendingDraftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const liveBitmapCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const liveBitmapLayerIdRef = useRef<string | undefined>(undefined);
  const liveBitmapEditRunRef = useRef(0);
  const transformPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapSelectionRef = useRef<BitmapSelection | undefined>(undefined);
  const selectionDraftRef = useRef<BitmapSelectionDraft | undefined>(undefined);
  const transformDraftRef = useRef<BitmapTransformDraft | undefined>(undefined);
  const preparedTransformRef = useRef<PreparedBitmapTransform | undefined>(undefined);
  const transformPrepareRunRef = useRef(0);
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const canvasSize = useMemo(() => canvasSizeForShot(shot), [shot]);
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const activeLayer = useMemo(
    () => bitmapLayers.find((layer) => layer.id === shot.activeLayerId) ?? bitmapLayers[0],
    [bitmapLayers, shot.activeLayerId]
  );
  const activeDrawingLayerId = activeLayer?.id ?? imageBitmapLayerId;
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});
  const [liveBitmapLayerId, setLiveBitmapLayerId] = useState<string | undefined>();
  const [bitmapSelection, setBitmapSelection] = useState<BitmapSelection | undefined>();
  const [selectionDraft, setSelectionDraft] = useState<BitmapSelectionDraft | undefined>();
  const [transformDraft, setTransformDraft] = useState<BitmapTransformDraft | undefined>();
  const [isTransformPreviewReady, setIsTransformPreviewReady] = useState(false);

  useEffect(() => {
    draftStrokeRef.current = draftStroke;
  }, [draftStroke]);

  useEffect(
    () => () => {
      if (draftStrokeRenderFrameRef.current !== undefined) {
        window.cancelAnimationFrame(draftStrokeRenderFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    clearBitmapSelectionState();
  }, [activeDrawingLayerId, selectionMode, shot.id]);

  useEffect(() => {
    if (tool !== "select") {
      clearBitmapSelectionState();
    }
  }, [tool]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearBitmapSelectionState();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLayers = async () => {
      const entries = await Promise.all(
        bitmapLayers.map(async (layer) => {
          if (layer.cleared) {
            return [layer.id, undefined] as const;
          }

          const dataUrl = folderPath
            ? await window.storyboard
                .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
                .catch(() => undefined)
            : undefined;
          return [layer.id, dataUrl] as const;
        })
      );

      if (!cancelled) {
        setLayerDataUrls(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
        );
      }
    };

    void loadLayers();

    return () => {
      cancelled = true;
    };
  }, [bitmapLayers, folderPath, shot]);

  useEffect(() => {
    const element = imageStageRef.current;
    if (!element) {
      return;
    }

    const updateStageSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    };

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!isDrawing) {
      return;
    }

    const finishGlobalStroke = () => {
      if (tool === "select") {
        void finishBitmapSelection();
        updateDrawingState(false);
        return;
      }

      const currentStroke = draftStrokeRef.current;
      if (currentStroke && currentStroke.points.length >= 4) {
        void commitStroke(activeDrawingLayerId, currentStroke);
      } else {
        clearDraftStroke();
      }

      updateDrawingState(false);
    };

    window.addEventListener("mouseup", finishGlobalStroke, { once: true });
    window.addEventListener("touchend", finishGlobalStroke, { once: true });

    return () => {
      window.removeEventListener("mouseup", finishGlobalStroke);
      window.removeEventListener("touchend", finishGlobalStroke);
    };
  }, [activeDrawingLayerId, isDrawing, onStroke, tool, selectionDraft, transformDraft, bitmapSelection]);

  const commitStroke = async (layerId: string, stroke: SketchStroke) => {
    try {
      const renderedDataUrl =
        stroke.tool === "eraser" && liveBitmapLayerIdRef.current === layerId
          ? liveBitmapCanvasRefs.current[layerId]?.toDataURL("image/png")
          : undefined;
      const dataUrl = await onStroke(layerId, stroke, renderedDataUrl);
      if (dataUrl) {
        setLayerDataUrls((current) => ({ ...current, [layerId]: dataUrl }));
      }
    } finally {
      if (draftStrokeRef.current?.id === stroke.id) {
        clearDraftStroke();
      }
      clearLiveBitmapEdit();
    }
  };

  const scheduleDraftStrokeRender = (stroke: SketchStroke) => {
    pendingDraftStrokeRef.current = stroke;
    if (draftStrokeRenderFrameRef.current !== undefined) {
      return;
    }

    draftStrokeRenderFrameRef.current = window.requestAnimationFrame(() => {
      draftStrokeRenderFrameRef.current = undefined;
      setDraftStroke(pendingDraftStrokeRef.current);
    });
  };

  const clearDraftStroke = () => {
    if (draftStrokeRenderFrameRef.current !== undefined) {
      window.cancelAnimationFrame(draftStrokeRenderFrameRef.current);
      draftStrokeRenderFrameRef.current = undefined;
    }

    pendingDraftStrokeRef.current = undefined;
    setDraftStroke(undefined);
    draftStrokeRef.current = undefined;
  };

  const updateDrawingState = (drawing: boolean) => {
    isDrawingRef.current = drawing;
    setIsDrawing(drawing);
  };

  const updateBitmapSelectionState = (selection: BitmapSelection | undefined) => {
    bitmapSelectionRef.current = selection;
    setBitmapSelection(selection);
  };

  const updateSelectionDraftState = (draft: BitmapSelectionDraft | undefined) => {
    selectionDraftRef.current = draft;
    setSelectionDraft(draft);
  };

  const updateTransformDraftState = (draft: BitmapTransformDraft | undefined) => {
    transformDraftRef.current = draft;
    setTransformDraft(draft);
  };

  const clearBitmapSelectionState = () => {
    updateBitmapSelectionState(undefined);
    updateSelectionDraftState(undefined);
    updateTransformDraftState(undefined);
    clearPreparedTransform();
  };

  const clearPreparedTransform = () => {
    transformPrepareRunRef.current += 1;
    preparedTransformRef.current = undefined;
    setIsTransformPreviewReady(false);
    const previewCanvas = transformPreviewCanvasRef.current;
    previewCanvas?.getContext("2d")?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  };

  const layerSourceUrl = (layer: BitmapLayer) =>
    layerDataUrls[layer.id] ?? (layer.kind === "image" && !layer.cleared ? imageSrc : undefined);

  const prepareLiveBitmapEdit = async (layer: BitmapLayer) => {
    const editRun = liveBitmapEditRunRef.current + 1;
    liveBitmapEditRunRef.current = editRun;
    const canvas = liveBitmapCanvasRefs.current[layer.id];
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    canvas.width = Math.max(1, Math.round(layer.width));
    canvas.height = Math.max(1, Math.round(layer.height));
    context.clearRect(0, 0, canvas.width, canvas.height);

    const sourceUrl = layerSourceUrl(layer);
    if (sourceUrl) {
      await drawImageUrl(context, sourceUrl, canvas.width, canvas.height).catch(() => {
        context.clearRect(0, 0, canvas.width, canvas.height);
      });
    }

    if (liveBitmapEditRunRef.current !== editRun || draftStrokeRef.current?.tool !== "eraser") {
      return;
    }

    liveBitmapLayerIdRef.current = layer.id;
    setLiveBitmapLayerId(layer.id);

    const currentStroke = draftStrokeRef.current;
    if (currentStroke?.tool === "eraser" && currentStroke.points.length >= 4) {
      drawStrokePathOnCanvas(context, currentStroke);
    }
  };

  const drawLiveBitmapSegment = (stroke: SketchStroke) => {
    if (stroke.tool !== "eraser" || !activeLayer || liveBitmapLayerIdRef.current !== activeLayer.id) {
      return;
    }

    const segment = latestStrokeSegment(stroke);
    const canvas = liveBitmapCanvasRefs.current[activeLayer.id];
    const context = canvas?.getContext("2d");

    if (!segment || !context) {
      return;
    }

    drawStrokePathOnCanvas(context, stroke, segment);
  };

  const clearLiveBitmapEdit = () => {
    liveBitmapEditRunRef.current += 1;
    liveBitmapLayerIdRef.current = undefined;
    setLiveBitmapLayerId(undefined);
  };

  const buildBitmapSelection = (draft: BitmapSelectionDraft): BitmapSelection | undefined => {
    const points =
      draft.mode === "rectangle" && draft.points.length >= 2
        ? [
            draft.points[0],
            { x: draft.points[1].x, y: draft.points[0].y },
            draft.points[1],
            { x: draft.points[0].x, y: draft.points[1].y }
          ]
        : draft.points;
    const bounds = bitmapSelectionBounds(points);

    if (!bounds || bounds.width < 2 || bounds.height < 2) {
      return undefined;
    }

    return { mode: draft.mode, points, bounds };
  };

  const drawSelectionMask = (
    context: CanvasRenderingContext2D,
    selection: BitmapSelection,
    offset: Point = { x: 0, y: 0 }
  ) => {
    context.beginPath();
    selection.points.forEach((point, index) => {
      const x = point.x - offset.x;
      const y = point.y - offset.y;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
  };

  const prepareTransformPreview = async (selection: BitmapSelection) => {
    if (!activeLayer) {
      return;
    }

    const prepareRun = transformPrepareRunRef.current + 1;
    transformPrepareRunRef.current = prepareRun;
    setIsTransformPreviewReady(false);

    const previewCanvas = transformPreviewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");
    if (!previewCanvas || !previewContext) {
      return;
    }

    const canvasWidth = Math.max(1, Math.round(activeLayer.width));
    const canvasHeight = Math.max(1, Math.round(activeLayer.height));
    if (previewCanvas.width !== canvasWidth) {
      previewCanvas.width = canvasWidth;
    }
    if (previewCanvas.height !== canvasHeight) {
      previewCanvas.height = canvasHeight;
    }

    const sourceUrl = layerSourceUrl(activeLayer);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = canvasWidth;
    sourceCanvas.height = canvasHeight;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) {
      return;
    }

    if (sourceUrl) {
      await drawImageUrl(sourceContext, sourceUrl, sourceCanvas.width, sourceCanvas.height).catch(() => {
        sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      });
    }

    const sourcePatch = document.createElement("canvas");
    sourcePatch.width = Math.max(1, Math.round(selection.bounds.width));
    sourcePatch.height = Math.max(1, Math.round(selection.bounds.height));
    const sourcePatchContext = sourcePatch.getContext("2d");
    if (!sourcePatchContext) {
      return;
    }

    sourcePatchContext.save();
    drawSelectionMask(sourcePatchContext, selection, selection.bounds);
    sourcePatchContext.clip();
    sourcePatchContext.drawImage(
      sourceCanvas,
      selection.bounds.x,
      selection.bounds.y,
      selection.bounds.width,
      selection.bounds.height,
      0,
      0,
      sourcePatch.width,
      sourcePatch.height
    );
    sourcePatchContext.restore();

    if (transformPrepareRunRef.current !== prepareRun || !transformDraftRef.current) {
      return;
    }

    preparedTransformRef.current = {
      layerId: activeLayer.id,
      selection,
      sourceCanvas,
      patchCanvas: sourcePatch
    };
    drawPreparedTransformPreview(transformDraftRef.current.currentBounds);
    setIsTransformPreviewReady(true);
  };

  const drawPreparedTransformPreview = (targetBounds: Bounds): string | undefined => {
    const preparedTransform = preparedTransformRef.current;
    const previewCanvas = transformPreviewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");

    if (!preparedTransform || !previewCanvas || !previewContext) {
      return undefined;
    }

    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(preparedTransform.sourceCanvas, 0, 0);
    previewContext.save();
    previewContext.globalCompositeOperation = "destination-out";
    drawSelectionMask(previewContext, preparedTransform.selection);
    previewContext.fill();
    previewContext.restore();
    previewContext.drawImage(
      preparedTransform.patchCanvas,
      targetBounds.x,
      targetBounds.y,
      targetBounds.width,
      targetBounds.height
    );

    return previewCanvas.toDataURL("image/png");
  };

  const commitSelectionTransform = async (targetBounds: Bounds) => {
    const currentSelection = bitmapSelectionRef.current;
    if (!currentSelection || !activeLayer || activeLayer.locked) {
      return;
    }

    if (!preparedTransformRef.current) {
      await prepareTransformPreview(currentSelection);
    }

    const dataUrl = drawPreparedTransformPreview(targetBounds);
    if (!dataUrl) {
      return;
    }

    const writtenDataUrl = await onSelectionTransform(activeLayer.id, dataUrl);
    if (writtenDataUrl) {
      setLayerDataUrls((current) => ({ ...current, [activeLayer.id]: writtenDataUrl }));
    }

    updateBitmapSelectionState({
      ...currentSelection,
      bounds: targetBounds,
      points: [
        { x: targetBounds.x, y: targetBounds.y },
        { x: targetBounds.x + targetBounds.width, y: targetBounds.y },
        { x: targetBounds.x + targetBounds.width, y: targetBounds.y + targetBounds.height },
        { x: targetBounds.x, y: targetBounds.y + targetBounds.height }
      ]
    });
  };

  const getSketchPoint = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    const stage = event.target.getStage();
    const rect = stage?.container().getBoundingClientRect();

    if (!rect) {
      return undefined;
    }

    const pointerEvent = event.evt;
    const point =
      pointerEvent instanceof TouchEvent
        ? pointerEvent.touches[0] ?? pointerEvent.changedTouches[0]
        : pointerEvent;

    if (!point) {
      return undefined;
    }

    return sketchPointFromClientPoint(point.clientX, point.clientY, rect, canvasSize);
  };

  const beginStroke = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    blurActiveFormControl();
    event.evt?.preventDefault();
    event.evt?.stopPropagation();
    const position = getSketchPoint(event);

    if (!position) {
      return;
    }

    if (tool === "select") {
      beginBitmapSelection(position);
      return;
    }

    updateDrawingState(true);
    const strokeTool: StrokeTool = tool;
    const toolSize = tool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const nextStroke = {
      id: crypto.randomUUID(),
      tool: strokeTool,
      color: tool === "eraser" ? "#ffffff" : brushColor,
      opacity: tool === "eraser" ? eraserOpacity : brushOpacity,
      size: toolSize * canvasScale,
      points: [position.x, position.y]
    };
    draftStrokeRef.current = nextStroke;
    if (shouldRenderLiveStroke(nextStroke)) {
      setDraftStroke(nextStroke);
    } else if (tool === "eraser" && activeLayer) {
      void prepareLiveBitmapEdit(activeLayer);
    }
  };

  const beginBitmapSelection = (position: Point) => {
    const currentSelection = bitmapSelectionRef.current;
    if (currentSelection) {
      const handleRadius = bitmapSelectionHandleRadiusForStage(canvasSize, stageSize, 12);
      const hit = bitmapSelectionHitTarget(position, currentSelection.bounds, handleRadius);
      if (hit.type === "move") {
        const nextTransform = {
          type: "move",
          startPoint: position,
          startBounds: currentSelection.bounds,
          currentBounds: currentSelection.bounds
        } satisfies BitmapTransformDraft;
        updateTransformDraftState(nextTransform);
        updateDrawingState(true);
        void prepareTransformPreview(currentSelection);
        return;
      }

      if (hit.type === "scale") {
        const nextTransform = {
          type: "scale",
          corner: hit.corner,
          startPoint: position,
          startBounds: currentSelection.bounds,
          currentBounds: currentSelection.bounds
        } satisfies BitmapTransformDraft;
        updateTransformDraftState(nextTransform);
        updateDrawingState(true);
        void prepareTransformPreview(currentSelection);
        return;
      }

      updateBitmapSelectionState(undefined);
    }

    const nextDraft = { mode: selectionMode, points: [position] };
    updateSelectionDraftState(nextDraft);
    updateTransformDraftState(undefined);
    updateDrawingState(true);
  };

  const extendStroke = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    event.evt?.preventDefault();
    event.evt?.stopPropagation();

    if (!isDrawingRef.current || (tool !== "select" && !draftStrokeRef.current)) {
      return;
    }

    const position = getSketchPoint(event);

    if (!position) {
      return;
    }

    if (tool === "select") {
      extendBitmapSelection(position);
      return;
    }

    const currentStroke = draftStrokeRef.current;
    if (!currentStroke) {
      return;
    }

    const toolSize = currentStroke.tool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const minPointDistance =
      currentStroke.tool === "eraser" ? Math.max(3, toolSize * canvasScale * 0.25) : 1;
    if (!shouldAppendStrokePoint(currentStroke, position, minPointDistance)) {
      return;
    }

    const nextStroke = {
      ...currentStroke,
      points: [...currentStroke.points, position.x, position.y]
    };
    draftStrokeRef.current = nextStroke;
    if (shouldRenderLiveStroke(nextStroke)) {
      scheduleDraftStrokeRender(nextStroke);
    } else {
      drawLiveBitmapSegment(nextStroke);
    }
  };

  const extendBitmapSelection = (position: Point) => {
    const currentTransform = transformDraftRef.current;
    if (currentTransform) {
      const nextBounds =
        currentTransform.type === "move"
          ? {
              ...currentTransform.startBounds,
              x: currentTransform.startBounds.x + position.x - currentTransform.startPoint.x,
              y: currentTransform.startBounds.y + position.y - currentTransform.startPoint.y
            }
          : scaleBitmapSelectionBounds(
              currentTransform.startBounds,
              currentTransform.corner ?? "se",
              position
            );
      updateTransformDraftState({ ...currentTransform, currentBounds: nextBounds });
      const currentSelection = bitmapSelectionRef.current;
      if (currentSelection && preparedTransformRef.current) {
        drawPreparedTransformPreview(nextBounds);
      }
      return;
    }

    const currentDraft = selectionDraftRef.current;
    if (!currentDraft) {
      return;
    }

    const nextDraft =
      currentDraft.mode === "rectangle"
        ? { ...currentDraft, points: [currentDraft.points[0], position] }
        : { ...currentDraft, points: [...currentDraft.points, position] };
    updateSelectionDraftState(nextDraft);
  };

  const finishStroke = () => {
    if (tool === "select") {
      void finishBitmapSelection();
      updateDrawingState(false);
      return;
    }

    const currentStroke = draftStrokeRef.current;
    if (currentStroke && currentStroke.points.length >= 4) {
      void commitStroke(activeDrawingLayerId, currentStroke);
    } else {
      clearDraftStroke();
    }

    updateDrawingState(false);
  };

  const finishBitmapSelection = async () => {
    const currentTransform = transformDraftRef.current;
    if (currentTransform) {
      await commitSelectionTransform(currentTransform.currentBounds);
      updateTransformDraftState(undefined);
      clearPreparedTransform();
      return;
    }

    const currentDraft = selectionDraftRef.current;
    if (currentDraft) {
      updateBitmapSelectionState(buildBitmapSelection(currentDraft));
      updateSelectionDraftState(undefined);
    }
  };

  return (
    <div
      className="sketch-panel"
      onMouseDown={(event) => {
        onFocusShot();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="image-stage"
        ref={imageStageRef}
        style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      >
        {bitmapLayers.length === 0 ? <img src={imageSrc} alt={shot.fileName} draggable={false} /> : null}
        {bitmapLayers
          .filter((layer) => layer.visible)
          .map((layer) => {
            const layerSrc = layerSourceUrl(layer);
            const isLiveBitmapLayer = liveBitmapLayerId === layer.id;
            const isTransformingLayer =
              transformDraft && isTransformPreviewReady && activeLayer?.id === layer.id;
            const layerStyle: CSSProperties = {
              opacity: layer.opacity,
              mixBlendMode: cssBlendMode(layer.blendMode)
            };

            return (
              <Fragment key={layer.id}>
                {layerSrc && !isLiveBitmapLayer && !isTransformingLayer ? (
                  <img src={layerSrc} alt="" draggable={false} style={layerStyle} />
                ) : null}
                <canvas
                  ref={(element) => {
                    liveBitmapCanvasRefs.current[layer.id] = element;
                  }}
                  className="live-bitmap-canvas"
                  style={{
                    ...layerStyle,
                    display: isLiveBitmapLayer ? "block" : "none"
                  }}
                />
              </Fragment>
            );
          })}
        <canvas
          ref={transformPreviewCanvasRef}
          className="selection-transform-canvas"
          style={{ display: transformDraft && isTransformPreviewReady ? "block" : "none" }}
        />
        <BitmapSelectionOverlay
          selection={bitmapSelection}
          draft={selectionDraft}
          transformBounds={transformDraft?.currentBounds}
          stageSize={stageSize}
          canvasSize={canvasSize}
        />
        <OnionSkinOverlay
          previousShot={onionSkinPreviousShot}
          nextShot={onionSkinNextShot}
          stageSize={stageSize}
          folderPath={folderPath}
        />
        <Stage
          className="stage-overlay"
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={beginStroke}
          onMouseMove={extendStroke}
          onMouseUp={finishStroke}
          onTouchStart={beginStroke}
          onTouchMove={extendStroke}
          onTouchEnd={finishStroke}
        >
          {draftStroke ? (
            <Layer
              scaleX={stageSize.width / canvasSize.width}
              scaleY={stageSize.height / canvasSize.height}
            >
              {[draftStroke].map((stroke) => (
                <Line
                  key={stroke.id}
                  points={stroke.points}
                  stroke={stroke.color}
                  opacity={stroke.opacity ?? 1}
                  strokeWidth={stroke.size}
                  tension={0.35}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={
                    stroke.tool === "eraser" ? "destination-out" : "source-over"
                  }
                />
              ))}
            </Layer>
          ) : null}
        </Stage>
      </div>
    </div>
  );
};

type OnionSkinOverlayProps = {
  previousShot?: Shot;
  nextShot?: Shot;
  stageSize: CanvasSize;
  folderPath?: string;
};

const OnionSkinOverlay = ({ previousShot, nextShot, stageSize, folderPath }: OnionSkinOverlayProps) => {
  if (!previousShot && !nextShot) {
    return null;
  }

  return (
    <div className="onion-skin-overlay" aria-hidden="true">
      {previousShot ? (
        <OnionSkinGhost shot={previousShot} tone="previous" stageSize={stageSize} folderPath={folderPath} />
      ) : null}
      {nextShot ? (
        <OnionSkinGhost shot={nextShot} tone="next" stageSize={stageSize} folderPath={folderPath} />
      ) : null}
    </div>
  );
};

const OnionSkinGhost = ({
  shot,
  tone,
  stageSize,
  folderPath
}: {
  shot: Shot;
  tone: "previous" | "next";
  stageSize: CanvasSize;
  folderPath?: string;
}) => {
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadLayers = async () => {
      if (!folderPath) {
        return;
      }

      const entries = await Promise.all(
        bitmapLayers.map(async (layer) => {
          if (layer.cleared) {
            return [layer.id, undefined] as const;
          }

          const dataUrl = await window.storyboard
            .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
            .catch(() => undefined);
          return [layer.id, dataUrl] as const;
        })
      );

      if (!cancelled) {
        setLayerDataUrls(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
        );
      }
    };

    void loadLayers();

    return () => {
      cancelled = true;
    };
  }, [bitmapLayers, folderPath]);

  return (
    <div className={`onion-skin-ghost onion-skin-ghost-${tone}`}>
      {bitmapLayers.length === 0 ? (
        <img src={imageSrc} alt="" draggable={false} className="onion-skin-image" />
      ) : null}
      {bitmapLayers
        .filter((layer) => layer.visible)
        .map((layer) => {
          const layerSrc =
            layerDataUrls[layer.id] ?? (layer.kind === "image" && !layer.cleared ? imageSrc : undefined);

          return layerSrc ? (
            <img
              key={layer.id}
              src={layerSrc}
              alt=""
              draggable={false}
              className="onion-skin-image"
              style={{
                opacity: layer.opacity,
                mixBlendMode: cssBlendMode(layer.blendMode)
              }}
            />
          ) : null;
        })}
    </div>
  );
};
