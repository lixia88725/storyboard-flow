import { describe, it, expect } from 'vitest';
import { selectShots, draggedShots, nextSelectionAnchor, pruneShotSelection, selectAllShots, toggleSelectAll } from './boardSelection';
describe('shared board selection', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('supports replace, additive toggle and anchored ranges in board order', () => {
    expect(selectShots(order, ['a'], 'a', 'c', {})).toEqual(['c']);
    expect(selectShots(order, ['c'], 'c', 'a', { metaKey: true })).toEqual(['a', 'c']);
    expect(selectShots(order, ['a','c'], 'a', 'c', { ctrlKey: true })).toEqual(['a']);
    expect(selectShots(order, ['d'], 'd', 'b', { shiftKey: true })).toEqual(['b','c','d']);
  });
  it('keeps ranges correct when the shift target sits before the anchor', () => {
    expect(selectShots(order, ['b'], 'd', 'a', { shiftKey: true })).toEqual(['a','b','c','d']);
    expect(selectShots(order, ['a','c'], 'c', 'b', { shiftKey: true })).toEqual(['b','c']);
  });
  it('unions a range with the existing selection under shift+toggle, without duplicates', () => {
    expect(selectShots(order, ['a','c'], 'b', 'd', { shiftKey: true, metaKey: true })).toEqual(['a','b','c','d']);
    expect(selectShots(order, ['a','c'], 'b', 'c', { shiftKey: true, ctrlKey: true })).toEqual(['a','b','c']);
    expect(selectShots(order, ['a','b','c','d'], 'a', 'd', {})).toEqual(['d']);
  });
  it('anchors on plain click and discrete toggle, keeps it across shift, seeds a missing one', () => {
    expect(nextSelectionAnchor(order, 'a', 'c', {})).toBe('c');
    expect(nextSelectionAnchor(order, 'a', 'd', { metaKey: true })).toBe('d');
    expect(nextSelectionAnchor(order, 'a', 'c', { shiftKey: true })).toBe('a');
    expect(nextSelectionAnchor(order, undefined, 'c', { shiftKey: true })).toBe('c');
    expect(nextSelectionAnchor(order, 'gone', 'c', { shiftKey: true })).toBe('c');
    expect(nextSelectionAnchor(order, 'a', 'gone', {})).toBe('a');
  });
  it('falls back to a plain click when shift has no live anchor, but a toggle modifier still unions', () => {
    expect(selectShots(order, ['a','c'], 'gone', 'b', { shiftKey: true })).toEqual(['b']);
    expect(selectShots(order, ['a','c'], undefined, 'b', { shiftKey: true })).toEqual(['b']);
    expect(selectShots(order, ['a','c'], undefined, 'c', { shiftKey: true, metaKey: true })).toEqual(['a','c']);
    expect(selectShots(order, ['a','c'], 'gone', 'd', { shiftKey: true, ctrlKey: true })).toEqual(['a','c','d']);
    expect(selectShots(order, ['b'], 'c', 'c', { shiftKey: true })).toEqual(['c']);
  });
  it('keeps only live ids when order or target has gone stale', () => {
    expect(selectShots([], ['a','b'], 'a', 'gone', { shiftKey: true, metaKey: true })).toEqual([]);
    expect(selectShots(order, ['a','gone'], 'gone', 'gone2', { shiftKey: true, ctrlKey: true })).toEqual(['a']);
  });
  it('filters stale identities from every path, including toggles and pruning', () => {
    expect(selectShots(order, ['a','gone'], 'a', 'gone', { metaKey: true })).toEqual(['a']);
    expect(selectShots(order, ['a','gone'], 'a', 'b', { metaKey: true })).toEqual(['a','b']);
    expect(pruneShotSelection(order, ['d','gone','a','a'])).toEqual(['a','d']);
    expect(selectShots([], [], undefined, 'a', {})).toEqual([]);
  });
  it('selects every active board and never a parked id', () => {
    const active = ['a','b','c'];
    const parked = ['p1','p2'];
    expect(selectAllShots(active)).toEqual(['a','b','c']);
    expect(selectAllShots(active).some(id => parked.includes(id))).toBe(false);
    expect(selectAllShots([])).toEqual([]);
  });
  it('toggles select-all and clear from any partial state', () => {
    expect(toggleSelectAll(order, [])).toEqual(['a','b','c','d']);
    expect(toggleSelectAll(order, ['b'])).toEqual(['a','b','c','d']);
    expect(toggleSelectAll(order, ['a','b','c','d'])).toEqual([]);
    expect(toggleSelectAll(order, ['a','gone','b','c','d'])).toEqual([]);
    expect(toggleSelectAll([], [])).toEqual([]);
  });
  it('drags the selected group or one unselected shot, ignoring deleted identities', () => {
    expect(draggedShots(order, ['c','a','deleted'], 'c')).toEqual(['a','c']);
    expect(draggedShots(order, ['c','a'], 'b')).toEqual(['b']);
    expect(draggedShots(order, ['deleted'], 'deleted')).toEqual([]);
  });
});
