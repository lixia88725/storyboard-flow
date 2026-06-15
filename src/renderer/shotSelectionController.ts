import type { MutableRefObject } from "react";
import { nextRangeSelection, type RangeSelectionMode } from "./rangeSelection";

type StateSetter<T> = (value: T) => void;

export type ShotSelectionControllerInput = {
  orderedShotIds: string[];
  selectedShotIdsRef: MutableRefObject<string[]>;
  shotSelectionAnchorIdRef: MutableRefObject<string | undefined>;
  setSelectedShotIds: StateSetter<string[]>;
};

export const createShotSelectionController = ({
  orderedShotIds,
  selectedShotIdsRef,
  shotSelectionAnchorIdRef,
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

  return {
    clearSelectedShots,
    selectSingleShot,
    selectShotsByIds,
    selectShotWithMode
  };
};
