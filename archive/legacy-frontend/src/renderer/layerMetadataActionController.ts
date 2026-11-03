import {
  moveBitmapLayer,
  moveBitmapLayerGroup,
  selectBitmapLayer,
  updateBitmapLayer,
  updateBitmapLayerGroupOpacity
} from "../shared/projectOps";
import type { BitmapLayer, Project } from "../shared/types";
import type { DeleteTarget } from "./deleteTarget";

type ProjectUpdate = Project | ((currentProject: Project) => Project);
type LayerPlacement = "before" | "after";
type BitmapLayerPatch = Partial<Pick<BitmapLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>;

export const useLayerMetadataActionController = ({
  markShotsDirty,
  setDeleteTarget,
  shotSelectionAnchorIdRef,
  updateProject
}: {
  markShotsDirty: (shotIds: string[]) => void;
  setDeleteTarget: (target: DeleteTarget) => void;
  shotSelectionAnchorIdRef: { current: string | undefined };
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
}) => {
  const handleSelectLayer = (shotId: string, layerId: string) => {
    shotSelectionAnchorIdRef.current = undefined;
    setDeleteTarget({ type: "layer", shotId, layerId });
    updateProject((currentProject) => selectBitmapLayer(currentProject, shotId, layerId), false, false);
  };

  const handleUpdateLayer = (shotId: string, layerId: string, patch: BitmapLayerPatch) => {
    markShotsDirty([shotId]);
    updateProject((currentProject) => updateBitmapLayer(currentProject, shotId, layerId, patch), false);
  };

  const handleMoveLayer = (
    shotId: string,
    layerId: string,
    targetLayerId: string,
    placement: LayerPlacement
  ) => {
    markShotsDirty([shotId]);
    updateProject(
      (currentProject) => moveBitmapLayer(currentProject, shotId, layerId, targetLayerId, placement),
      false
    );
  };

  const handleMoveLayerGroup = (
    shotId: string,
    layerIds: string[],
    targetLayerId: string,
    placement: LayerPlacement
  ) => {
    markShotsDirty([shotId]);
    updateProject(
      (currentProject) => moveBitmapLayerGroup(currentProject, shotId, layerIds, targetLayerId, placement),
      false
    );
  };

  const handleUpdateLayerGroupOpacity = (
    shotId: string,
    layerIds: string[],
    deltaOpacity: number,
    initialOpacityByLayerId: Record<string, number>
  ) => {
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
  };

  return {
    handleMoveLayer,
    handleMoveLayerGroup,
    handleSelectLayer,
    handleUpdateLayer,
    handleUpdateLayerGroupOpacity
  };
};
