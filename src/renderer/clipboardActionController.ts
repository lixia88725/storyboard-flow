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

type ProjectUpdate = Project | ((currentProject: Project) => Project);
type StoryboardClipboardApi = Pick<
  NonNullable<Window["storyboard"]>,
  "copyLayerPng" | "copyShotAssets" | "ensureLayerAssets"
>;

export type ClipboardActionControllerOptions<HistoryEntry> = {
  api: StoryboardClipboardApi | undefined;
  bitmapLayerWriteQueueRef: { current: BitmapLayerWriteQueue };
  clipboardSelectionRef: { current: ClipboardSelection | undefined };
  createHistoryEntry: (bitmapPaths?: string[]) => Promise<HistoryEntry>;
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
  api,
  bitmapLayerWriteQueueRef,
  clipboardSelectionRef,
  createHistoryEntry,
  createId = () => crypto.randomUUID(),
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
}: ClipboardActionControllerOptions<HistoryEntry>) => {
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
    if (!api) {
      setStatus("Cannot paste storyboard: Electron preload API is unavailable");
      return;
    }
    if (!folderPath || !metadataPath) {
      setStatus("Cannot paste storyboard: workspace is not loaded");
      return;
    }

    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      const currentProject = projectRef.current;
      const sourceShot = currentProject.shots.find(
        (shot) => shot.id === sourceShotId
      );
      const targetShot = primaryShotOrFirst(
        sortedShots(currentProject.shots),
        selectedShotIdsRef.current
      );
      if (!sourceShot || !targetShot) {
        setStatus("Cannot paste storyboard: copied or target storyboard is missing");
        return;
      }

      const pastedShotId = createId();
      const copyPlan = shotAssetCopyPlan(sourceShot, pastedShotId);
      const ensuredLayerAssets = await withStatus(
        "Paste storyboard failed",
        () =>
          api.ensureLayerAssets({
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
          api.copyShotAssets({
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
      const nextProject = duplicateShotAfter(
        currentProject,
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
      updateProject(nextProject);
      markShotsDirty([pastedShotId]);
      selectSingleShot(pastedShotId);
      setSelectedBitmapLayerIds(undefined);
      setDeleteTarget({ type: "shot" });
      setStatus("Storyboard pasted");
    });
  };

  const pasteCopiedLayer = async (sourceShotId: string, sourceLayerId: string) => {
    if (!api || !folderPath) {
      setStatus("Cannot paste layer: Electron preload API is unavailable");
      return;
    }

    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
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

      const pastedLayerId = `layer-${createId()}`;
      const targetBitmapPath = bitmapLayerPath(targetShot.id, pastedLayerId);
      const undoEntry = await createHistoryEntry([targetBitmapPath]);
      const copied = await withStatus(
        "Paste layer failed",
        () =>
          api.copyLayerPng({
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
