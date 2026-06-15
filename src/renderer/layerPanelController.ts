import { useCallback, useState } from "react";
import type { DeleteTarget } from "./deleteTarget";
import type { SelectedBitmapLayerIds } from "./storyboardInteractionState";

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export const isLayerPanelOpenForShot = (
  isLayerPanelOpen: boolean,
  shotId: string,
  primarySelectedShotId: string | undefined
): boolean => isLayerPanelOpen && shotId === primarySelectedShotId;

export const nextLayerPanelOpenState = (
  isLayerPanelOpen: boolean,
  shotId: string,
  primarySelectedShotId: string | undefined
): boolean => {
  if (!primarySelectedShotId) {
    return isLayerPanelOpen;
  }

  return shotId === primarySelectedShotId ? !isLayerPanelOpen : true;
};

export type LayerPanelControllerOptions = {
  primarySelectedShotId: string | undefined;
  selectSingleShot: (shotId: string) => void;
  setDeleteTarget: StateSetter<DeleteTarget>;
  setSelectedBitmapLayerIds: StateSetter<SelectedBitmapLayerIds | undefined>;
};

export const useLayerPanelController = ({
  primarySelectedShotId,
  selectSingleShot,
  setDeleteTarget,
  setSelectedBitmapLayerIds
}: LayerPanelControllerOptions) => {
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);

  const toggleForShot = useCallback(
    (shotId: string) => {
      selectSingleShot(shotId);
      setDeleteTarget({ type: "shot" });
      setSelectedBitmapLayerIds(undefined);
      setIsLayerPanelOpen((isOpen) =>
        nextLayerPanelOpenState(isOpen, shotId, primarySelectedShotId)
      );
    },
    [primarySelectedShotId, selectSingleShot, setDeleteTarget, setSelectedBitmapLayerIds]
  );

  const layerPanelPropsForShot = useCallback(
    (shotId: string) => ({
      isLayerPanelOpen: isLayerPanelOpenForShot(isLayerPanelOpen, shotId, primarySelectedShotId),
      onToggleLayerPanel: () => toggleForShot(shotId)
    }),
    [isLayerPanelOpen, primarySelectedShotId, toggleForShot]
  );

  return {
    layerPanelPropsForShot
  };
};
