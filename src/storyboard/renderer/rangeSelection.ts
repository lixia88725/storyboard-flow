export type RangeSelectionMode = "single" | "toggle" | "range";

export type RangeSelectionInput = {
  orderedIds: string[];
  selectedIds: string[];
  clickedId: string;
  anchorId?: string;
  mode: RangeSelectionMode;
};

export type RangeSelectionResult = {
  selectedIds: string[];
  anchorId?: string;
};

const orderSelectedIds = (orderedIds: string[], selectedIds: string[]): string[] => {
  const selected = new Set(selectedIds);
  return orderedIds.filter((id) => selected.has(id));
};

export const nextRangeSelection = ({
  orderedIds,
  selectedIds,
  clickedId,
  anchorId,
  mode
}: RangeSelectionInput): RangeSelectionResult => {
  if (!orderedIds.includes(clickedId)) {
    return { selectedIds, anchorId };
  }

  if (mode === "single") {
    return { selectedIds: [clickedId], anchorId: clickedId };
  }

  if (mode === "toggle") {
    const selected = new Set(selectedIds);
    if (selected.has(clickedId)) {
      selected.delete(clickedId);
      const nextSelectedIds = orderSelectedIds(orderedIds, [...selected]);
      return { selectedIds: nextSelectedIds, anchorId: clickedId };
    }

    selected.add(clickedId);
    return { selectedIds: orderSelectedIds(orderedIds, [...selected]), anchorId: clickedId };
  }

  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
  const clickedIndex = orderedIds.indexOf(clickedId);
  if (anchorIndex === -1) {
    return { selectedIds: [clickedId], anchorId: clickedId };
  }

  const startIndex = Math.min(anchorIndex, clickedIndex);
  const endIndex = Math.max(anchorIndex, clickedIndex);
  return {
    selectedIds: orderedIds.slice(startIndex, endIndex + 1),
    anchorId
  };
};
