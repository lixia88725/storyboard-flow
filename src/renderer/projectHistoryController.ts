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
import type { CompletedEffect } from "./normalSaveProjectOwner";
import { shotIdsForBitmapPaths } from "./shotBitmapRevision";
import { classifyPendingBake, pendingBakeForProject } from "../shared/pendingBake";

export type ProjectHistoryEntry = {
  project: Project;
  selectedShotIds: string[];
  fileNameSyncState: FileNameSyncState;
  layerAssets?: LayerAssetSnapshot[];
};

type HistoryDirection = "undo" | "redo";

/** Explicit private-stack snapshot, not reconstruction from current Project JSON.
 * Optional absent collections can be own undefined after namespace rebasing;
 * encode their domain absence by omitting only those known optional fields. */
export const captureProjectHistoryData = (undo: ProjectHistoryEntry[], redo: ProjectHistoryEntry[]) => {
  const data = structuredClone({ undo, redo });
  for (const entry of [...data.undo, ...data.redo]) {
    if (entry.project.parkedShots === undefined) delete entry.project.parkedShots;
    if (entry.project.pendingDeletedShots === undefined) delete entry.project.pendingDeletedShots;
  }
  return data;
};

// Both stacks append at the end and applyHistoryEntry pops at(-1). A whole
// Project snapshot has only entry-local PNGs: skipping a rejected step loses
// asset dependencies needed by older entries. Keep only the provable suffix.
export const preserveContiguousHistoryEntries = (
  entries: ProjectHistoryEntry[], transform: (entry: ProjectHistoryEntry) => ProjectHistoryEntry | false
): ProjectHistoryEntry[] => {
  const retained: ProjectHistoryEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = transform(entries[index]);
    if (!entry) break;
    retained.push(entry);
  }
  return retained.reverse();
};

// Pending is a namespace operation, not an undoable physical move. Preserve
// the contiguous compatible suffix by rebasing it; stop at the first moved-shot
// source/scope that cannot be proved. Internal PNG paths do not move.
export const rebasePendingHistoryEntries = (entries: ProjectHistoryEntry[], before: Project, after: Project,
  ids: string[], update: (project: Project) => Project, verifiedSave = false): ProjectHistoryEntry[] => {
  const shots = (p: Project) => [...p.shots, ...(p.parkedShots ?? [])];
  return preserveContiguousHistoryEntries(entries, entry => {
    if (verifiedSave) {
      // Do not turn unsupported/raw-unknown or unproved deleted/parked history
      // into a synced snapshot. Keep only the existing provable pop suffix.
      const history = entry.project;
      const layout = (p: Project) => JSON.stringify([p.shots.map(s => s.id).sort(),
        (p.parkedShots ?? []).map(s => s.id).sort()]);
      if (classifyPendingBake(history) !== "supported" ||
          shots(history).some(s => pendingBakeForProject(history).shots[s.id].state === "unknown") ||
          layout(history) !== layout(before)) return false;
    }
    if (ids.some(id => {
      const a = shots(before).find(s => s.id === id), b = shots(entry.project).find(s => s.id === id);
      return !a || !b || a.imagePath !== b.imagePath || a.swb?.sourcePath !== b.swb?.sourcePath ||
        a.swb?.sourceKind !== b.swb?.sourceKind || a.swb?.status !== b.swb?.status ||
        before.shots.some(s => s.id === id) !== entry.project.shots.some(s => s.id === id);
    })) return false;
    const transitioned = update(entry.project);
    if (ids.some(id => !shots(transitioned).some(s => s.id === id) ||
      transitioned.shots.some(s => s.id === id) !== after.shots.some(s => s.id === id))) return false;
    const patchShot = (s: Shot): Shot => {
      const target = ids.includes(s.id) && shots(after).find(t => t.id === s.id);
      return target ? { ...s, imagePath: target.imagePath, fileName: target.fileName,
        swb: s.swb && target.swb ? { ...s.swb, baseFingerprint: target.swb.baseFingerprint } : s.swb } : s;
    };
    const project = { ...transitioned, pendingBake: after.pendingBake, shots: transitioned.shots.map(patchShot), parkedShots: transitioned.parkedShots?.map(patchShot) };
    return { ...entry, project, fileNameSyncState: "unsynced" as const,
      selectedShotIds: entry.selectedShotIds.filter(id => project.shots.some(s => s.id === id)) };
  });
};

