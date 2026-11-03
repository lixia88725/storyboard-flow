/** UI-only selection; project membership/order always comes from Session. */
export type ShotModifiers = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

/** Live ids in board order; stale identities and duplicates never survive. */
export function pruneShotSelection(order: readonly string[], selected: readonly string[]): string[] {
  const set = new Set(selected);
  return order.filter(id => set.has(id));
}
const anchored = (order: readonly string[], anchor: string | undefined) => anchor !== undefined && order.includes(anchor);

export function selectShots(order: readonly string[], selected: readonly string[], anchor: string | undefined, id: string,
  modifiers: ShotModifiers): string[] {
  if (!order.includes(id)) return pruneShotSelection(order, selected);
  if (modifiers.shiftKey) {
    // A missing or stale anchor degenerates to the target itself; with a toggle modifier that
    // still unions instead of silently cancelling the clicked board.
    const a = anchored(order, anchor) ? order.indexOf(anchor!) : order.indexOf(id), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    // Shift alone replaces with the range; adding a toggle modifier unions it with the old selection.
    if (modifiers.metaKey || modifiers.ctrlKey) return pruneShotSelection(order, [...selected, ...range]);
    return range;
  }
  if (modifiers.metaKey || modifiers.ctrlKey) {
    const set = new Set(pruneShotSelection(order, selected));
    if (set.has(id)) set.delete(id); else set.add(id);
    return order.filter(s => set.has(s));
  }
  return [id];
}

/** Shift never moves an existing anchor; it only seeds one when none is live yet. */
export function nextSelectionAnchor(order: readonly string[], anchor: string | undefined, id: string,
  modifiers: ShotModifiers): string | undefined {
  const kept = anchored(order, anchor) ? anchor : undefined;
  if (!order.includes(id)) return kept;
  if (modifiers.shiftKey) return kept ?? id;
  return id;
}

/** Every live board, never Pending: the caller passes active ids only. */
export function selectAllShots(order: readonly string[]): string[] {
  return pruneShotSelection(order, order);
}

/** Toolbar 全选/取消: a complete selection clears, anything else becomes complete. */
export function toggleSelectAll(order: readonly string[], selected: readonly string[]): string[] {
  const all = selectAllShots(order);
  return pruneShotSelection(order, selected).length === all.length ? [] : all;
}
export function draggedShots(order: readonly string[], selected: readonly string[], dragged: string): string[] {
  return selected.includes(dragged) ? order.filter(id => selected.includes(id)) : order.filter(id => id === dragged);
}
