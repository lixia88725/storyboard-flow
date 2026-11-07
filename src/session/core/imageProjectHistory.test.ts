import { expect, it } from 'vitest';
import type { ImageProjectEdit, ProjectV2 } from '../../platform/contracts/imageProject';
import { createSnapshotHistory } from './snapshotHistory';
import { applyImageProjectEdit, validImageProject } from './imageProjectModel';

export const projectFixture=():ProjectV2=>({schema:'storyboard-flow.project',version:2,id:'project',revision:0,name:'Synthetic',shots:[{id:'a',imageId:'ia',name:'A',scriptText:''},{id:'b',imageId:'ib',name:'B',scriptText:''}],parkedShots:[],dialogues:[],images:{ia:{id:'ia',content:{kind:'source',source:{importId:'batch',itemId:'a',interpretationId:'reader1'}}},ib:{id:'ib',content:{kind:'source',source:{importId:'batch',itemId:'b',interpretationId:'reader1'}}}}});
const required=<T>(r:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const history=(now=()=>0)=>required(createSnapshotHistory<ProjectV2,ImageProjectEdit>(projectFixture(),{maxEntries:60,group:{now,windowMs:800}},{valid:validImageProject,reduce:applyImageProjectEdit}));
const native={storeId:'native',documentId:'doc',versionId:'a'.repeat(64),manifestSha256:'b'.repeat(64),width:64,height:64};

it('prepares without changing either stack and rejects used, foreign and stale plans',()=>{
  const h=history(),a=required(h.prepare({kind:'setScriptText',shotId:'a',text:'one'})),b=required(h.prepare({kind:'setScriptText',shotId:'a',text:'two'}));
  expect(required(h.current()).shots[0].scriptText).toBe('');expect(h.undoDepth()).toBe(0);
  a.result.after.shots[0].scriptText='forged public plan';
  expect(required(h.commit(a)).after.shots[0].scriptText).toBe('one');
  expect(h.commit(a)).toMatchObject({ok:false,error:{code:'conflict'}});expect(h.commit(b)).toMatchObject({ok:false,error:{code:'conflict'}});
  expect(history().commit(required(h.prepareUndo()))).toMatchObject({ok:false,error:{code:'conflict'}});
});

it('has one native-image/dialogue/Pending undo sequence and monotonic project revisions',()=>{
  const h=history();
  const apply=(edit:ImageProjectEdit)=>required(h.commit(required(h.prepare(edit))));
  apply({kind:'installNativeImage',imageId:'ia',expected:projectFixture().images.ia.content,next:native});
  apply({kind:'setDialogues',shotId:'a',dialogues:[{id:'line',shotId:'a',text:'hello'}]});
  apply({kind:'moveShots',shotIds:['a'],destination:'pending'});
  expect(h.undoDepth()).toBe(3);expect(required(h.current()).revision).toBe(3);
  required(h.commit(required(h.prepareUndo())));expect(required(h.current()).parkedShots).toEqual([]);
  required(h.commit(required(h.prepareUndo())));expect(required(h.current()).dialogues).toEqual([]);
  required(h.commit(required(h.prepareUndo())));expect(required(h.current()).images.ia.content.kind).toBe('source');
  expect(required(h.current()).revision).toBe(6);
  for(let n=0;n<3;n++)required(h.commit(required(h.prepareRedo())));
  expect(required(h.current())).toMatchObject({revision:9,images:{ia:{content:{kind:'native',native}}},parkedShots:[{id:'a'}]});
});

it('keeps typing grouping in the shared history algorithm and never folds over an image step',()=>{
  let time=0;const h=history(()=>time);
  const type=(text:string)=>required(h.commit(required(h.prepare({kind:'setDialogues',shotId:'a',dialogues:[{id:'line',shotId:'a',text}]},{group:'typing'}))));
  type('h');time=20;type('he');expect(h.undoDepth()).toBe(1);
  required(h.commit(required(h.prepare({kind:'installNativeImage',imageId:'ia',expected:projectFixture().images.ia.content,next:native}))));
  time=30;type('hello');expect(h.undoDepth()).toBe(3);
  required(h.commit(required(h.prepareUndo())));expect(required(h.current()).dialogues[0].text).toBe('he');
});

it('refuses a false image baseline and validates V2 without accepting PNG layer projects',()=>{
  const h=history();expect(h.prepare({kind:'installNativeImage',imageId:'ia',expected:{kind:'native',native},next:native})).toMatchObject({ok:false,error:{code:'conflict'}});
  const p=projectFixture();expect(validImageProject({...p,version:1})).toBe(false);
  expect(validImageProject({...p,images:{...p.images,ia:{id:'ia',layers:[]}}})).toBe(false);
});
