import { describe, it, expect } from 'vitest';
import { createWorkspaceSlots, type WorkspaceSlot } from './workspaceSlots';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { createProject } from '../shared/projectOps';
import { cancelledBeforeEffect } from './assetIntentAdmission';

const deferred = () => { let resolve!:()=>void; const promise=new Promise<void>(r=>resolve=r); return {promise,resolve}; };
const fixture = () => {
  const queue=createBitmapLayerWriteQueue(), persists:{root:string;name:string}[]=[], publications:string[]=[], readers:string[]=[];
  let failCert=false;
  const historyProject=createProject('History A');
  const slots=createWorkspaceSlots({initialProject:createProject('Untitled'),publishProject:p=>publications.push(p.name),
    observe:async path=>({binding:path.replace('/aliasA','/A'),folderPath:path.replace('/aliasA','/A'),metadataPath:path.replace('/aliasA','/A')+'/project.json'}),
    captureView:()=>({history:{undo:[{project:historyProject,layerAssets:[{dataUrl:'exact-history-bytes'}]}],redo:[]},selectedShotIds:['held'],dirtyShotIds:['held']}),
    // Explicit synthetic retention IO, NOT a Root output/persistence ACK.
    certifyHandoff:async()=>!failCert,drain:()=>queue.drain(),publishActive:()=>{},
    adapterPorts:()=>({queue,freshToken:()=> 'token',api:()=>({readOutputIdentity:async()=> '0'.repeat(64),
      autosaveWorkspace:async p=>{persists.push({root:p.folderPath,name:p.project.name});},
      saveWorkspace:async()=>({ok:false,error:{code:'SAVE_RECOVERY_INCOMPLETE',message:'unknown original A',recoveryIncomplete:true,publicationOrCleanup:'started',metadata:'unknown',retainedPaths:['original-backup']}} as any)}),onSave:()=>{},onError:()=>{}})});
  const open=(name:string)=>slots.requestOpen('/'+name,async(slot,root)=>{
    readers.push(name);let scan:any;
    const project=name==='A'?{...createProject(name),shots:[{id:'s',imagePath:'/A/a.tiff',fileName:'a.tiff',order:0}],pendingBake:{version:1 as const,shots:{s:{state:'synced' as const,acceptedOutputIdentity:'0'.repeat(64)}}}}:createProject(name);
    const loaded=await slot.adapter.load(async()=>({folderPath:root.folderPath,metadataPath:root.metadataPath,folderName:name,images:[],project}),s=>{scan=s;});
    return loaded?scan:undefined;
  });
  return {slots,queue,persists,publications,readers,open,setFailCert:(b:boolean)=>{failCert=b;}};
};
describe('slot-owned actual Owner/Adapter composition',()=>{
 it('pure staging reader busy is not hidden recovery, while failed staging stays protected',async()=>{
   const f=fixture(),started=deferred(),gate=deferred();
   const opening=f.slots.requestOpen('/fresh',async(slot,root)=>{
     let scan:any; const result=await slot.adapter.load(async()=>{started.resolve();await gate.promise;return {folderPath:root.folderPath,metadataPath:root.metadataPath,folderName:'fresh',images:[],project:createProject('fresh')};},s=>{scan=s;});
     return result?scan:undefined;
   });
   await started.promise;expect(f.queue.isBusy?.()).toBe(true);
   expect(f.slots.hasHiddenWork()).toBe(true);
   expect((f.slots as any).hasHiddenRecovery()).toBe(false);
   gate.resolve();await opening;
   await expect(f.slots.requestOpen('/failed',async()=>{throw Error('failed source');})).rejects.toThrow('failed source');
   expect((f.slots as any).hasHiddenRecovery()).toBe(true);
 });
 it('all-slot Close freezes outside the queue, revokes scopes and compares a fresh whole second capture',async()=>{
   const f=fixture();await f.open('A');const a=f.slots.active;await a.adapter.save();await f.open('B');
   const scope=f.slots.captureScope(),slots=f.slots as any;
   expect(typeof slots.freezeForClose).toBe('function');
   const first=await slots.freezeForClose();expect(scope()).toBe(false);
   expect(first.slots.map((s:any)=>s.folderPath)).toEqual(['/A','/B']);
   expect(first.slots[0].content.effectFacts.unsettled).toBe(true);
   expect(await slots.freezeForClose()).toEqual(first);
   await expect(f.open('C')).rejects.toThrow('Close');expect(f.readers).toEqual(['A','B']);
   slots.cancelClose();expect(f.slots.active.lifecycle).toBe('active');expect(scope()).toBe(false);
 });
 it('failed A stays throw-only while an independent B reader/edit/persistence completes; alias A never reads disk',async()=>{
   const f=fixture();await f.open('A');const a=f.slots.active;
   expect(await a.adapter.save()).toBe(false);
   const before=a.adapter.owner.captureRecoveryContent(),epoch=a.adapter.owner.capture().epoch;
   expect(before.effectFacts.unsettled).toBe(true);
   expect(await f.open('B')).toBe(true);const b=f.slots.active;
   expect(b).not.toBe(a);expect(b.projectRef).not.toBe(a.projectRef);
   expect(f.readers).toEqual(['A','B']);expect(a.adapter.owner.capture().epoch).toBe(epoch);
   expect(a.adapter.owner.captureRecoveryContent()).toEqual(before);
   expect(b.adapter.owner.publishEdit(p=>({...p,name:'B edited'}),[])).toBe(true);
   expect(await b.adapter.autosave(b.projectRef.current)).toBe(true);
   expect(f.persists).toEqual([{root:'/B',name:'B edited'}]);
   const publicationCount=f.publications.length;
   expect(a.adapter.owner.publishEdit(p=>({...p,name:'stale A'}),[])).toBe(false);
   expect(f.publications.length).toBe(publicationCount);
   expect(await f.open('aliasA')).toBe(true);expect(f.slots.active).toBe(a);
   expect(f.readers).toEqual(['A','B']);expect(a.readonly).toBe(true);expect(a.adapter.owner.captureRecoveryContent()).toEqual(before);
   // Ordinary A load still cannot bypass the exact failed original settle.
   let badReader=0;expect(await a.adapter.load(async()=>{badReader++;throw Error('must not read');},()=>{})).toBe(false);expect(badReader).toBe(0);
   await f.queue.drain();
 });
 it('revokes before-effect closures with explicit result, retains A bytes, and never borrows B persist or replays ABA',async()=>{
   const f=fixture();await f.open('A');const a=f.slots.active,scope=f.slots.captureScope(a),started=deferred(),gate=deferred();let effects=0;
   const pending=f.slots.submitAssetIntent(a,'held-paint',new Uint8Array([1,2,3]),async()=>{started.resolve();await gate.promise;if(!scope())return cancelledBeforeEffect;effects++;return undefined;});
   await started.promise;const opening=f.open('B');await Promise.resolve();await Promise.resolve();gate.resolve();
   expect(await pending).toEqual(cancelledBeforeEffect);await opening;
   expect(effects).toBe(0);expect(f.persists).toEqual([]);
   expect(a.adapter.owner.captureRecoveryContent().retainedAssetIntents).toEqual([{workspace:'/A',assetId:'held-paint',desiredBytes:new Uint8Array([1,2,3]),state:'cancelled-before-effect'}]);
   await f.open('aliasA');expect(scope()).toBe(false);expect(effects).toBe(0);
   await f.queue.drain();
 });
 it('already-effect producer drains its original fixed Root persistence before publishing B',async()=>{
   const f=fixture();await f.open('A');const a=f.slots.active,started=deferred(),gate=deferred();
   const pending=f.slots.submitAssetIntent(a,'effect',new Uint8Array([4]),async()=>{started.resolve();await gate.promise;return 'effect-done';});
   await started.promise;const opening=f.open('B');await Promise.resolve();await Promise.resolve();expect(f.readers).toEqual(['A']);gate.resolve();
   expect(await pending).toBe('effect-done');await opening;
   expect(f.persists).toEqual([{root:'/A',name:'A'}]);expect(f.slots.active.projectRef.current.name).toBe('B');
   expect(a.adapter.owner.captureRecoveryContent().retainedAssetIntents).toEqual([]);await f.queue.drain();
 });
 it('failed retention has B reader zero and failed B staging never half-publishes A',async()=>{
   const f=fixture();await f.open('A');const a=f.slots.active;f.setFailCert(true);
   await expect(f.open('B')).rejects.toThrow('not certified');expect(f.slots.active).toBe(a);expect(f.readers).toEqual(['A']);
   f.setFailCert(false);await expect(f.slots.requestOpen('/B',async slot=>{slot.adapter.owner.publishEdit(p=>({...p,name:'staged B'}),[]);throw Error('init failed');})).rejects.toThrow('init failed');
   expect(f.slots.active).toBe(a);expect(a.projectRef.current.name).toBe('A');expect(f.slots.wholeCapture().slots.map(s=>s.lifecycle)).toContain('failed-staging');await f.queue.drain();
 });
});
