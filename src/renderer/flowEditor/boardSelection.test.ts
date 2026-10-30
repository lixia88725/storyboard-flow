import { describe, it, expect } from 'vitest';
import { selectShots, draggedShots } from './boardSelection';
describe('shared board selection', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('supports replace, additive toggle and anchored ranges in board order', () => {
    expect(selectShots(order, ['a'], 'a', 'c', {})).toEqual(['c']);
    expect(selectShots(order, ['c'], 'c', 'a', { metaKey: true })).toEqual(['a', 'c']);
    expect(selectShots(order, ['a','c'], 'a', 'c', { ctrlKey: true })).toEqual(['a']);
    expect(selectShots(order, ['d'], 'd', 'b', { shiftKey: true })).toEqual(['b','c','d']);
  });
  it('drags the selected group or one unselected shot, ignoring deleted identities', () => {
    expect(draggedShots(order, ['c','a','deleted'], 'c')).toEqual(['a','c']);
    expect(draggedShots(order, ['c','a'], 'b')).toEqual(['b']);
    expect(draggedShots(order, ['deleted'], 'deleted')).toEqual([]);
  });
});
