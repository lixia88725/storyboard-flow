import {describe,it,expect} from 'vitest';
import {resizeDockPair} from './DockResizeHandle';
describe('adjacent dock panel sizing',()=>{
 it('keeps the total and clamps either panel at its minimum',()=>{
  expect(resizeDockPair(300,200,40)).toEqual([340,160]);
  expect(resizeDockPair(300,200,1000)).toEqual([400,100]);
  expect(resizeDockPair(300,200,-1000)).toEqual([100,400]);
 });
 it('keeps compressed pairs in the available viewport',()=>{
  expect(resizeDockPair(80,80,100)).toEqual([80,80]);
 });
});
