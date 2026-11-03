/**
 * Pending-shelf selection only. The active board owns its own selection; a Pending
 * checkbox never joins it, so delete always states the exact Pending removal count.
 */
export function togglePendingSelection(order: readonly string[], selected: readonly string[], id: string): string[] {
  if (!order.includes(id)) return prunePendingSelection(order, selected);
  const set = new Set(selected);
  if (set.has(id)) set.delete(id); else set.add(id);
  return order.filter(candidate => set.has(candidate));
}

/** Delete, Restore, drag and Undo can all remove a parked shot; drop those IDs. */
export function prunePendingSelection(order: readonly string[], selected: readonly string[]): string[] {
  return order.filter(id => selected.includes(id));
}

/** IDs no longer parked in the latest project. Any result must reject the whole batch. */
export function stalePendingIds(order: readonly string[], shotIds: readonly string[]): string[] {
  const live = new Set(order);
  return shotIds.filter(id => !live.has(id));
}

/**
 * Pending deletion is decided from one Session snapshot: a queued command could still be a
 * Restore, so any live pending work refuses the batch before membership is even consulted.
 */
export type PendingDeleteDecision = 'empty' | 'busy' | 'stale' | 'delete';
export function pendingDeleteDecision(state: { pending: number; parked: readonly string[] }, shotIds: readonly string[]): PendingDeleteDecision {
  if (!shotIds.length) return 'empty';
  if (state.pending !== 0) return 'busy';
  return stalePendingIds(state.parked, shotIds).length ? 'stale' : 'delete';
}
