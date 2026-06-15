import { useEffect } from "react";
import { getNextStoryboardIndex } from "../shared/projectOps";

export type KeyboardSelectionDirection = "left" | "right" | "up" | "down";

export type KeyboardShotSelectionInput = {
  currentSelectedIds: string[];
  direction: KeyboardSelectionDirection;
  gridColumns: number;
  isAnimationMode: boolean;
  orderedShotIds: string[];
};

export type KeyboardShotSelection = {
  anchorId: string | undefined;
  selectedIds: string[];
};

export const nextKeyboardShotSelection = ({
  currentSelectedIds,
  direction,
  gridColumns,
  isAnimationMode,
  orderedShotIds
}: KeyboardShotSelectionInput): KeyboardShotSelection => {
  if (orderedShotIds.length === 0) {
    return { anchorId: undefined, selectedIds: [] };
  }

  const currentIndex = currentSelectedIds[0] ? orderedShotIds.indexOf(currentSelectedIds[0]) : -1;
  const nextIndex = getNextStoryboardIndex(
    currentIndex,
    orderedShotIds.length,
    gridColumns,
    direction,
    isAnimationMode
  );
  const nextShotId = orderedShotIds[nextIndex];
  return { anchorId: nextShotId, selectedIds: [nextShotId] };
};

type GlobalKeyboardTarget = {
  addEventListener: (type: "keydown", listener: (event: KeyboardEvent) => void) => void;
  removeEventListener: (type: "keydown", listener: (event: KeyboardEvent) => void) => void;
};

export const registerGlobalKeyboardListener = (
  target: GlobalKeyboardTarget,
  handleKeyDown: (event: KeyboardEvent) => void
): (() => void) => {
  target.addEventListener("keydown", handleKeyDown);
  return () => target.removeEventListener("keydown", handleKeyDown);
};

export const useGlobalKeyboardController = (
  handleKeyDown: (event: KeyboardEvent) => void
): void => {
  useEffect(() => registerGlobalKeyboardListener(window, handleKeyDown), [handleKeyDown]);
};
