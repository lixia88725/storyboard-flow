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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent
} from "react";
import { Layer, Line, Stage } from "react-konva";
import {
  activeSketchLayerForShot,
  addDialogue,
  addGeneratedShot,
  addSketchLayer,
  appendImageLayerEdit,
  appendSketchStroke,
  applyRenamePlan,
  clearSketch,
  createProject,
  createRenamePlan,
  defaultProjectNaming,
  defaultSaveNaming,
  deleteImageLayerContent,
  dialoguesForShot,
  getNextStoryboardIndex,
  mergeFolderImages,
  moveDialogueToShot,
  moveSketchLayer,
  projectAcceptedExternalEdits,
  projectHasSwbWarning,
  projectNeedsSwbImport,
  removeSketchLayer,
  removeDialogue,
  reorderShotGroup,
  reorderShots,
  selectImageLayer,
  selectSketchLayer,
  sketchBlendModes,
  sketchLayersForShot,
  sortedShots,
  type ShotPlacement,
  updateDialogueText,
  updateShotBaseVisibility,
  updateSketchLayer
} from "../shared/projectOps";
import type {
  Dialogue,
  FolderScanPayload,
  Project,
  ProjectNaming,
  Shot,
  BlankShotPreset,
  SketchBlendMode,
  SketchLayer,
  SketchStroke,
  SketchTool
} from "../shared/types";
import { getAnimationViewport, getStableBoardTop, maxStoryboardZoom } from "./animationViewport";
import { getOnionSkinNeighbors } from "./onionSkin";
import { sketchCanvasSize, sketchPointFromClientPoint } from "./sketchGeometry";
import type { CanvasSize } from "./sketchGeometry";
import { scrollDeltaToCenterInReservedViewport } from "./viewportGeometry";

type DragData =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "drop-zone"; shotId: string };

const defaultBrushColor = "#f05a28";
const defaultBrushSize = 4;
const defaultEraserSize = 18;
const imageLayerId = "__image-layer__";
const maxUndoHistory = 60;
const blankShotPresets: Array<{ id: BlankShotPreset; label: string; detail: string }> = [
  { id: "16:9", label: "16:9", detail: "1920 x 1080" },
  { id: "2.39:1", label: "2.39:1", detail: "2581 x 1080" },
  { id: "1.43:1", label: "1.43:1 IMAX", detail: "1544 x 1080" }
];
const autosaveDelayMs = 600;
const animationReservedBottom = 180;
const animationViewportMargin = 14;

type WorkspaceSaveState = "saved" | "saving" | "error";
type FileNameSyncState = "synced" | "unsynced";
type SelectionBox = { startX: number; startY: number; currentX: number; currentY: number };
type SketchSettingsMenu = { tool: SketchTool; x: number; y: number };
type UndoEntry = {
  project: Project;
  selectedShotIds: string[];
  fileNameSyncState: FileNameSyncState;
};
type ProjectUpdate = Project | ((currentProject: Project) => Project);
type HistoryShortcut = "undo" | "redo";

const isMacPlatform = () => /mac|iphone|ipad|ipod/i.test(navigator.platform);

