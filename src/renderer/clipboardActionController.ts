import {
  bitmapLayerPath,
  copyBitmapLayerToShot,
  duplicateShotAfter,
  sortedShots
} from "../shared/projectOps";
import type { Project } from "../shared/types";
import { primaryShotOrFirst } from "./activeTargets";
import {
  copySelectionFromProject,
  layerPasteTargetFromProject,
  shotAssetCopyPlan,
  type ClipboardSelection
} from "./clipboardSelection";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { DeleteTarget } from "./deleteTarget";
import type { SelectedBitmapLayerIds } from "./storyboardInteractionState";
import { withStatus } from "./statusAction";
import { decodeCopyShotAssetsResult } from "../shared/copyShotAssetsIpc";

export type ClipboardWorkspace = {
  identity: object;
  folderPath: string | undefined;
  metadataPath: string | undefined;
};

type ProjectUpdate = Project | ((currentProject: Project) => Project);
type StoryboardClipboardApi = Pick<
  NonNullable<Window["storyboard"]>,
  "copyLayerPng" | "copyShotAssets" | "ensureLayerAssets"
>;

export type ClipboardActionControllerOptions<HistoryEntry> = {
  isImageImportLocked: () => boolean;
  publishNewShot?: (update: (p: Project) => Project, shotId: string, isCurrent: () => boolean) => Promise<boolean>;
  api: StoryboardClipboardApi | undefined;
  captureEnsureScope?: () => () => boolean;
  // Optional for copy-only callers; Paste fails closed without both ownership ports.
  captureWorkspace?: () => ClipboardWorkspace;
  isCurrentWorkspace?: (request: ClipboardWorkspace) => boolean;
  bitmapLayerWriteQueueRef: { current: BitmapLayerWriteQueue };
  clipboardSelectionRef: { current: ClipboardSelection | undefined };
  createHistoryEntry: (bitmapPaths?: string[]) => Promise<HistoryEntry>;
  // Keep pre-copy bitmap snapshots, but capture the latest metadata immediately before publication.
  refreshHistoryEntry?: (entry: HistoryEntry) => HistoryEntry;
  createId?: () => string;
  deleteTargetRef: { current: DeleteTarget };
  folderPath: string | undefined;
  markShotsDirty: (shotIds: string[]) => void;
  metadataPath: string | undefined;
  projectRef: { current: Project };
  queuePasteAnimation: (
    kind: "shot" | "layer",
    sourceId: string,
    pastedId: string
  ) => void;
  recordUndoEntry: (entry: HistoryEntry) => void;
  selectSingleShot: (shotId: string | undefined) => void;
  selectedShotIdsRef: { current: string[] };
  setClipboardSelection: (clipboardSelection: ClipboardSelection | undefined) => void;
  setDeleteTarget: (target: DeleteTarget) => void;
  setSelectedBitmapLayerIds: (selection: SelectedBitmapLayerIds | undefined) => void;
  setStatus: (status: string) => void;
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
};

