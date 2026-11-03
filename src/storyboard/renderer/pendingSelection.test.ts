import { describe, expect, it } from 'vitest';
import { prunePendingSelection, stalePendingIds, togglePendingSelection } from './pendingSelection';

const order = ['p1', 'p2', 'p3'];
describe('pending shelf selection', () => {
  it('toggles one Pending shot and keeps shelf order regardless of click order', () => {
    expect(togglePendingSelection(order, [], 'p2')).toEqual(['p2']);
    expect(togglePendingSelection(order, ['p2'], 'p1')).toEqual(['p1', 'p2']);
    expect(togglePendingSelection(order, ['p1', 'p2'], 'p1')).toEqual(['p2']);
    expect(togglePendingSelection(order, ['p2'], 'p2')).toEqual([]);
  });

  it('never adopts an ID outside the shelf, so active shots cannot join Pending deletion', () => {
    expect(togglePendingSelection(order, ['p1'], 'active-shot')).toEqual(['p1']);
    expect(togglePendingSelection(order, [], 'p9')).toEqual([]);
  });

  it('drops selections whose Pending shot vanished through delete, restore, drag or undo', () => {
    expect(prunePendingSelection(['p2'], ['p1', 'p2'])).toEqual(['p2']);
    expect(prunePendingSelection([], ['p1'])).toEqual([]);
    expect(prunePendingSelection(order, ['p3', 'p1'])).toEqual(['p1', 'p3']);
    // Duplicate-free and stable: the same input always yields the same action list.
    expect(prunePendingSelection(order, ['p2', 'p2'])).toEqual(['p2']);
  });

  it('rejects the whole batch when any selected ID is no longer parked in the latest project', () => {
    expect(stalePendingIds(order, ['p1', 'p3'])).toEqual([]);
    // p1 returned to the active board (or was removed) after the checkbox was ticked.
    expect(stalePendingIds(['p2', 'p3'], ['p1', 'p2'])).toEqual(['p1']);
    expect(stalePendingIds([], ['p1'])).toEqual(['p1']);
    expect(stalePendingIds(['p2'], ['p2', 'gone'])).toEqual(['gone']);
  });
});
