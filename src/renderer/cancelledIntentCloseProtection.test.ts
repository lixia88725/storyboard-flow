import {test,expect} from 'vitest';
import {createNormalSaveProjectOwner} from './normalSaveProjectOwner';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {createProject} from '../shared/projectOps';
import {createRecoveryCloseBarrier} from '../../electron/main/recoveryCloseBarrier';
import {cancelledBeforeEffect} from './assetIntentAdmission';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
// Real owner/queue/admission/Main barrier; persistence is an explicitly held port,
// not mounted native I/O. A separate mounted check is still required.
test.each([0,1])('Save ACK cannot consume cancelled bytes or authorize Close choice %s',async choice=>{
 const started=deferred(),ack=deferred(),queue=createBitmapLayerWriteQueue();let writes=0,persists=0;
 const ref={current:createProject('A')};
 const owner=createNormalSaveProjectOwner({projectRef:ref,setProject:p=>{ref.current=p;},queue,freshToken:()=> 'token',readIdentity:async()=> '0'.repeat(64),output:async()=>[],persist:async()=>{persists++;if(persists===1){started.resolve();await ack.promise;}}});
 const saving=owner.save();await started.promise;
 const bytes=new Uint8Array([18,99,0,255]);
 const paint=owner.submitAssetIntent({workspace:'/A',assetId:'paint',desiredBytes:bytes},async()=>{writes++;});bytes.fill(0);
 await owner.suspendAssetAdmission();ack.resolve();expect(await saving).toBe(true);expect(await paint).toEqual(cancelledBeforeEffect);
 const content=owner.captureRecoveryContent();expect(content.retainedAssetIntents.map(i=>[...i.desiredBytes])).toEqual([[18,99,0,255]]);
 expect(owner.recoveryRequired()).toBe(true);expect(writes).toBe(0);
 let destroyed=0,cancelled=0;const prompts:string[][]=[];
 const window={destroy:()=>{destroyed++;},webContents:{id:1,mainFrame:{},send:()=>{}}};
 const event={sender:window.webContents,senderFrame:window.webContents.mainFrame} as never;
 const barrier=createRecoveryCloseBarrier({requestId:()=> 'close',showMessageBox:async(_w,o)=>{prompts.push(o.buttons!);return {response:choice};},cancelled:()=>{cancelled++;},certifyRetained:async()=>false});
 barrier.begin(window);await barrier.finishCapture(event,{requestId:'close',captureAvailable:true,recoveryRequired:owner.recoveryRequired(),busy:false,hasUnsavedChanges:true,capture:content});
 expect(destroyed).toBe(0);expect(cancelled).toBe(1);expect(prompts).toEqual([]);
 owner.resumeAssetAdmission();expect(await owner.save()).toBe(true);
 expect(owner.recoveryRequired()).toBe(true);expect(owner.captureRecoveryContent().retainedAssetIntents).toEqual(content.retainedAssetIntents);expect(writes).toBe(0);
 await queue.drain();
});
