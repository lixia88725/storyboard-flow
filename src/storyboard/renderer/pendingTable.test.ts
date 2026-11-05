import {describe,expect,it} from 'vitest';
import {draggedShots,nextSelectionAnchor,pruneShotSelection,selectShots} from './boardSelection';
import {boardMovePlan} from './workspace/boardGestures';

/**
 * Pending is the same table with the same gestures, applied to the parked order. These
 * cases pin the shared helpers the Pending cards call, so the two tables cannot drift.
 */
const parked=['p0','p1','p2','p3'];

describe('Pending table selection', () => {
  it('click replaces, meta toggles and shift takes the parked range', () => {
    expect(selectShots(parked,[],undefined,'p1',{})).toEqual(['p1']);
    expect(selectShots(parked,['p1'],'p1','p3',{metaKey:true})).toEqual(['p1','p3']);
    expect(selectShots(parked,['p1','p3'],'p1','p3',{metaKey:true})).toEqual(['p1']);
    expect(selectShots(parked,['p0','p1'],'p1','p3',{shiftKey:true})).toEqual(['p1','p2','p3']);
  });

  it('keeps the anchor while shift only widens, and drops vanished ids', () => {
    expect(nextSelectionAnchor(parked,undefined,'p1',{})).toBe('p1');
    expect(nextSelectionAnchor(parked,'p0','p2',{shiftKey:true})).toBe('p0');
    expect(pruneShotSelection(parked,['p1','gone','p3'])).toEqual(['p1','p3']);
  });

  it('drags the whole Pending selection only when the pressed card is part of it', () => {
    expect(draggedShots(parked,['p0','p2'],'p2')).toEqual(['p0','p2']);
    expect(draggedShots(parked,['p0','p2'],'p3')).toEqual(['p3']);
  });
});

describe('Pending table insertion', () => {
  it('plans a slot inside Pending by the anchor the pointer is over', () => {
    expect(boardMovePlan(parked,['p3'],0)).toEqual({beforeId:'p0',changed:true,order:['p3','p0','p1','p2']});
    expect(boardMovePlan(parked,['p0'],4)).toEqual({beforeId:undefined,changed:true,order:['p1','p2','p3','p0']});
  });

  it('reports no change when the group lands where it already is', () => {
    expect(boardMovePlan(parked,['p1'],1).changed).toBe(false);
  });

  it('plans a move out of Pending into a board slot', () => {
    expect(boardMovePlan(['a','b'],['p0'],1)).toEqual({beforeId:'b',changed:true,order:['a','p0','b']});
    expect(boardMovePlan([],['p0'],0)).toEqual({beforeId:undefined,changed:true,order:['p0']});
  });
});
