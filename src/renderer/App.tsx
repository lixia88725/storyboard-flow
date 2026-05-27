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
  addDialogue,
  addGeneratedShot,
  applyRenamePlan,
  clearSketch,
  createProject,
  createRenamePlan,
  dialoguesForShot,
  getNextStoryboardIndex,
  mergeFolderImages,
  moveDialogueToShot,
  removeDialogue,
  reorderShotGroup,
  reorderShots,
  sortedShots,
  type ShotPlacement,
  updateDialogueText,
  updateSketch
} from "../shared/projectOps";
import type {
  Dialogue,
  FolderScanPayload,
  Project,
  Shot,
  SketchStroke,
  SketchTool
} from "../shared/types";
import { getAnimationViewport, getStableBoardTop } from "./animationViewport";
import { sketchCanvasSize, sketchPointFromClientPoint } from "./sketchGeometry";
import { scrollDeltaToCenterInReservedViewport } from "./viewportGeometry";

type DragData =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "drop-zone"; shotId: string };

const defaultBrushColor = "#f05a28";
const autosaveDelayMs = 600;
const animationReservedBottom = 180;
const animationViewportMargin = 14;

type WorkspaceSaveState = "saved" | "saving" | "error";
type FileNameSyncState = "synced" | "unsynced";
type SelectionBox = { startX: number; startY: number; currentX: number; currentY: number };

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
  const [workspaceSaveState, setWorkspaceSaveState] = useState<WorkspaceSaveState>("saved");
  const [fileNameSyncState, setFileNameSyncState] = useState<FileNameSyncState>("synced");
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isAnimationMode, setIsAnimationMode] = useState(false);
  const [animationImageSize, setAnimationImageSize] = useState({ width: 430, height: 271 });
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [editingDialogueId, setEditingDialogueId] = useState<string | undefined>();
  const [selectionBox, setSelectionBox] = useState<SelectionBox | undefined>();
  const [status, setStatus] = useState(
    window.storyboard ? "Ready" : "Electron preload API is unavailable"
  );
  const selectionBoxRef = useRef<SelectionBox | undefined>(undefined);
  const selectedShotIdsRef = useRef<string[]>([]);
  const boardGridRef = useRef<HTMLElement | null>(null);
  const orderedShots = useMemo(() => sortedShots(project.shots), [project.shots]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const primarySelectedShotId = selectedShotIds[0];

  useEffect(() => {
    selectedShotIdsRef.current = selectedShotIds;
  }, [selectedShotIds]);

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
    const viewport = getAnimationViewport({
      boardWidth: boardRect.width,
      boardTop: getStableBoardTop(boardRect.top, window.scrollY),
      viewportHeight: window.innerHeight,
      reservedBottom: animationReservedBottom,
      margin: animationViewportMargin,
      zoomLevel,
      isAnimationMode
    });
    setIsAnimationMode(viewport.isAnimationMode);
    setAnimationImageSize({ width: viewport.imageWidth, height: viewport.imageHeight });
  }, [isAnimationMode, zoomLevel]);

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
  }, [isAnimationMode, selectedShotIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) {
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

  const updateProject = (nextProject: Project, markFileNamesUnsynced = true) => {
    setProject(nextProject);
    setWorkspaceSaveState("saving");
    if (markFileNamesUnsynced) {
      setFileNameSyncState("unsynced");
    }
    setAutosaveRevision((revision) => revision + 1);
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
        name: scan.folderName || baseProject.name
      },
      scan.images
    );

    setProject(nextProject);
    setFolderPath(scan.folderPath);
    setFolderInputValue(scan.folderPath);
    setMetadataPath(scan.metadataPath);
    setWorkspaceSaveState(dirty ? "saving" : "saved");
    setFileNameSyncState("synced");
    setStatus(nextStatus);
    setSelectedShotIds(nextProject.shots[0] ? [nextProject.shots[0].id] : []);
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

    loadFolderScan(result, `Opened ${result.folderPath}`);
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

    await persistWorkspace(project);
    const renamePlan = createRenamePlan(project);
    const renamedProject = applyRenamePlan(project, renamePlan);
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
    setStatus(`Synced file names and saved ${result.metadataPath}`);
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
      () => window.storyboard.createBlankShot(folderPath),
      setStatus
    );

    if (!image) {
      return;
    }

    const nextProject = addGeneratedShot(project, image, primarySelectedShotId);
    updateProject(nextProject);
    const nextShotId = nextProject.shots.find((shot) => shot.imagePath === image.imagePath)?.id;
    setSelectedShotIds(nextShotId ? [nextShotId] : []);
    setStatus(`Added ${image.fileName}`);
  };

  const handleCreateDialogue = (shotId: string) => {
    const dialogueId = crypto.randomUUID();
    updateProject(addDialogue(project, shotId, "", dialogueId));
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
        updateProject(moveDialogueToShot(project, activeData.dialogueId, targetShotId));
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

  return (
    <main className={`app-shell ${isAnimationMode ? "is-animation-mode" : ""}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Storyboard Workbench</p>
          <h1>{project.name}</h1>
        </div>
        <div className="toolbar">
          <form
            className="path-form"
            onSubmit={(event) => {
              event.preventDefault();
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
          <select
            aria-label="Recent folders"
            className="recent-select"
            value=""
            onChange={(event) => {
              const nextFolderPath = event.target.value;
              if (nextFolderPath) {
                setFolderInputValue(nextFolderPath);
                void handleOpenFolderByPath(nextFolderPath);
              }
            }}
          >
            <option value="">Recent</option>
            {recentFolders.map((recentFolder) => (
              <option key={recentFolder} value={recentFolder}>
                {recentFolder}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleAddShot}>
            Add Shot
          </button>
          <button type="button" className="primary" onClick={handleSaveProject}>
            Save
          </button>
        </div>
      </header>

      <section className="status-row">
        <span>{status}</span>
        <span>{folderPath ?? "No folder open"}</span>
        <span>{project.shots.length} shots</span>
        <span>Workspace {workspaceSaveState}</span>
        <span>File names {fileNameSyncState}</span>
      </section>

      <div className="workspace-layout">
        <aside className="tool-rail" aria-label="Sketch tools">
          <button
            type="button"
            className={activeSketchTool === "brush" ? "selected" : ""}
            onClick={() => setActiveSketchTool("brush")}
            title="Brush"
          >
            B
          </button>
          <label className="color-control" title="Brush color">
            <input
              aria-label="Brush color"
              type="color"
              value={brushColor}
              onChange={(event) => setBrushColor(event.target.value)}
            />
          </label>
          <label className="opacity-control" title="Brush opacity">
            <span>{Math.round(brushOpacity * 100)}</span>
            <input
              aria-label="Brush opacity"
              type="range"
              min="20"
              max="100"
              step="5"
              value={Math.round(brushOpacity * 100)}
              onChange={(event) => setBrushOpacity(Number(event.target.value) / 100)}
            />
          </label>
          <button
            type="button"
            className={activeSketchTool === "eraser" ? "selected" : ""}
            onClick={() => setActiveSketchTool("eraser")}
            title="Eraser"
          >
            E
          </button>
          <button
            type="button"
            onClick={() => {
              if (!primarySelectedShotId) {
                setStatus("Select a shot before clearing sketch");
                return;
              }
              updateProject(clearSketch(project, primarySelectedShotId));
            }}
            title="Clear current shot"
          >
            C
          </button>
        </aside>

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
                  editingDialogueId={editingDialogueId}
                  onSelect={(event) => handleShotSelect(shot.id, event)}
                  onCreateDialogue={handleCreateDialogue}
                  onDialogueText={(dialogueId, text) =>
                    updateProject(updateDialogueText(project, dialogueId, text))
                  }
                  onDialogueBlur={(dialogue) => {
                    if (!dialogue.text.trim()) {
                      updateProject(removeDialogue(project, dialogue.id));
                    }
                    setEditingDialogueId(undefined);
                  }}
                  onSketchChange={(sketchData) =>
                    updateProject(updateSketch(project, shot.id, sketchData))
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
      <footer className="bottom-bar">
        <label>
          Zoom
          <input
            type="range"
            min="25"
            max="260"
            step="5"
            value={zoomLevel}
            onChange={(event) => setZoomLevel(Number(event.target.value))}
          />
        </label>
        <span>{zoomLevel}%</span>
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

type ShotCardProps = {
  shot: Shot;
  index: number;
  project: Project;
  isSelected: boolean;
  activeSketchTool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  editingDialogueId?: string;
  onSelect: (event: MouseEvent) => void;
  onCreateDialogue: (shotId: string) => void;
  onDialogueText: (dialogueId: string, text: string) => void;
  onDialogueBlur: (dialogue: Dialogue) => void;
  onSketchChange: (sketchData: SketchStroke[]) => void;
};

const ShotCard = ({
  shot,
  index,
  project,
  isSelected,
  activeSketchTool,
  brushColor,
  brushOpacity,
  editingDialogueId,
  onSelect,
  onCreateDialogue,
  onDialogueText,
  onDialogueBlur,
  onSketchChange
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
        onChange={onSketchChange}
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
  onChange: (sketchData: SketchStroke[]) => void;
};

const SketchPad = ({ shot, tool, brushColor, brushOpacity, onChange }: SketchPadProps) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftStroke, setDraftStroke] = useState<SketchStroke | undefined>();
  const [stageSize, setStageSize] = useState(sketchCanvasSize);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const draftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);

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
        onChange([...shot.sketchData, currentStroke]);
      }

      setIsDrawing(false);
      setDraftStroke(undefined);
    };

    window.addEventListener("mouseup", finishGlobalStroke, { once: true });
    window.addEventListener("touchend", finishGlobalStroke, { once: true });

    return () => {
      window.removeEventListener("mouseup", finishGlobalStroke);
      window.removeEventListener("touchend", finishGlobalStroke);
    };
  }, [isDrawing, onChange, shot.sketchData]);

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

    return sketchPointFromClientPoint(point.clientX, point.clientY, rect);
  };

  const beginStroke = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    event.evt?.preventDefault();
    event.evt?.stopPropagation();
    const position = getSketchPoint(event);

    if (!position) {
      return;
    }

    setIsDrawing(true);
    const nextStroke = {
      id: crypto.randomUUID(),
      tool,
      color: tool === "eraser" ? "#ffffff" : brushColor,
      opacity: tool === "eraser" ? 1 : brushOpacity,
      size: tool === "eraser" ? 18 : 4,
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
      onChange([...shot.sketchData, currentStroke]);
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
      <div className="image-stage" ref={imageStageRef}>
        <img src={imageSrc} alt={shot.fileName} draggable={false} />
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
          <Layer
            scaleX={stageSize.width / sketchCanvasSize.width}
            scaleY={stageSize.height / sketchCanvasSize.height}
          >
            {[...shot.sketchData, ...(draftStroke ? [draftStroke] : [])].map((stroke) => (
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
        </Stage>
      </div>
    </div>
  );
};
