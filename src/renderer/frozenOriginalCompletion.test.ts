import {test,expect} from 'vitest';
import {createWorkspaceSlots} from './workspaceSlots';
import {createProject} from '../shared/projectOps';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
// Synthetic IPC ports test actual Owner/Adapter/Slot lifetime, not native/Main policy.
const heldFixture=async(failure?:'persist'|'ACK')=>{
 const queue=createBitmapLayerWriteQueue(),started=deferred(),release=deferred(),calls:string[]=[];
 let saved=0;
 const slots=createWorkspaceSlots({initialProject:createProject('initial'),observe:async()=>({binding:'A',folderPath:'/A',metadataPath:'/A/project.json'}),publishProject:()=>{},captureView:()=>({}),certifyHandoff:async()=>true,drain:()=>queue.drain(),publishActive:()=>{},
 adapterPorts:slot=>({queue,freshToken:()=> 'token',assertAdmission:()=>{if(slot.lifecycle!=='active')throw Error('Workspace admission frozen');},assertRequiredPersistence:()=>{if(!slot.root)throw Error('No Root');},api:()=>({readOutputIdentity:async()=> '0'.repeat(64),saveWorkspace:async p=>{calls.push('output');started.resolve();await release.promise;return {...p,normalSaveOutputs:[],recoverySaveNonce:'original'};},autosaveWorkspace:async p=>{calls.push('persist:'+p.folderPath);if(failure==='persist')throw Error('original disk failure');return {ordinaryPersistenceNonce:p.recoverySaveNonce?undefined:'ordinary-original'};},acknowledgeSave:async p=>{calls.push('ACK:'+p.folderPath+':'+p.nonce);return failure!=='ACK';}}),onSave:ok=>{if(ok)saved++;},onError:()=>{}})});
 await slots.requestOpen('/A',async(slot,root)=>{const scan={...root,folderName:'A',images:[],project:createProject('A')};await slot.adapter.load(async()=>scan,()=>{});return scan;});
 return {slots,queue,started,release,calls,get saved(){return saved;}};
};
test.each(['persist','ACK'] as const)('Close keeps original facts and never reports complete after %s refusal',async failure=>{
 const f=await heldFixture(failure),slot=f.slots.active,saving=slot.adapter.save();await f.started.promise;const closing=f.slots.freezeForClose();f.release.resolve();const capture=await closing;
 expect(await saving).toBe(false);expect(f.saved).toBe(0);expect(slot.adapter.owner.hasUnsavedWork()).toBe(true);expect(capture.slots[0].content.effectFacts.error).toMatchObject({message:failure==='persist'?'original disk failure':'Exact Save binding ACK refused'});
 expect(f.calls).toEqual(failure==='persist'?['output','persist:/A']:['output','persist:/A','ACK:/A:original']);await f.queue.drain();
});
test('Close drains already-effect producer original Root ordinary ACK but rejects fresh frozen autosave',async()=>{
 const f=await heldFixture(),slot=f.slots.active;const producing=f.slots.submitAssetIntent(slot,'paint',new Uint8Array([7]),async()=>{f.started.resolve();await f.release.promise;return 'real-effect';});
 await f.started.promise;let captured=false;const closing=f.slots.freezeForClose().then(c=>{captured=true;return c;});await Promise.resolve();expect(captured).toBe(false);f.release.resolve();expect(await producing).toBe('real-effect');const capture=await closing;
 expect(f.calls).toEqual(['persist:/A','ACK:/A:ordinary-original']);expect(capture.slots[0].content.retainedAssetIntents).toEqual([]);
 expect(await slot.adapter.autosave(slot.projectRef.current)).toBe(false);expect(f.calls).toEqual(['persist:/A','ACK:/A:ordinary-original']);await f.queue.drain();
});
