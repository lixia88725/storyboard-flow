import {describe,it,expect} from 'vitest';
import {selectionBox,marqueeIds,boardInsertion,boardMovePlan} from './boardGestures';
const rects=['a','b','c','d'].map((id,i)=>({id,left:(i%2)*120,top:Math.floor(i/2)*100,width:100,height:80}));
describe('stationary storyboard gestures',()=>{
 it('selects partial intersections in either drawing direction',()=>{
  const box=selectionBox({x:215,y:150},{x:180,y:10});
  expect(marqueeIds(rects,box,[],'replace')).toEqual(['b','d']);
  expect(marqueeIds(rects,{left:100,top:0,width:20,height:80},[],'replace')).toEqual([]);
 });
 it('adds or toggles against the starting selection, not against each intermediate frame',()=>{
  const box={left:150,top:10,width:40,height:30};
  expect(marqueeIds(rects,box,['a','b'],'add')).toEqual(['a','b']);
  expect(marqueeIds(rects,box,['a','b'],'toggle')).toEqual(['a']);
 });
 it('finds before/after and row-boundary slots without moving any cards',()=>{
  expect(boardInsertion(rects,{x:130,y:30})?.index).toBe(1);
  expect(boardInsertion(rects,{x:210,y:30})?.index).toBe(2);
  expect(boardInsertion(rects,{x:5,y:120})?.index).toBe(2);
  expect(boardInsertion(rects,{x:10,y:220})?.index).toBe(4);
  expect(boardInsertion(rects,{x:210,y:-20})?.index).toBe(0);
 });
 it('uses a horizontal insertion line for single-column and Japanese rows',()=>{
  const rows=rects.filter(r=>r.id==='a'||r.id==='c');
  expect(boardInsertion(rows,{x:10,y:75})).toEqual({index:1,line:{left:0,top:78,width:100,height:3}});
  expect(boardInsertion([],{x:0,y:0})).toBeUndefined();
 });
 it('moves non-contiguous selections as one ordered group and never targets a moving ID',()=>{
  expect(boardMovePlan(['a','b','c','d'],['a','c'],3)).toEqual({beforeId:'d',changed:true,order:['b','a','c','d']});
  expect(boardMovePlan(['a','b','c','d'],['b','d'],0).order).toEqual(['b','d','a','c']);
 });
 it('recognizes no-op slots through and beside a contiguous selection',()=>{
  for(const slot of [1,2,3])expect(boardMovePlan(['a','b','c','d'],['b','c'],slot).changed).toBe(false);
 });
 it('supports the end, an empty destination and Pending-to-active insertion',()=>{
  expect(boardMovePlan(['a','b','c'],['a'],3)).toEqual({beforeId:undefined,changed:true,order:['b','c','a']});
  expect(boardMovePlan([],['p'],0).order).toEqual(['p']);
  expect(boardMovePlan(['a','b'],['p'],1).order).toEqual(['a','p','b']);
 });
});
