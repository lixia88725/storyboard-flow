import { deleteShots, sortedShots } from "../shared/projectOps";
import type { Project } from "../shared/types";
import { activeVisibleBitmapLayerForShot } from "./activeTargets";
import {
  resolveDeleteTarget,
  type DeleteTarget
} from "./deleteTarget";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

export type SelectedShotDeletePlan =
  | {
      ok: false;
    }
  | {
      ok: true;
      nextSelectedShotId: string | undefined;
    };

export const selectedShotDeletePlan = (
  project: Project,
  selectedShotIds: string[]
): SelectedShotDeletePlan => {
  if (selectedShotIds.length === 0) {
    return { ok: false };
  }

  const selected = new Set(selectedShotIds);
  const ordered = sortedShots(project.shots);
  const firstDeletedIndex = ordered.findIndex((shot) => selected.has(shot.id));
  const remaining = ordered.filter((shot) => !selected.has(shot.id));

  if (firstDeletedIndex === -1 || remaining.length === ordered.length) {
    return { ok: false };
  }

  return {
    ok: true,
    nextSelectedShotId: remaining[Math.min(firstDeletedIndex, remaining.length - 1)]?.id
  };
};

export const selectedShotDeleteStatus = (selectedCount: number): string =>
  selectedCount === 1
    ? "Storyboard deleted; Save will move its file to Trash"
    : `${selectedCount} storyboards deleted; Save will move their files to Trash`;

export const useDeleteActionController = ({
  isImageImportLocked,
  deleteTargetRef,
  handleRemoveBitmapLayer,
  projectRef,
  selectedShotIdsRef,
  selectSingleShot,
  setDeleteTarget,
  setStatus,
  updateProject
}: {
  isImageImportLocked: () => boolean;
  deleteTargetRef: { current: DeleteTarget };
  handleRemoveBitmapLayer: (shotId: string, layerId: string) => Promise<void>;
  projectRef: { current: Project };
  selectedShotIdsRef: { current: string[] };
  selectSingleShot: (shotId: string | undefined) => void;
  setDeleteTarget: (target: DeleteTarget) => void;
  setStatus: (status: string) => void;
  updateProject: (projectUpdate: ProjectUpdate) => void;
}) => {
  const handleDeleteSelectedShots = () => {
    if (isImageImportLocked()) return;
    const selectedIds = selectedShotIdsRef.current;
    const plan = selectedShotDeletePlan(projectRef.current, selectedIds);

    if (!plan.ok) {
      return;
    }

    updateProject((projectToUpdate) => deleteShots(projectToUpdate, selectedIds));
    selectSingleShot(plan.nextSelectedShotId);
    setDeleteTarget({ type: "shot" });
    setStatus(selectedShotDeleteStatus(selectedIds.length));
  };

  const handleDeleteKeyPress = async () => {
    if (isImageImportLocked()) return;
    const resolvedTarget = resolveDeleteTarget(projectRef.current, deleteTargetRef.current);

    if (resolvedTarget.type === "layer") {
      await handleRemoveBitmapLayer(resolvedTarget.shotId, resolvedTarget.layerId);
      const nextShot = projectRef.current.shots.find((shot) => shot.id === resolvedTarget.shotId);
      // Removal may have been rejected at queue admission. Do not publish target changes
      // for an operation that did not remove its layer (no queue return-contract change).
      if (nextShot?.layers?.some((layer) => layer.id === resolvedTarget.layerId)) return;
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

  return {
    handleDeleteKeyPress,
    handleDeleteSelectedShots
  };
};
