/** Width and folding model for the single divider between the two dock columns.
 *
 * The divider owns both resize and folding, so the gesture is described once here and
 * the component only forwards pointer and key events. Every width is derived from the
 * dock itself, never from the last rendered grid, so a column that folds mid-drag can
 * still be unfolded by the same gesture without the handle jumping out from under it.
 */

export type DividerState = { split: number; collapsed: [boolean, boolean] };

/** Width of a folded column: the icon rail. */
export const COLLAPSED_COLUMN = 40;
export const DIVIDER_WIDTH = 5;
export const MIN_LEFT_COLUMN = 240;
export const MIN_RIGHT_COLUMN = 260;
/** The pointer must pass the minimum by this much before that column folds. */
export const FOLD_TRAVEL = 24;
/** Narrow docks share the width instead of overflowing; matches the CSS min() tracks. */
export const NARROW_SHARE = 0.4;
export const MIN_SPLIT = 25;
export const MAX_SPLIT = 75;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const availableOf = (dockWidth: number) => Math.max(0, dockWidth - DIVIDER_WIDTH);

/** Minimum width each column keeps while both are open at this dock width. */
export const columnMinimums = (dockWidth: number) => {
  const available = availableOf(dockWidth);
  return {
    left: Math.min(MIN_LEFT_COLUMN, available * NARROW_SHARE),
    right: Math.min(MIN_RIGHT_COLUMN, available * NARROW_SHARE),
  };
};

export const gridTemplate = (state: DividerState): string => {
  const [left, right] = state.collapsed;
  if (left && right) return `${COLLAPSED_COLUMN}px minmax(0,1fr) ${COLLAPSED_COLUMN}px`;
  if (left) return `${COLLAPSED_COLUMN}px ${DIVIDER_WIDTH}px minmax(0,1fr)`;
  if (right) return `minmax(0,1fr) ${DIVIDER_WIDTH}px ${COLLAPSED_COLUMN}px`;
  // min() keeps each minimum inside the dock so a narrow window never overflows.
  return `minmax(min(${MIN_LEFT_COLUMN}px, ${NARROW_SHARE * 100}%), ${state.split}fr) ${DIVIDER_WIDTH}px `
    + `minmax(min(${MIN_RIGHT_COLUMN}px, ${NARROW_SHARE * 100}%), ${100 - state.split}fr)`;
};

export type DividerDrag = {
  /** Layout to return to when the gesture is cancelled. */
  state: DividerState;
  left: number;
  right: number;
  dockWidth: number;
};

export const startDividerDrag = (state: DividerState, dockWidth: number): DividerDrag => {
  const available = availableOf(dockWidth);
  return {
    state: { split: state.split, collapsed: [state.collapsed[0], state.collapsed[1]] },
    dockWidth,
    left: state.collapsed[0] ? COLLAPSED_COLUMN : available * state.split / 100,
    right: state.collapsed[1] ? COLLAPSED_COLUMN : available * (100 - state.split) / 100,
  };
};

/** Track the pointer as a virtual column width, so folding is reversible in one gesture.
 * `previous` is the result of the last move: folding is sticky until the pointer comes
 * back to the full minimum, which gives a 24px band instead of a flapping threshold. */
export const dragDivider = (drag: DividerDrag, dx: number, previous: DividerState = drag.state): DividerState => {
  const available = availableOf(drag.dockWidth);
  const minimum = columnMinimums(drag.dockWidth);
  const collapsed: [boolean, boolean] = [previous.collapsed[0], previous.collapsed[1]];
  const left = drag.left + dx;
  const right = drag.right - dx;
  if (collapsed[0]) { if (left >= minimum.left) collapsed[0] = false; }
  else if (left <= minimum.left - FOLD_TRAVEL) collapsed[0] = true;
  if (collapsed[1]) { if (right >= minimum.right) collapsed[1] = false; }
  else if (right <= minimum.right - FOLD_TRAVEL) collapsed[1] = true;
  const split = collapsed[0] || collapsed[1]
    ? previous.split
    : available > 0
      ? clamp(left / available * 100, MIN_SPLIT, MAX_SPLIT)
      : drag.state.split;
  return { split, collapsed };
};

/** Width of the left column after folding, for the aria value. */
export const dividerValue = (state: DividerState): number =>
  state.collapsed[0] ? 0 : state.collapsed[1] ? 100 : Math.round(state.split);

export const dividerValueText = (state: DividerState): string => {
  const [left, right] = state.collapsed;
  if (left && right) return '两栏已折叠';
  if (left) return '左栏已折叠，右栏占满';
  if (right) return `左栏 ${Math.round(state.split)}%，右栏已折叠`;
  return `左栏 ${Math.round(state.split)}%，右栏 ${Math.round(100 - state.split)}%`;
};

/** Home folds the left column, End folds the right; arrows resize and also unfold. */
export const keyboardDivider = (
  state: DividerState,
  key: string,
  shiftKey: boolean,
  dockWidth: number,
): DividerState | undefined => {
  const collapsed: [boolean, boolean] = [state.collapsed[0], state.collapsed[1]];
  const step = shiftKey ? 8 : 2;
  if (key === 'Home') {
    if (collapsed[0]) return undefined;
    return { split: state.split, collapsed: [true, collapsed[1]] };
  }
  if (key === 'End') {
    if (collapsed[1]) return undefined;
    return { split: state.split, collapsed: [collapsed[0], true] };
  }
  if (key === 'ArrowLeft') {
    if (collapsed[1]) return { split: state.split, collapsed: [collapsed[0], false] };
    if (collapsed[0]) return undefined;
    return { split: clamp(state.split - step, MIN_SPLIT, MAX_SPLIT), collapsed };
  }
  if (key === 'ArrowRight') {
    if (collapsed[0]) {
      const minimum = columnMinimums(dockWidth);
      const available = availableOf(dockWidth);
      const share = available > 0 ? clamp(minimum.left / available * 100, MIN_SPLIT, MAX_SPLIT) : MIN_SPLIT;
      return { split: clamp(Math.max(state.split, share), MIN_SPLIT, MAX_SPLIT), collapsed: [false, collapsed[1]] };
    }
    if (collapsed[1]) return undefined;
    return { split: clamp(state.split + step, MIN_SPLIT, MAX_SPLIT), collapsed };
  }
  return undefined;
};
