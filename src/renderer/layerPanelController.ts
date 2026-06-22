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

export const layerSelectionForPanelState = ({
  availableLayerIds,
  hasShot,
  isOpen,
  selectedLayerIds
}: {
  availableLayerIds: string[];
  hasShot: boolean;
  isOpen: boolean;
  selectedLayerIds: string[];
}): string[] => {
  if (!hasShot || !isOpen) {
    return selectedLayerIds.length === 0 ? selectedLayerIds : [];
  }

  const existingLayerIds = new Set(availableLayerIds);
  const nextLayerIds = selectedLayerIds.filter((layerId) => existingLayerIds.has(layerId));
  return nextLayerIds.length === selectedLayerIds.length ? selectedLayerIds : nextLayerIds;
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
