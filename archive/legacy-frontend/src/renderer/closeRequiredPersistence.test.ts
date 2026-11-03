import {test,expect} from 'vitest';
import {createWorkspaceSlots} from './workspaceSlots';
import {createProject} from '../shared/projectOps';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
test('Close drains admitted Save original Root required persistence and exact ACK before capture',async()=>{
 const queue=createBitmapLayerWriteQueue(),started=deferred(),release=deferred(),calls:string[]=[];let saveState='saving';
 const slots=createWorkspaceSlots({initialProject:createProject('initial'),observe:async()=>({binding:'A',folderPath:'/A',metadataPath:'/A/project.json'}),publishProject:()=>{},captureView:()=>({saveState}),certifyHandoff:async()=>true,drain:()=>queue.drain(),publishActive:()=>{},
 adapterPorts:slot=>({queue,freshToken:()=> 'token',assertAdmission:()=>{if(slot.lifecycle!=='active')throw Error('Workspace admission frozen');},assertRequiredPersistence:()=>{if(!slot.root)throw Error('No Root');},api:()=>({readOutputIdentity:async()=> '0'.repeat(64),saveWorkspace:async p=>{calls.push('output:'+p.folderPath);started.resolve();await release.promise;return {...p,normalSaveOutputs:[],recoverySaveNonce:'exact-A'};},autosaveWorkspace:async p=>{calls.push('persist:'+p.folderPath+':'+p.recoverySaveNonce);return p;},acknowledgeSave:async p=>{calls.push('ACK:'+p.folderPath+':'+p.nonce);return true;}}),onSave:()=>{saveState='saved';},onError:()=>{}})});
 await slots.requestOpen('/A',async(slot,root)=>{const scan={...root,folderName:'A',images:[],project:createProject('A')};await slot.adapter.load(async()=>scan,()=>{});return scan;});
 const saving=slots.active.adapter.save();await started.promise;let captured=false;const closing=slots.freezeForClose().then(c=>{captured=true;return c;});await Promise.resolve();expect(captured).toBe(false);release.resolve();const capture=await closing;expect(await saving).toBe(true);expect(capture.slots[0]).toMatchObject({saveState:'saved'});
 expect(calls).toEqual(['output:/A','persist:/A:exact-A','ACK:/A:exact-A']);expect(capture.slots[0].content.effectFacts.error).toBe(null);expect(capture.slots[0].content.recoveryRequired).toBe(false);await queue.drain();
});