// Each entry restores a whole Project, including shots absent from its PNG list.
// A non-undoable presentation write invalidates entries unless their affected
// shot metadata already matches the installed assets and they restore none of
// the overwritten paths. This deliberately sacrifices uncertain old edits,
// while preserving the provable near-current segment and subsequently recorded
// history. Never bridge a rejected entry whose local PNGs older Project states need.
export const invalidatePresentationHistoryEntries = (
  entries: ProjectHistoryEntry[], after: Project, ids: readonly string[], paths: readonly string[]
): ProjectHistoryEntry[] => {
  const shots = (project: Project) => [...project.shots, ...(project.parkedShots ?? [])];
  return preserveContiguousHistoryEntries(entries, entry => {
    if (entry.layerAssets?.some(asset => paths.includes(asset.bitmapPath))) return false;
    const dependencies = new Set([...ids,
      ...[...shots(after), ...shots(entry.project)]
        .filter(shot => shot.layers?.some(layer => paths.includes(layer.bitmapPath)))
        .map(shot => shot.id)]);
    const compatible = [...dependencies].every(id => {
      const current = shots(after).find(shot => shot.id === id);
      const historical = shots(entry.project).find(shot => shot.id === id);
      return Boolean(current && historical) &&
        after.shots.some(shot => shot.id === id) === entry.project.shots.some(shot => shot.id === id) &&
        JSON.stringify(current) === JSON.stringify(historical) &&
        JSON.stringify(after.dialogues.filter(dialogue => dialogue.shotId === id)) ===
          JSON.stringify(entry.project.dialogues.filter(dialogue => dialogue.shotId === id));
    });
    return compatible ? entry : false;
  });
};

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
  const currentShots = [...currentProject.shots, ...(currentProject.parkedShots ?? [])];
  const restoredShots = [...restoredProject.shots, ...(restoredProject.parkedShots ?? [])];
  const currentShotById = new Map(currentShots.map((shot) => [shot.id, shot]));
  const dirtyShotIds = new Set([
    ...shotIdsForBitmapPaths(currentProject, restoredBitmapPaths),
    ...shotIdsForBitmapPaths(restoredProject, restoredBitmapPaths)
  ]);

  for (const shot of restoredShots) {
    if (shotTiffInputsChanged(currentShotById.get(shot.id), shot) ||
        shot.layers?.some(layer => restoredBitmapPaths.includes(layer.bitmapPath))) {
      dirtyShotIds.add(shot.id);
    }
  }

  return restoredShots
    .filter((shot) => dirtyShotIds.has(shot.id))
    .map((shot) => shot.id);
};

export const historyUnavailableStatus = (direction: HistoryDirection): string =>
  direction === "undo" ? "Nothing to undo" : "Nothing to redo";

export const historyAppliedStatus = (direction: HistoryDirection): string =>
  direction === "undo" ? "Undid last change" : "Redid last change";