const historyShortcutForEvent = (event: KeyboardEvent): HistoryShortcut | undefined => {
  if (event.key.toLowerCase() !== "z" || event.altKey) {
    return undefined;
  }

  const isMac = isMacPlatform();
  const hasPlatformModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  if (!hasPlatformModifier) {
    return undefined;
  }

  return event.shiftKey ? "redo" : "undo";
};

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
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSize, setBrushSize] = useState(defaultBrushSize);
  const [eraserSize, setEraserSize] = useState(defaultEraserSize);
  const [eraserOpacity, setEraserOpacity] = useState(1);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<WorkspaceSaveState>("saved");
  const [fileNameSyncState, setFileNameSyncState] = useState<FileNameSyncState>("synced");
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isAnimationMode, setIsAnimationMode] = useState(false);
  const [isOnionSkinEnabled, setIsOnionSkinEnabled] = useState(false);
  const [animationImageSize, setAnimationImageSize] = useState({ width: 430, height: 271 });
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [editingDialogueId, setEditingDialogueId] = useState<string | undefined>();
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const [isRecentMenuOpen, setIsRecentMenuOpen] = useState(false);
  const [isAddShotMenuOpen, setIsAddShotMenuOpen] = useState(false);
  const [blankShotPreset, setBlankShotPreset] = useState<BlankShotPreset>("16:9");
  const [sketchSettingsMenu, setSketchSettingsMenu] = useState<SketchSettingsMenu | undefined>();
  const [isStatusPanelOpen, setIsStatusPanelOpen] = useState(false);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const selectionBoxRef = useRef<SelectionBox | undefined>(undefined);
  const projectRef = useRef(project);
  const fileNameSyncStateRef = useRef<FileNameSyncState>(fileNameSyncState);
  const selectedShotIdsRef = useRef<string[]>([]);
  const saveMenuRef = useRef<HTMLDivElement | null>(null);
  const recentMenuRef = useRef<HTMLDivElement | null>(null);
  const addShotMenuRef = useRef<HTMLDivElement | null>(null);
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
    selectedShotIdsRef.current = selectedShotIds;
  }, [selectedShotIds]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    fileNameSyncStateRef.current = fileNameSyncState;
  }, [fileNameSyncState]);

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
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) {
        return;
      }

      const historyShortcut = historyShortcutForEvent(event);

      if (historyShortcut === "undo") {
        event.preventDefault();
        setUndoStack((current) => {
          const previous = current.at(-1);
          if (!previous) {
            setStatus("Nothing to undo");
            return current;
          }

          setRedoStack((redoEntries) =>
            appendHistoryEntry(redoEntries, {
              project: projectRef.current,
              selectedShotIds: selectedShotIdsRef.current,
              fileNameSyncState: fileNameSyncStateRef.current
            })
          );
          setProject(previous.project);
          setSelectedShotIds(previous.selectedShotIds);
          setFileNameSyncState(previous.fileNameSyncState);
          setWorkspaceSaveState("saving");
          setAutosaveRevision((revision) => revision + 1);
          setStatus("Undid last change");
          return current.slice(0, -1);
        });
        return;
      }

      if (historyShortcut === "redo") {
        event.preventDefault();
        setRedoStack((current) => {
          const next = current.at(-1);
          if (!next) {
            setStatus("Nothing to redo");
            return current;
          }

          setUndoStack((undoEntries) =>
            appendHistoryEntry(undoEntries, {
              project: projectRef.current,
              selectedShotIds: selectedShotIdsRef.current,
              fileNameSyncState: fileNameSyncStateRef.current
            })
          );
          setProject(next.project);
          setSelectedShotIds(next.selectedShotIds);
          setFileNameSyncState(next.fileNameSyncState);
          setWorkspaceSaveState("saving");
          setAutosaveRevision((revision) => revision + 1);
          setStatus("Redid last change");
          return current.slice(0, -1);
        });
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "b") {
        setActiveSketchTool("brush");
        return;
      }

      if (key === "e") {
        setActiveSketchTool("eraser");
        return;
      }

      if (!["arrowright", "arrowdown", "arrowleft", "arrowup"].includes(key)) {
        return;
      }

      event.preventDefault();
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
          key.replace("arrow", "") as "left" | "right" | "up" | "down",
          isAnimationMode
        );
        return [orderedShots[nextIndex].id];
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAnimationMode, measureGridColumns, orderedShots]);

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
    if (acceptedExternalEdits) {
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

    loadFolderScan(result, "Folder opened");
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
    if (target.closest("input, textarea, select, .save-menu, .sketch-settings-menu")) {
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

  return (
    <main
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
            onClick={() => {
              if (!primarySelectedShot) {
                setStatus("Select a shot before clearing a layer");
                return;
              }
              const activeLayer = activeSketchLayerForShot(primarySelectedShot);
              updateProject((currentProject) =>
                primarySelectedShot.activeLayerTarget === "image"
                  ? deleteImageLayerContent(currentProject, primarySelectedShot.id)
                  : clearSketch(currentProject, primarySelectedShot.id, activeLayer.id)
              );
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
            ) : (
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
            )}
          </div>
        ) : null}
        <LayerPanel
          shot={primarySelectedShot}
          isOpen={isLayerPanelOpen}
          onToggle={() => setIsLayerPanelOpen((isOpen) => !isOpen)}
          onAddLayer={(shotId) =>
            updateProject((currentProject) => addSketchLayer(currentProject, shotId, "Layer"))
          }
          onRemoveLayer={(shotId, layerId) =>
            updateProject((currentProject) => removeSketchLayer(currentProject, shotId, layerId))
          }
          onDeleteImageLayerContent={(shotId) =>
            updateProject((currentProject) => deleteImageLayerContent(currentProject, shotId))
          }
          onSelectLayer={(shotId, layerId) =>
            updateProject((currentProject) => selectSketchLayer(currentProject, shotId, layerId))
          }
          onUpdateLayer={(shotId, layerId, patch) =>
            updateProject((currentProject) =>
              updateSketchLayer(currentProject, shotId, layerId, patch)
            )
          }
          onMoveLayer={(shotId, layerId, targetLayerId) =>
            updateProject((currentProject) =>
              moveSketchLayer(currentProject, shotId, layerId, targetLayerId)
            )
          }
          onUpdateBaseVisibility={(shotId, visible) =>
            updateProject((currentProject) =>
              updateShotBaseVisibility(currentProject, shotId, visible)
            )
          }
          onSelectImageLayer={(shotId) =>
            updateProject((currentProject) => selectImageLayer(currentProject, shotId))
          }
        />

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
                  "--animation-image-height": `${animationImageSize.height}px`
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
                  isSelected={selectedShotIds.includes(shot.id)}
                  activeSketchTool={activeSketchTool}
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
                  onSketchStroke={(layerId, stroke) =>
                    updateProject((currentProject) =>
                      layerId === imageLayerId
                        ? appendImageLayerEdit(currentProject, shot.id, stroke)
                        : appendSketchStroke(currentProject, shot.id, layerId, stroke)
                    )
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
          !
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

type LayerPanelProps = {
  shot?: Shot;
  isOpen: boolean;
  onToggle: () => void;
  onAddLayer: (shotId: string) => void;
  onRemoveLayer: (shotId: string, layerId: string) => void;
  onDeleteImageLayerContent: (shotId: string) => void;
  onSelectLayer: (shotId: string, layerId: string) => void;
  onUpdateLayer: (
    shotId: string,
    layerId: string,
    patch: Partial<Pick<SketchLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>
  ) => void;
  onMoveLayer: (shotId: string, layerId: string, targetLayerId: string) => void;
  onUpdateBaseVisibility: (shotId: string, visible: boolean) => void;
  onSelectImageLayer: (shotId: string) => void;
};

const LayerPanel = ({
  shot,
  isOpen,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onDeleteImageLayerContent,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onUpdateBaseVisibility,
  onSelectImageLayer
}: LayerPanelProps) => {
  const layers = shot ? sketchLayersForShot(shot) : [];
  const activeLayer = shot ? activeSketchLayerForShot(shot) : undefined;
  const activeLayerId = activeLayer?.id;
  const isImageLayerActive = shot?.activeLayerTarget === "image";
  const baseVisible = shot?.baseVisible ?? true;

  return (
    <div className="layer-popover">
      {isOpen ? (
        <section className="layer-panel" aria-label="Storyboard layers">
          <div className="layer-panel-controls">
            <label>
              <span>Mode</span>
              <select
                aria-label="Layer blend mode"
                value={isImageLayerActive ? "normal" : activeLayer?.blendMode ?? "normal"}
                disabled={!shot || !activeLayer || isImageLayerActive}
                onChange={(event) => {
                  if (shot && activeLayer) {
                    onUpdateLayer(shot.id, activeLayer.id, {
                      blendMode: event.target.value as SketchBlendMode
                    });
                  }
                }}
              >
                {sketchBlendModes.map((blendMode) => (
                  <option key={blendMode} value={blendMode}>
                    {blendModeLabel(blendMode)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="layer-control-header">
                <span>Opacity</span>
                <strong>
                  {isImageLayerActive ? 100 : Math.round((activeLayer?.opacity ?? 1) * 100)}%
                </strong>
              </span>
              <input
                aria-label="Active layer opacity"
                type="range"
                min="0"
                max="100"
                step="5"
                value={isImageLayerActive ? 100 : Math.round((activeLayer?.opacity ?? 1) * 100)}
                disabled={!shot || !activeLayer || isImageLayerActive}
                onChange={(event) => {
                  if (shot && activeLayer) {
                    onUpdateLayer(shot.id, activeLayer.id, {
                      opacity: Number(event.target.value) / 100
                    });
                  }
                }}
              />
            </label>
          </div>
          {shot ? (
            <div className="layer-list">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className={`layer-row ${
                    !isImageLayerActive && layer.id === activeLayerId ? "is-active" : ""
                  } ${layer.visible ? "" : "is-hidden"}`}
                  draggable
                  onClick={() => onSelectLayer(shot.id, layer.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", layer.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const draggedLayerId = event.dataTransfer.getData("text/plain");
                    if (draggedLayerId) {
                      onMoveLayer(shot.id, draggedLayerId, layer.id);
                    }
                  }}
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
                  <LayerThumbnail layer={layer} canvasSize={canvasSizeForShot(shot)} />
                  <input
                    aria-label="Layer name"
                    value={layer.name}
                    draggable={false}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      onUpdateLayer(shot.id, layer.id, { name: event.target.value })
                    }
                  />
                </div>
              ))}
              <div
                className={`layer-row layer-row-base ${isImageLayerActive ? "is-active" : ""} ${
                  baseVisible ? "" : "is-hidden"
                }`}
                onClick={() => onSelectImageLayer(shot.id)}
              >
                <button
                  type="button"
                  className="layer-select"
                  draggable={false}
                  title={baseVisible ? "Hide image layer" : "Show image layer"}
                  aria-label={baseVisible ? "Hide image layer" : "Show image layer"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdateBaseVisibility(shot.id, !baseVisible);
                  }}
                >
                  <span className={baseVisible ? "layer-eye is-on" : "layer-eye"} />
                </button>
                <div
                  className="layer-thumb layer-thumb-image"
                  style={{
                    backgroundImage: `url("${window.storyboard.assetUrl(
                      shot.previewPath ?? shot.imagePath
                    )}")`
                  }}
                  aria-hidden="true"
                >
                  <LayerThumbnailSvg
                    strokes={shot.imageLayerEdits ?? []}
                    opacity={1}
                    canvasSize={canvasSizeForShot(shot)}
                  />
                </div>
                <span className="layer-base-name">Image</span>
              </div>
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
                if (shot && isImageLayerActive) {
                  onDeleteImageLayerContent(shot.id);
                  return;
                }

                if (shot && activeLayer) {
                  onRemoveLayer(shot.id, activeLayer.id);
                }
              }}
              disabled={!shot || (!isImageLayerActive && (!activeLayer || layers.length <= 1))}
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
        aria-label="Layers"
        aria-expanded={isOpen}
      >
        Layers
      </button>
    </div>
  );
};

const LayerThumbnail = ({ layer, canvasSize }: { layer: SketchLayer; canvasSize: CanvasSize }) => (
  <div className="layer-thumb" aria-hidden="true">
    <LayerThumbnailSvg strokes={layer.strokes} opacity={layer.opacity} canvasSize={canvasSize} />
  </div>
);

const LayerThumbnailSvg = ({
  strokes,
  opacity,
  canvasSize
}: {
  strokes: SketchStroke[];
  opacity: number;
  canvasSize: CanvasSize;
}) => (
  <svg viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
    {strokes.map((stroke) => (
      <polyline
        key={stroke.id}
        points={pointsForThumbnail(stroke.points)}
        fill="none"
        stroke={stroke.tool === "eraser" ? "#ffffff" : stroke.color}
        strokeOpacity={(stroke.opacity ?? 1) * opacity}
        strokeWidth={stroke.size}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))}
  </svg>
);

const pointsForThumbnail = (points: number[]): string => {
  const pairs: string[] = [];

  for (let index = 0; index < points.length - 1; index += 2) {
    pairs.push(`${points[index]},${points[index + 1]}`);
  }

  return pairs.join(" ");
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
  isSelected: boolean;
  activeSketchTool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  editingDialogueId?: string;
  onSelect: (event: MouseEvent) => void;
  onCreateDialogue: (shotId: string) => void;
  onDialogueText: (dialogueId: string, text: string) => void;
  onDialogueBlur: (dialogue: Dialogue) => void;
  onSketchStroke: (layerId: string, stroke: SketchStroke) => void;
};

const ShotCard = ({
  shot,
  index,
  project,
  isSelected,
  activeSketchTool,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  onionSkinPreviousShot,
  onionSkinNextShot,
  editingDialogueId,
  onSelect,
  onCreateDialogue,
  onDialogueText,
  onDialogueBlur,
  onSketchStroke
}: ShotCardProps) => {
  const sortable = useSortable({
    id: shot.id,
    data: { type: "shot", shotId: shot.id } satisfies DragData
  });
  const dropZone = useDroppable({
    id: `dialogue-zone-${shot.id}`,
    data: { type: "drop-zone", shotId: shot.id } satisfies DragData
  });
  const dialogues = dialoguesForShot(project, shot.id);
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };

  return (
    <article
      ref={sortable.setNodeRef}
      className={`shot-card ${sortable.isDragging ? "is-dragging" : ""} ${
        isSelected ? "is-selected" : ""
      }`}
      style={style}
      data-shot-id={shot.id}
      onClick={onSelect}
    >
      <div className="shot-head">
        <button
          type="button"
          className="drag-handle"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          title="Drag to reorder shot"
        >
          #{String(index + 1).padStart(3, "0")}
        </button>
        <span title={shot.fileName}>{shot.fileName}</span>
      </div>

      <SketchPad
        shot={shot}
        tool={activeSketchTool}
        brushColor={brushColor}
        brushOpacity={brushOpacity}
        brushSize={brushSize}
        eraserOpacity={eraserOpacity}
        eraserSize={eraserSize}
        onionSkinPreviousShot={onionSkinPreviousShot}
        onionSkinNextShot={onionSkinNextShot}
        onStroke={onSketchStroke}
      />

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
        value={dialogue.text}
        onChange={(event) => onChange(event.target.value)}
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
  tool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onStroke: (layerId: string, stroke: SketchStroke) => void;
};

const SketchPad = ({
  shot,
  tool,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  onionSkinPreviousShot,
  onionSkinNextShot,
  onStroke
}: SketchPadProps) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftStroke, setDraftStroke] = useState<SketchStroke | undefined>();
  const [stageSize, setStageSize] = useState(sketchCanvasSize);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const draftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const canvasSize = useMemo(() => canvasSizeForShot(shot), [shot]);
  const sketchLayers = useMemo(() => sketchLayersForShot(shot), [shot]);
  const activeLayer = useMemo(() => activeSketchLayerForShot(shot), [shot]);
  const activeDrawingLayerId = shot.activeLayerTarget === "image" ? imageLayerId : activeLayer.id;

  useEffect(() => {
    draftStrokeRef.current = draftStroke;
  }, [draftStroke]);

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
      const currentStroke = draftStrokeRef.current;
      if (currentStroke && currentStroke.points.length >= 4) {
        onStroke(activeDrawingLayerId, currentStroke);
      }

      setIsDrawing(false);
      setDraftStroke(undefined);
      draftStrokeRef.current = undefined;
    };

    window.addEventListener("mouseup", finishGlobalStroke, { once: true });
    window.addEventListener("touchend", finishGlobalStroke, { once: true });

    return () => {
      window.removeEventListener("mouseup", finishGlobalStroke);
      window.removeEventListener("touchend", finishGlobalStroke);
    };
  }, [activeDrawingLayerId, isDrawing, onStroke]);

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

    setIsDrawing(true);
    const toolSize = tool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const nextStroke = {
      id: crypto.randomUUID(),
      tool,
      color: tool === "eraser" ? "#ffffff" : brushColor,
      opacity: tool === "eraser" ? eraserOpacity : brushOpacity,
      size: toolSize * canvasScale,
      points: [position.x, position.y]
    };
    draftStrokeRef.current = nextStroke;
    setDraftStroke(nextStroke);
  };

  const extendStroke = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    event.evt?.preventDefault();
    event.evt?.stopPropagation();

    if (!isDrawing || !draftStrokeRef.current) {
      return;
    }

    const position = getSketchPoint(event);

    if (!position) {
      return;
    }

    const nextStroke = {
      ...draftStrokeRef.current,
      points: [...draftStrokeRef.current.points, position.x, position.y]
    };
    draftStrokeRef.current = nextStroke;
    setDraftStroke(nextStroke);
  };

  const finishStroke = () => {
    const currentStroke = draftStrokeRef.current;
    if (currentStroke && currentStroke.points.length >= 4) {
      onStroke(activeDrawingLayerId, currentStroke);
    }

    setIsDrawing(false);
    setDraftStroke(undefined);
    draftStrokeRef.current = undefined;
  };

  return (
    <div
      className="sketch-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="image-stage"
        ref={imageStageRef}
        style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      >
        {shot.baseVisible !== false ? (
          <img src={imageSrc} alt={shot.fileName} draggable={false} />
        ) : null}
        <OnionSkinOverlay
          previousShot={onionSkinPreviousShot}
          nextShot={onionSkinNextShot}
          stageSize={stageSize}
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
          {(shot.imageLayerEdits?.length ?? 0) > 0 ||
          (draftStroke && activeDrawingLayerId === imageLayerId) ? (
            <Layer
              scaleX={stageSize.width / canvasSize.width}
              scaleY={stageSize.height / canvasSize.height}
            >
              {[
                ...(shot.imageLayerEdits ?? []),
                ...(draftStroke && activeDrawingLayerId === imageLayerId ? [draftStroke] : [])
              ].map((stroke) => (
                <Line
                  key={stroke.id}
                  points={stroke.points}
                  stroke={stroke.color}
                  opacity={stroke.opacity ?? 1}
                  strokeWidth={stroke.size}
                  tension={0.35}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation="source-over"
                />
              ))}
            </Layer>
          ) : null}
          {sketchLayers
            .filter((layer) => layer.visible)
            .map((layer) => (
              <Layer
                key={layer.id}
                opacity={layer.opacity}
                globalCompositeOperation={canvasBlendMode(layer.blendMode)}
                scaleX={stageSize.width / canvasSize.width}
                scaleY={stageSize.height / canvasSize.height}
              >
                {[
                  ...layer.strokes,
                  ...(draftStroke && layer.id === activeLayer.id && activeDrawingLayerId !== imageLayerId
                    ? [draftStroke]
                    : [])
                ].map((stroke) => (
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
            ))}
        </Stage>
      </div>
    </div>
  );
};

type OnionSkinOverlayProps = {
  previousShot?: Shot;
  nextShot?: Shot;
  stageSize: CanvasSize;
};

const OnionSkinOverlay = ({ previousShot, nextShot, stageSize }: OnionSkinOverlayProps) => {
  if (!previousShot && !nextShot) {
    return null;
  }

  return (
    <div className="onion-skin-overlay" aria-hidden="true">
      {previousShot ? (
        <OnionSkinGhost shot={previousShot} tone="previous" stageSize={stageSize} />
      ) : null}
      {nextShot ? <OnionSkinGhost shot={nextShot} tone="next" stageSize={stageSize} /> : null}
    </div>
  );
};

const OnionSkinGhost = ({
  shot,
  tone,
  stageSize
}: {
  shot: Shot;
  tone: "previous" | "next";
  stageSize: CanvasSize;
}) => {
  const canvasSize = canvasSizeForShot(shot);
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const sketchLayers = sketchLayersForShot(shot);
  const tintColor = tone === "previous" ? "#ff4a3d" : "#43d96b";

  return (
    <div className={`onion-skin-ghost onion-skin-ghost-${tone}`}>
      {shot.baseVisible !== false ? (
        <img src={imageSrc} alt="" draggable={false} className="onion-skin-image" />
      ) : null}
      <Stage
        className="onion-skin-stage"
        width={stageSize.width}
        height={stageSize.height}
        listening={false}
      >
        {(shot.imageLayerEdits?.length ?? 0) > 0 ? (
          <Layer
            scaleX={stageSize.width / canvasSize.width}
            scaleY={stageSize.height / canvasSize.height}
          >
            {(shot.imageLayerEdits ?? []).map((stroke) => (
              <Line
                key={stroke.id}
                points={stroke.points}
                stroke={stroke.tool === "eraser" ? "#ffffff" : tintColor}
                opacity={stroke.opacity ?? 1}
                strokeWidth={stroke.size}
                tension={0.35}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="source-over"
              />
            ))}
          </Layer>
        ) : null}
        {sketchLayers
          .filter((layer) => layer.visible)
          .map((layer) => (
            <Layer
              key={layer.id}
              opacity={layer.opacity}
              globalCompositeOperation={canvasBlendMode(layer.blendMode)}
              scaleX={stageSize.width / canvasSize.width}
              scaleY={stageSize.height / canvasSize.height}
            >
              {layer.strokes.map((stroke) => (
                <Line
                  key={stroke.id}
                  points={stroke.points}
                  stroke={stroke.tool === "eraser" ? "#ffffff" : tintColor}
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
          ))}
      </Stage>
    </div>
  );
};
