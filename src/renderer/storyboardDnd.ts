export type DragData =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "drop-zone"; shotId: string }
  | { type: "parking-zone" }
  | { type: "parked-shot"; shotId: string };

export const dragPreviewShotIds = ({
  activeShotId,
  selectedShotIds,
  orderedShotIds,
  isCopyDrag
}: {
  activeShotId: string;
  selectedShotIds: string[];
  orderedShotIds: string[];
  isCopyDrag: boolean;
}): string[] => {
  if (isCopyDrag || !selectedShotIds.includes(activeShotId)) {
    return [activeShotId];
  }

  const selected = new Set(selectedShotIds);
  return orderedShotIds.filter((shotId) => selected.has(shotId));
};
