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

type GlobalKeyboardEventType = "keydown" | "keyup";

type GlobalKeyboardTarget = {
  addEventListener: (type: GlobalKeyboardEventType, listener: (event: KeyboardEvent) => void) => void;
  removeEventListener: (type: GlobalKeyboardEventType, listener: (event: KeyboardEvent) => void) => void;
};

export const registerGlobalKeyboardListener = (
  target: GlobalKeyboardTarget,
  handleKeyDown: (event: KeyboardEvent) => void,
  handleKeyUp?: (event: KeyboardEvent) => void
): (() => void) => {
  target.addEventListener("keydown", handleKeyDown);
  if (handleKeyUp) {
    target.addEventListener("keyup", handleKeyUp);
  }
  return () => {
    target.removeEventListener("keydown", handleKeyDown);
    if (handleKeyUp) {
      target.removeEventListener("keyup", handleKeyUp);
    }
  };
};

export const useGlobalKeyboardController = (
  handleKeyDown: (event: KeyboardEvent) => void,
  handleKeyUp?: (event: KeyboardEvent) => void
): void => {
  useEffect(
    () => registerGlobalKeyboardListener(window, handleKeyDown, handleKeyUp),
    [handleKeyDown, handleKeyUp]
  );
};