export const useClipboardActionController = <HistoryEntry,>({
  isImageImportLocked,
  publishNewShot,
  api,
  captureEnsureScope,
  captureWorkspace,
  isCurrentWorkspace,
  bitmapLayerWriteQueueRef,
  clipboardSelectionRef,
  createHistoryEntry,
  refreshHistoryEntry = (entry) => entry,
  createId = () => crypto.randomUUID(),
  deleteTargetRef,
  markShotsDirty,
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
}: ClipboardActionControllerOptions<HistoryEntry>) => {
  // TODO: verify owned provisional-asset recovery. Late successful IPCs may leave new
  // TIFF/preview/PNG assets in the captured origin. No safe owned-cleanup port exists:
  // retain them (and all source/history assets), never infer deletion from live JSON.
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

  const pasteCopiedShot = async (sourceShotId: string) => {
    const ensureScope = captureEnsureScope?.() ?? (() => true);
    const origin = captureWorkspace?.();
    if (!origin || !isCurrentWorkspace) {
      setStatus("Cannot paste storyboard: workspace ownership is unavailable");
      return;
    }
    const { folderPath, metadataPath } = origin;
    const isCurrent = () => isCurrentWorkspace(origin);
    const scopedStatus = (status: string) => { if (isCurrent()) setStatus(status); };
    if (!api) {
      setStatus("Cannot paste storyboard: Electron preload API is unavailable");
      return;
    }
    if (!folderPath || !metadataPath) {
      setStatus("Cannot paste storyboard: workspace is not loaded");
      return;
    }

    const projectAtRequest = projectRef.current;
    const sourceShot = projectAtRequest.shots.find((shot) => shot.id === sourceShotId);
    const targetShot = primaryShotOrFirst(sortedShots(projectAtRequest.shots), selectedShotIdsRef.current);
    if (!sourceShot || !targetShot) {
      scopedStatus("Cannot paste storyboard: copied or target storyboard is missing");
      return;
    }
    const pastedShotId = createId();
    const copyPlan = shotAssetCopyPlan(sourceShot, pastedShotId);
    const sourceAssets = (shot: typeof sourceShot) => JSON.stringify([
      shot.imagePath, shot.fileName, shot.layers,
      shotAssetCopyPlan(shot, pastedShotId)
    ]);
    const capturedAssets = sourceAssets(sourceShot);
    const canPaste = (project: Project) => {
      if (!isCurrent() || !ensureScope()) return false;
      const source = project.shots.find((shot) => shot.id === sourceShotId);
      if (!source || !project.shots.some((shot) => shot.id === targetShot.id) ||
          sourceAssets(source) !== capturedAssets || project.shots.some((shot) => shot.id === pastedShotId)) {
        scopedStatus("Cannot paste storyboard: copied or target storyboard changed");
        return false;
      }
      return true;
    };

    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      if (isImageImportLocked() || !canPaste(projectRef.current)) return;
      const currentProject = projectRef.current;
      const ensuredLayerAssets = await withStatus(
        "Paste storyboard failed",
        () =>
          api.ensureLayerAssets({
            project: currentProject,
            folderPath,
            metadataPath
          }),
        scopedStatus
      );

      if (!canPaste(projectRef.current) || !ensuredLayerAssets) {
        return;
      }

      const copiedAssets = await withStatus(
        "Paste storyboard failed",
        async () =>
          decodeCopyShotAssetsResult(await api.copyShotAssets({
            folderPath,
            sourceImagePath: sourceShot.imagePath,
            fileName: sourceShot.fileName,
            layerCopies: copyPlan.layerCopies
          })),
        scopedStatus
      );

      if (!canPaste(projectRef.current) || !copiedAssets) {
        return;
      }

      const nextProject = duplicateShotAfter(
        projectRef.current,
        sourceShotId,
        targetShot.id,
        {
          shotId: pastedShotId,
          imagePath: copiedAssets.imagePath,
          fileName: copiedAssets.fileName,
          previewPath: copiedAssets.previewPath,
          placement: "after"
        }
      );
      if (!nextProject.shots.some((shot) => shot.id === pastedShotId)) return;
      if (publishNewShot) {
        const insert = (p: Project) => duplicateShotAfter(p, sourceShotId, targetShot.id, {
          shotId: pastedShotId, imagePath: copiedAssets.imagePath, fileName: copiedAssets.fileName,
          previewPath: copiedAssets.previewPath, placement: "after"
        });
        if (!await publishNewShot(insert, pastedShotId, () => canPaste(projectRef.current))) {
          scopedStatus("Paste storyboard incomplete; output initialization refused");
          return;
        }
      } else {
        updateProject(nextProject);
      }
      queuePasteAnimation("shot", sourceShot.id, pastedShotId);
      markShotsDirty([pastedShotId]);
      selectSingleShot(pastedShotId);
      setSelectedBitmapLayerIds(undefined);
      setDeleteTarget({ type: "shot" });
      setStatus("Storyboard pasted");
    });
  };

  const pasteCopiedLayer = async (sourceShotId: string, sourceLayerId: string) => {
    const origin = captureWorkspace?.();
    if (!origin || !isCurrentWorkspace) {
      setStatus("Cannot paste layer: workspace ownership is unavailable");
      return;
    }
    const { folderPath } = origin;
    const isCurrent = () => isCurrentWorkspace(origin);
    const scopedStatus = (status: string) => { if (isCurrent()) setStatus(status); };
    if (!api || !folderPath) {
      setStatus("Cannot paste layer: Electron preload API is unavailable");
      return;
    }

    const pasteTarget = layerPasteTargetFromProject(
      projectRef.current, deleteTargetRef.current, sourceShotId, sourceLayerId
    );
    if (!pasteTarget.ok) {
      scopedStatus(pasteTarget.status);
      return;
    }
    const { sourceLayer, targetShot, targetLayer } = pasteTarget;
    const capturedTarget: DeleteTarget = { type: "layer", shotId: targetShot.id, layerId: targetLayer.id };
    const pastedLayerId = `layer-${createId()}`;
    const targetBitmapPath = bitmapLayerPath(targetShot.id, pastedLayerId);
    const canPaste = (project: Project) => {
      if (!isCurrent()) return false;
      const live = layerPasteTargetFromProject(project, capturedTarget, sourceShotId, sourceLayerId);
      // resolveDeleteTarget may fall back to another layer; require the exact captured pair.
      if (!live.ok || live.targetShot.id !== targetShot.id || live.targetLayer.id !== targetLayer.id ||
          live.targetLayer.locked || JSON.stringify(live.sourceLayer) !== JSON.stringify(sourceLayer) ||
          live.targetShot.layers?.some((layer) => layer.id === pastedLayerId)) {
        scopedStatus("Cannot paste layer: copied or target layer changed or is locked");
        return false;
      }
      return true;
    };

    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      if (isImageImportLocked() || !canPaste(projectRef.current)) return;
      const undoEntry = await withStatus(
        "Paste layer failed", () => createHistoryEntry([targetBitmapPath]), scopedStatus
      );
      if (isImageImportLocked() || !canPaste(projectRef.current) || !undoEntry) return;
      const copied = await withStatus(
        "Paste layer failed",
        () =>
          api.copyLayerPng({
            folderPath,
            sourceBitmapPath: sourceLayer.bitmapPath,
            targetBitmapPath
          }),
        scopedStatus
      );

      if (!canPaste(projectRef.current) || !copied) {
        return;
      }

      const nextProject = copyBitmapLayerToShot(
        projectRef.current, sourceShotId, sourceLayerId, targetShot.id,
        pastedLayerId, targetLayer.id, "before"
      );
      if (!nextProject.shots.find((shot) => shot.id === targetShot.id)?.layers?.some((layer) => layer.id === pastedLayerId)) return;
      const currentUndoEntry = refreshHistoryEntry(undoEntry);
      queuePasteAnimation("layer", sourceLayer.id, pastedLayerId);
      updateProject(nextProject, false, false);
      // Record only after the additive change has actually been published.
      recordUndoEntry(currentUndoEntry);
      markShotsDirty([targetShot.id]);
      selectSingleShot(targetShot.id);
      setSelectedBitmapLayerIds({
        shotId: targetShot.id,
        layerIds: [pastedLayerId]
      });
      setDeleteTarget({
        type: "layer",
        shotId: targetShot.id,
        layerId: pastedLayerId
      });
      setStatus(`Layer "${sourceLayer.name}" pasted`);
    });
  };

  const handlePasteSelection = async () => {
    if (isImageImportLocked()) return;
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

  return {
    handleCopySelection,
    handlePasteSelection
  };
};
