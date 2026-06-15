import { useEffect, useRef, useState } from "react";
import type { DeleteTarget } from "./deleteTarget";
import type { DragData, ParkingInsertionIndicator, StoryboardInsertionIndicator } from "./storyboardDnd";

export type SelectedBitmapLayerIds = { shotId: string; layerIds: string[] };

export type StoryboardInteractionState = {
  activeDragType: DragData["type"] | undefined;
  activeShotIds: string[];
  dragPreviewShotIds: string[];
  storyboardInsertionIndicator: StoryboardInsertionIndicator | undefined;
  parkingInsertionIndicator: ParkingInsertionIndicator | undefined;
  activeParkedShotIds: string[];
  selectedShotIds: string[];
  deleteTarget: DeleteTarget;
  selectedBitmapLayerIds: SelectedBitmapLayerIds | undefined;
};

export const initialStoryboardInteractionState = (): StoryboardInteractionState => ({
  activeDragType: undefined,
  activeShotIds: [],
  dragPreviewShotIds: [],
  storyboardInsertionIndicator: undefined,
  parkingInsertionIndicator: undefined,
  activeParkedShotIds: [],
  selectedShotIds: [],
  deleteTarget: { type: "shot" },
  selectedBitmapLayerIds: undefined
});

export const useStoryboardInteractionState = () => {
  const initialState = initialStoryboardInteractionState();
  const [activeDragType, setActiveDragType] = useState(initialState.activeDragType);
  const [activeShotIds, setActiveShotIds] = useState(initialState.activeShotIds);
  const [dragPreviewShotIds, setDragPreviewShotIds] = useState(initialState.dragPreviewShotIds);
  const [storyboardInsertionIndicator, setStoryboardInsertionIndicator] =
    useState(initialState.storyboardInsertionIndicator);
  const [parkingInsertionIndicator, setParkingInsertionIndicator] =
    useState(initialState.parkingInsertionIndicator);
  const [activeParkedShotIds, setActiveParkedShotIds] = useState(initialState.activeParkedShotIds);
  const [selectedShotIds, setSelectedShotIds] = useState(initialState.selectedShotIds);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(initialState.deleteTarget);
  const [selectedBitmapLayerIds, setSelectedBitmapLayerIds] =
    useState<SelectedBitmapLayerIds | undefined>(initialState.selectedBitmapLayerIds);
  const selectedShotIdsRef = useRef(initialState.selectedShotIds);
  const selectedBitmapLayerIdsRef = useRef<SelectedBitmapLayerIds | undefined>(
    initialState.selectedBitmapLayerIds
  );
  const deleteTargetRef = useRef(initialState.deleteTarget);
  const shotSelectionAnchorIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    selectedShotIdsRef.current = selectedShotIds;
  }, [selectedShotIds]);

  useEffect(() => {
    selectedBitmapLayerIdsRef.current = selectedBitmapLayerIds;
  }, [selectedBitmapLayerIds]);

  useEffect(() => {
    deleteTargetRef.current = deleteTarget;
  }, [deleteTarget]);

  return {
    activeDragType,
    setActiveDragType,
    activeShotIds,
    setActiveShotIds,
    dragPreviewShotIds,
    setDragPreviewShotIds,
    storyboardInsertionIndicator,
    setStoryboardInsertionIndicator,
    parkingInsertionIndicator,
    setParkingInsertionIndicator,
    activeParkedShotIds,
    setActiveParkedShotIds,
    selectedShotIds,
    setSelectedShotIds,
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
    deleteTarget,
    setDeleteTarget,
    deleteTargetRef,
    selectedBitmapLayerIds,
    setSelectedBitmapLayerIds,
    selectedBitmapLayerIdsRef
  };
};
