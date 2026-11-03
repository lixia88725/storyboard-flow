import {test,expect} from 'vitest';
import {createAssetIntentAdmission,CompletedWithoutPublication,completedWithoutPublication} from './assetIntentAdmission';
import {createNormalSaveProjectOwner, type CompletedEffect} from './normalSaveProjectOwner';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {addGeneratedShot,createProject} from '../shared/projectOps';
const ownerFixture=()=>{
 const p=addGeneratedShot(createProject('A'),{imagePath:'/A/s.tiff',fileName:'s.tiff',width:2,height:2}),shot=p.shots[0],layer=shot.layers![1];
 p.pendingBake={version:1,shots:{[shot.id]:{state:'synced',acceptedOutputIdentity:'0'.repeat(64)}}};
 const ref={current:p},queue=createBitmapLayerWriteQueue();
 const owner=createNormalSaveProjectOwner({projectRef:ref,setProject:p=>{ref.current=p;},queue,freshToken:()=> 'next',readIdentity:async()=> '0'.repeat(64),output:async()=>[],persist:async()=>{},captureEffectPersistence:()=>({folderPath:'/A',metadataPath:'/A/project.json',persist:async()=>{}})});
 return {owner,shot,layer,queue,value:{workspace:'/A',assetId:layer.bitmapPath,desiredBytes:new Uint8Array([4,1,3])}};
};
test('same completed signal cannot cross exact intent or be reused, even with identical labels and bytes',async()=>{
 const f=ownerFixture();let signal:unknown,completion!:CompletedEffect;
 await expect(f.owner.submitAssetIntent(f.value,async()=>{
  completion=f.owner.captureEffectCompletion();completion.retainDesiredPng!({folderPath:'/A',bitmapPath:f.layer.bitmapPath,shotId:f.shot.id,layerId:f.layer.id,dataUrl:'desired-PNG'});
  await completion(p=>p,[f.shot.id],{published:()=>{},afterDurable:async()=>{}});
  try {completion.exitWithoutPublication!();}catch(error){signal=error;throw error;}
 })).resolves.toBe(completedWithoutPublication);
 expect(f.owner.captureRecoveryContent().retainedAssetIntents).toEqual([]);
 await expect(f.owner.submitAssetIntent(f.value,async()=>{throw signal;})).rejects.toBe(signal);
 expect(f.owner.captureRecoveryContent().retainedAssetIntents).toHaveLength(1);
 expect(()=>completion.exitWithoutPublication!()).toThrow('authority unavailable');
 const other=ownerFixture();await expect(other.owner.submitAssetIntent(other.value,async()=>{throw signal;})).rejects.toBe(signal);expect(other.owner.captureRecoveryContent().retainedAssetIntents).toHaveLength(1);
 await Promise.all([f.queue.drain(),other.queue.drain()]);
});
test('effect handle cannot mint completion before original history and required ACK',async()=>{
 const f=ownerFixture();
 await expect(f.owner.submitAssetIntent(f.value,async()=>{const complete=f.owner.captureEffectCompletion();complete.exitWithoutPublication!();})).rejects.toThrow('authority unavailable');
 expect(f.owner.captureRecoveryContent().retainedAssetIntents).toHaveLength(1);await f.queue.drain();
});
const intent=(id:string)=>({workspace:'/A',assetId:id,desiredBytes:new Uint8Array([7,42,255])});
test('public nominal completion cannot retire an uncompleted exact intent',async()=>{
 const a=createAssetIntentAdmission();const signal=new CompletedWithoutPublication();
 await expect(a.submit(intent('first'),async()=>{throw signal;})).rejects.toBe(signal);
 expect(a.retainedIntents()).toEqual([{...intent('first'),state:'failed'}]);
});
test('returned public completion singleton is not completion authority',async()=>{
 const a=createAssetIntentAdmission();
 await expect(a.submit(intent('first'),async()=>completedWithoutPublication)).rejects.toThrow('completion');
 expect(a.retainedIntents()).toEqual([{...intent('first'),state:'failed'}]);
});
