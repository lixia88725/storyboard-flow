import {test,expect} from 'vitest';
import {createNormalSaveProjectOwner} from './normalSaveProjectOwner';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {createProject} from '../shared/projectOps';
import {initializeCompletedShot} from '../shared/pendingBake';
const hold=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('Save settles admitted producer before capture; late asset stays outside queue until final ACK while P2 metadata survives',async()=>{
 const p=createProject('P1');p.shots=[{id:'s',imagePath:'/synthetic/s.tiff',fileName:'s.tiff',order:0,swb:{version:1,status:'owned',canvasWidth:1,canvasHeight:1},layers:[{id:'l',kind:'paint',name:'Paint',visible:true,locked:false,opacity:1,blendMode:'normal',order:0,bitmapPath:'.storyboard-workbench/layers/s/l.png',width:1,height:1}]}];
 const ref={current:initializeCompletedShot(p,'s','a'.repeat(64),'t0')},queue=createBitmapLayerWriteQueue(),events:string[]=[],first=hold(),final=hold(),outputStarted=hold();let token=0;
 const owner=createNormalSaveProjectOwner({projectRef:ref,setProject:()=>{},freshToken:()=>`t${++token}`,queue,readIdentity:async()=> 'a'.repeat(64),outputWhenClean:true,persist:async project=>{events.push('persist:'+project.name);if(project.name==='P2')await final.promise;},output:async project=>{events.push('output:'+project.name);outputStarted.resolve();return [{shotId:'s',sourcePath:'/synthetic/s.tiff',targetPath:'/synthetic/s.tiff',capturedToken:project.pendingBake!.shots.s.editToken!,outputHash:'a'.repeat(64)}];}});
 const admitted=owner.submitAssetIntent({workspace:'/synthetic',assetId:'first',desiredBytes:new Uint8Array([1])},async()=>{events.push('first-effect');await first.promise;owner.publishEdit(project=>({...project,name:'admitted'}),['s']);expect(await owner.persistAdmittedAssets()).toBe(true);events.push('first-required-ACK');});await tick();
 const saving=owner.save(),late=owner.submitAssetIntent({workspace:'/synthetic',assetId:'late-add',desiredBytes:new Uint8Array([2])},async()=>{events.push('late-effect');});await tick();expect(events).toEqual(['first-effect']);
 first.resolve();await admitted;await outputStarted.promise;
 owner.publishEdit(project=>({...project,name:'P2'}),[]);await tick();expect(events).not.toContain('late-effect');expect(owner.captureRecoveryContent().retainedAssetIntents.map(i=>i.assetId)).toContain('late-add');
 final.resolve();await saving;await late;expect(events.indexOf('late-effect')).toBeGreaterThan(events.indexOf('persist:P2'));expect(ref.current.name).toBe('P2');expect(owner.captureRecoveryContent().retainedAssetIntents).toEqual([]);
});
