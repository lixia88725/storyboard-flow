import type { MutableRefObject } from "react";
import type { DeleteTarget } from "./deleteTarget";
import { nextRangeSelection, type RangeSelectionMode } from "./rangeSelection";
import type { SelectedBitmapLayerIds } from "./storyboardInteractionState";

type StateSetter<T> = (value: T) => void;

export type ShotSelectionControllerInput = {
  blurActiveFormControl: () => void;
  isEditableTarget: (target: EventTarget | null) => boolean;
  orderedShotIds: string[];
  selectedShotIdsRef: MutableRefObject<string[]>;
  shotSelectionAnchorIdRef: MutableRefObject<string | undefined>;
  setDeleteTarget: StateSetter<DeleteTarget>;
  setSelectedBitmapLayerIds: StateSetter<SelectedBitmapLayerIds | undefined>;
  setSelectedShotIds: StateSetter<string[]>;
};

export type ShotSelectEvent = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

export const createShotSelectionController = ({
  blurActiveFormControl,
  isEditableTarget,
  orderedShotIds,
  selectedShotIdsRef,
  shotSelectionAnchorIdRef,
  setDeleteTarget,
  setSelectedBitmapLayerIds,
  setSelectedShotIds
}: ShotSelectionControllerInput) => {
  const selectSingleShot = (shotId: string | undefined) => {
    shotSelectionAnchorIdRef.current = shotId;
    const nextShotIds = shotId ? [shotId] : [];
    selectedShotIdsRef.current = nextShotIds;
    setSelectedShotIds(nextShotIds);
  };

  const clearSelectedShots = () => {
    shotSelectionAnchorIdRef.current = undefined;
    selectedShotIdsRef.current = [];
    setSelectedShotIds([]);
  };

  const selectShotsByIds = (shotIds: string[]) => {
    shotSelectionAnchorIdRef.current = shotIds.at(-1);
    selectedShotIdsRef.current = shotIds;
    setSelectedShotIds(shotIds);
  };

  const selectShotWithMode = (shotId: string, mode: RangeSelectionMode) => {
    const selection = nextRangeSelection({
      orderedIds: orderedShotIds,
      selectedIds: selectedShotIdsRef.current,
      clickedId: shotId,
      anchorId: shotSelectionAnchorIdRef.current,
      mode
    });
    shotSelectionAnchorIdRef.current = selection.anchorId;
    selectedShotIdsRef.current = selection.selectedIds;
    setSelectedShotIds(selection.selectedIds);
  };

  const handleShotSelect = (shotId: string, event: ShotSelectEvent) => {
    if (!isEditableTarget(event.target)) {
      blurActiveFormControl();
    }

    setDeleteTarget({ type: "shot" });
    setSelectedBitmapLayerIds(undefined);

    if (event.shiftKey) {
      selectShotWithMode(shotId, "range");
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      selectShotWithMode(shotId, "toggle");
      return;
    }

    selectShotWithMode(shotId, "single");
  };

  return {
    clearSelectedShots,
    handleShotSelect,
    selectSingleShot,
    selectShotsByIds,
    selectShotWithMode
  };
};
