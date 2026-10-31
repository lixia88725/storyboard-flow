import { describe, expect, it } from 'vitest';
import { reconcileExternalImage } from './flowImageReconciliation';
import type { ImageDocumentV1, LayerV1 } from '../shared/refactorV1';
const layer=(id:string,byte='a'):LayerV1=>({id,name:id,kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:4,height:4,assetId:byte.repeat(64)});
const base=():ImageDocumentV1=>({id:'image',revision:0,width:4,height:4,layers:[layer('base'),layer('exported-arrow')]});
const copies=()=>{const b=base();return {b,l:structuredClone(b),e:structuredClone(b)};};
describe('external image reconciliation policy',()=>{
 it('adopts clean external pixels and ignores revision counters',()=>{
  const {b,l,e}=copies();l.revision=42;e.revision=93;e.layers[0].assetId='b'.repeat(64);
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace'){expect(plan.image.revision).toBe(43);expect(plan.image.layers).toEqual(e.layers);}
 });
 it('retains a new local drawing exactly once while external base changes',()=>{
  const {b,l,e}=copies();l.layers.push(layer('new-local','c'));e.layers[0].assetId='b'.repeat(64);
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace')expect(plan.image.layers).toEqual([e.layers[0],b.layers[1],l.layers[2]]);
  expect(b).toEqual(base());expect(l.layers[0]).toEqual(b.layers[0]);
 });
 it('updates an exported Flow layer without adding another copy',()=>{
  const {b,l,e}=copies();e.layers[1].assetId='d'.repeat(64);
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace'){expect(plan.image.layers).toHaveLength(2);expect(plan.image.layers[1]).toEqual(e.layers[1]);}
 });
 it('combines independent changes to different identified layers',()=>{
  const {b,l,e}=copies();l.layers[1].assetId='c'.repeat(64);e.layers[0].assetId='d'.repeat(64);
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace')expect(plan.image.layers).toEqual([e.layers[0],l.layers[1]]);
 });
 it('keeps identical edits without duplicating history or output',()=>{
  const {b,l,e}=copies();l.layers[0].assetId=e.layers[0].assetId='c'.repeat(64);
  expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'unchanged'});
 });
 it('keeps local edits when the external image is semantically unchanged',()=>{
  const {b,l,e}=copies();l.layers[0].name='local name';e.revision=100;
  expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'unchanged'});
 });
 it('refuses different edits to the same layer and delete-versus-edit',()=>{
  const {b,l,e}=copies();l.layers[0].assetId='c'.repeat(64);e.layers[0].assetId='d'.repeat(64);
  expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'conflict',reason:'layer'});
  l.layers.shift();expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'conflict',reason:'layer'});
 });
 it('preserves a local layer deletion while another external layer changes',()=>{
  const {b,l,e}=copies();l.layers.pop();e.layers[0].assetId='d'.repeat(64);
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace')expect(plan.image.layers).toEqual([e.layers[0]]);
 });
 it('uses identified external order, not stale metadata array positions',()=>{
  const {b,l,e}=copies();e.layers.reverse();
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace')expect(plan.image.layers.map(l=>l.id)).toEqual(['exported-arrow','base']);
 });
 it('refuses ambiguous order changes instead of guessing layer placement',()=>{
  const {b,l,e}=copies();l.layers.push(layer('local'));e.layers.reverse();
  expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'conflict',reason:'order'});
 });
 it('refuses unknown identity even when names, counts or pixels match',()=>{
  const {b,l,e}=copies();expect(reconcileExternalImage(b,l,e,false)).toEqual({kind:'conflict',reason:'identity'});
  e.layers[1].id=e.layers[0].id;expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'conflict',reason:'identity'});
 });
 it('does not guess alignment after canvas resize alongside local drawing',()=>{
  const {b,l,e}=copies();l.layers.push(layer('local'));e.width=8;e.layers.forEach(l=>l.width=8);
  expect(reconcileExternalImage(b,l,e,true)).toEqual({kind:'conflict',reason:'canvas'});
 });
 it('allows clean canvas resize with matching layer dimensions',()=>{
  const {b,l,e}=copies();e.width=8;e.layers.forEach(l=>l.width=8);
  const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
  if(plan.kind==='replace')expect(plan.image.width).toBe(8);
 });
});