type UseProjectHistoryControllerOptions = {
  captureWorkspace?: () => () => boolean;
  captureEffectCompletion?: () => CompletedEffect;
  // Installed private stacks survive Close freeze but not workspace replacement.
  captureInstalledHistory?: () => () => boolean;
  isImageImportLocked: () => boolean;
  getRecoveryRequiredMessage?: () => string | undefined;
  api: LayerAssetApi | undefined;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  fileNameSyncStateRef: RefObject<FileNameSyncState>;
  folderPathRef: RefObject<string | undefined>;
  markShotsDirty: (shotIds: string[]) => void;
  maxEntries: number;
  onLayerAssetsRestored?: (bitmapPaths: string[]) => void;
  publishProject?: (project: Project, outputShotIds: string[]) => boolean;
  publishMetadataProject?: (project: Project, outputShotIds: string[]) => Promise<boolean>;
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
  captureWorkspace,
  captureEffectCompletion,
  captureInstalledHistory,
  isImageImportLocked,
  getRecoveryRequiredMessage,
  api,
  bitmapLayerWriteQueueRef,
  fileNameSyncStateRef,
  folderPathRef,
  markShotsDirty,
  maxEntries,
  onLayerAssetsRestored,
  publishProject,
  publishMetadataProject,
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
    // Capture the metadata inputs synchronously with the read's origin. A caller
    // still owns validating this entry before recording/committing after awaits.
    const entry = createHistoryEntryFromLayerAssets();
    const layerAssets =
      api && activeFolderPath && bitmapPaths.length > 0
        ? await readLayerAssetSnapshots(api, activeFolderPath, bitmapPaths)
        : [];

    return { ...entry, layerAssets };
  };

  const createHistoryEntryFromLayerAssets = (
    layerAssets: LayerAssetSnapshot[] = []
  ): ProjectHistoryEntry => {
    return {
      project: projectRef.current,
      selectedShotIds: [...selectedShotIdsRef.current],
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

  const requireHistorySafe = (): boolean => {
    const message = getRecoveryRequiredMessage?.() ??
      (Object.values(projectRef.current.pendingBake?.shots ?? {}).some(state => state.state === "unknown")
        ? "History blocked: Pending output namespace is unknown; reopen this workspace before continuing" : undefined);
    if (message) setStatus(message);
    return !message;
  };

  const applyHistoryEntry = async (direction: HistoryDirection) => {
    if (isImageImportLocked() || !requireHistorySafe()) return;
    const isWorkspaceCurrent = captureWorkspace?.() ?? (() => true);
    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (!isWorkspaceCurrent() || isImageImportLocked() || !requireHistorySafe()) return;
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
        if (!isWorkspaceCurrent() || isImageImportLocked() || !requireHistorySafe()) return;
        const completion = entry.layerAssets?.length ? captureEffectCompletion?.() : undefined;
        const installedHistory = captureInstalledHistory?.();
        const originalUndo = undoStackRef.current, originalRedo = redoStackRef.current;
        let transitioned = false;
        const transition = (requireInstalled = false) => {
          if (transitioned) return;
          if (requireInstalled && !installedHistory?.() ||
              undoStackRef.current !== originalUndo || redoStackRef.current !== originalRedo ||
              sourceStackRef.current.at(-1) !== entry) {
            throw new Error('Completed restore original history unavailable or replaced');
          }
          if (direction === 'undo') {
            setRedoStackSynced(appendHistoryEntry(originalRedo, reciprocalEntry, maxEntries));
            setUndoStackSynced(originalUndo.slice(0, -1));
          } else {
            setUndoStackSynced(appendHistoryEntry(originalUndo, reciprocalEntry, maxEntries));
            setRedoStackSynced(originalRedo.slice(0, -1));
          }
          transitioned = true;
        };
        // After the first restore IPC begins, finish history + metadata publication.
        // Metadata-only history must not yield between admission and its first
        // publication. With real assets, the first restore IPC is the linearization point.
        if (api && folderPathRef.current && entry.layerAssets?.length) {
          try { await restoreHistoryLayerAssets(entry); }
          catch (error) { completion?.failed(error, dirtyShotIds); throw error; }
        }
        const metadataPublished = !entry.layerAssets?.length && publishMetadataProject
          ? await publishMetadataProject(entry.project, dirtyShotIds) : undefined;
        if (metadataPublished === false) throw new Error("History metadata publication refused");
        if (metadataPublished === undefined && publishProject && !publishProject(entry.project, dirtyShotIds)) {
          if (!completion) throw new Error('History output publication refused without original completion');
          await completion(entry.project, dirtyShotIds, {
            published: () => transition(true), afterDurable: async () => undefined
          });
          // Original PNG + exact reciprocal transition + bound ACK are finished.
          // Do not turn this success into an arbitrary failure or publish stale UI.
          return;
        }
        transition();
        onLayerAssetsRestored?.(affectedBitmapPaths);

        if (!publishProject) {
          setProject(entry.project);
          projectRef.current = entry.project;
        }
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
        selectedShotIds: [...selectedShotIdsRef.current],
        fileNameSyncState: fileNameSyncStateRef.current
      }),
    resetHistoryStacks,
    captureHistoryData: () => captureProjectHistoryData(undoStackRef.current, redoStackRef.current),
    restoreHistoryData: (data: { undo: ProjectHistoryEntry[]; redo: ProjectHistoryEntry[] }) => {
      setUndoStackSynced(structuredClone(data.undo));
      setRedoStackSynced(structuredClone(data.redo));
    },
    invalidatePresentationHistory: (after: Project, ids: readonly string[], paths: readonly string[]) => {
      setUndoStackSynced(entries => invalidatePresentationHistoryEntries(entries, after, ids, paths));
      setRedoStackSynced(entries => invalidatePresentationHistoryEntries(entries, after, ids, paths));
    },
    rebasePendingHistory: (before: Project, after: Project, ids: string[], update: (project: Project) => Project, verifiedSave = false) => {
      setUndoStackSynced(entries => rebasePendingHistoryEntries(entries, before, after, ids, update, verifiedSave));
      setRedoStackSynced(entries => rebasePendingHistoryEntries(entries, before, after, ids, update, verifiedSave));
    }
  };
};
