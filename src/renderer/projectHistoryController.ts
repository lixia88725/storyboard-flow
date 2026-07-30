import { useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { Project, Shot } from "../shared/types";
import {
  readLayerAssetSnapshots,
  restoreLayerAssetSnapshots,
  type LayerAssetApi,
  type LayerAssetSnapshot
} from "./bitmapLayerHistory";
import { appendHistoryEntry, useSyncedHistoryStackController } from "./historyStackController";
import type { FileNameSyncState, WorkspaceSaveState } from "./workspaceLifecycleState";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { shotIdsForBitmapPaths } from "./shotBitmapRevision";

export type ProjectHistoryEntry = {
  project: Project;
  selectedShotIds: string[];
  fileNameSyncState: FileNameSyncState;
  layerAssets?: LayerAssetSnapshot[];
};

type HistoryDirection = "undo" | "redo";

export const historyEntryAffectedBitmapPaths = (entry: ProjectHistoryEntry): string[] =>
  entry.layerAssets?.map((snapshot) => snapshot.bitmapPath) ?? [];

const shotTiffInputsChanged = (previousShot: Shot | undefined, nextShot: Shot): boolean =>
  !previousShot ||
  previousShot.layers !== nextShot.layers ||
  previousShot.sketchLayers !== nextShot.sketchLayers ||
  previousShot.imageLayerEdits !== nextShot.imageLayerEdits ||
  previousShot.baseVisible !== nextShot.baseVisible ||
  previousShot.presentation !== nextShot.presentation ||
  previousShot.swb !== nextShot.swb;

export const historyDirtyShotIds = (
  currentProject: Project,
  restoredProject: Project,
  restoredBitmapPaths: readonly string[]
): string[] => {
  const currentShotById = new Map(currentProject.shots.map((shot) => [shot.id, shot]));
  const dirtyShotIds = new Set([
    ...shotIdsForBitmapPaths(currentProject, restoredBitmapPaths),
    ...shotIdsForBitmapPaths(restoredProject, restoredBitmapPaths)
  ]);

  for (const shot of restoredProject.shots) {
    if (shotTiffInputsChanged(currentShotById.get(shot.id), shot)) {
      dirtyShotIds.add(shot.id);
    }
  }

  return restoredProject.shots
    .filter((shot) => dirtyShotIds.has(shot.id))
    .map((shot) => shot.id);
};

export const historyUnavailableStatus = (direction: HistoryDirection): string =>
  direction === "undo" ? "Nothing to undo" : "Nothing to redo";

export const historyAppliedStatus = (direction: HistoryDirection): string =>
  direction === "undo" ? "Undid last change" : "Redid last change";

type UseProjectHistoryControllerOptions = {
  api: LayerAssetApi | undefined;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  fileNameSyncStateRef: RefObject<FileNameSyncState>;
  folderPathRef: RefObject<string | undefined>;
  markShotsDirty: (shotIds: string[]) => void;
  maxEntries: number;
  onLayerAssetsRestored?: (bitmapPaths: string[]) => void;
  projectRef: RefObject<Project>;
  scriptImportCheckIdRef: MutableRefObject<number>;
  selectShotsByIds: (shotIds: string[]) => void;
  selectedShotIdsRef: RefObject<string[]>;
  setAutosaveRevision: (updater: (revision: number) => number) => void;
  setFileNameSyncState: (state: FileNameSyncState) => void;
  setProject: (project: Project) => void;
  setScriptImportNeeded: (needed: boolean) => void;
  setStatus: (status: string) => void;
  setWorkspaceSaveState: (state: WorkspaceSaveState) => void;
};

export const useProjectHistoryController = ({
  api,
  bitmapLayerWriteQueueRef,
  fileNameSyncStateRef,
  folderPathRef,
  markShotsDirty,
  maxEntries,
  onLayerAssetsRestored,
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
}: UseProjectHistoryControllerOptions) => {
  const [undoStack, setUndoStack] = useState<ProjectHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectHistoryEntry[]>([]);
  const undoStackRef = useRef<ProjectHistoryEntry[]>([]);
  const redoStackRef = useRef<ProjectHistoryEntry[]>([]);
  const setUndoStackSynced = useSyncedHistoryStackController({
    stack: undoStack,
    stackRef: undoStackRef,
    setStack: setUndoStack
  });
  const setRedoStackSynced = useSyncedHistoryStackController({
    stack: redoStack,
    stackRef: redoStackRef,
    setStack: setRedoStack
  });

  const createHistoryEntry = async (bitmapPaths: string[] = []): Promise<ProjectHistoryEntry> => {
    const activeFolderPath = folderPathRef.current;
    const layerAssets =
      api && activeFolderPath && bitmapPaths.length > 0
        ? await readLayerAssetSnapshots(api, activeFolderPath, bitmapPaths)
        : [];

    return createHistoryEntryFromLayerAssets(layerAssets);
  };

  const createHistoryEntryFromLayerAssets = (
    layerAssets: LayerAssetSnapshot[] = []
  ): ProjectHistoryEntry => {
    return {
      project: projectRef.current,
      selectedShotIds: selectedShotIdsRef.current,
      fileNameSyncState: fileNameSyncStateRef.current,
      layerAssets
    };
  };

  const recordUndoEntry = (entry: ProjectHistoryEntry) => {
    setUndoStackSynced((current) => appendHistoryEntry(current, entry, maxEntries));
    setRedoStackSynced([]);
  };

  const resetHistoryStacks = () => {
    setUndoStackSynced([]);
    setRedoStackSynced([]);
  };

  const restoreHistoryLayerAssets = async (entry: ProjectHistoryEntry) => {
    const activeFolderPath = folderPathRef.current;
    if (!api || !activeFolderPath || !entry.layerAssets?.length) {
      return;
    }

    await restoreLayerAssetSnapshots(api, activeFolderPath, entry.layerAssets);
  };

  const applyHistoryEntry = async (direction: HistoryDirection) => {
    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        const sourceStackRef =
          direction === "undo" ? undoStackRef : redoStackRef;
        const entry = sourceStackRef.current.at(-1);
        if (!entry) {
          setStatus(historyUnavailableStatus(direction));
          return;
        }

        const affectedBitmapPaths = historyEntryAffectedBitmapPaths(entry);
        const dirtyShotIds = historyDirtyShotIds(
          projectRef.current,
          entry.project,
          affectedBitmapPaths
        );
        const reciprocalEntry = await createHistoryEntry(affectedBitmapPaths);
        await restoreHistoryLayerAssets(entry);
        onLayerAssetsRestored?.(affectedBitmapPaths);

        if (direction === "undo") {
          setRedoStackSynced((current) =>
            appendHistoryEntry(current, reciprocalEntry, maxEntries)
          );
          setUndoStackSynced((current) => current.slice(0, -1));
        } else {
          setUndoStackSynced((current) =>
            appendHistoryEntry(current, reciprocalEntry, maxEntries)
          );
          setRedoStackSynced((current) => current.slice(0, -1));
        }

        setProject(entry.project);
        projectRef.current = entry.project;
        selectShotsByIds(entry.selectedShotIds);
        setFileNameSyncState(entry.fileNameSyncState);
        setWorkspaceSaveState("saving");
        markShotsDirty(dirtyShotIds);
        setAutosaveRevision((revision) => revision + 1);
        scriptImportCheckIdRef.current += 1;
        setScriptImportNeeded(false);
        setStatus(historyAppliedStatus(direction));
      });
    } catch (error) {
      setStatus(
        `${direction === "undo" ? "Undo" : "Redo"} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return {
    applyRedoEntry: () => applyHistoryEntry("redo"),
    applyUndoEntry: () => applyHistoryEntry("undo"),
    createHistoryEntry,
    createHistoryEntryFromLayerAssets,
    recordUndoEntry,
    recordProjectUndoEntry: () =>
      recordUndoEntry({
        project: projectRef.current,
        selectedShotIds: selectedShotIdsRef.current,
        fileNameSyncState: fileNameSyncStateRef.current
      }),
    resetHistoryStacks
  };
};
