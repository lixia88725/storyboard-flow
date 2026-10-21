import { expect, it } from 'vitest';
import { createProject } from '../shared/projectOps';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { createNormalSaveAppAdapter } from './normalSaveAppAdapter';
import { useBitmapLayerPaintingController } from './bitmapLayerPaintingController';

it('real painting first write pins exact desired bytes independent of finite single-PNG proof; failed RAM snapshot preserves raw unknown fields',async()=>{
  const raw=createProject('A');
  raw.shots=[{id:'s',imagePath:'/A/s.tiff',fileName:'s.tiff',order:0,layers:[{id:'l',kind:'paint',name:'ink',visible:true,locked:false,opacity:1,order:0,blendMode:'normal',bitmapPath:'.storyboard-workbench/layers/s/l.png',width:1,height:1}]}];
  raw.pendingBake={version:1,shots:{s:{state:'synced',acceptedOutputIdentity:'a'.repeat(64)}}};
  (raw as unknown as Record<string,unknown>).futureField={unsupported:[9,{keep:'raw'}]};
  const projectRef={current:raw},queue=createBitmapLayerWriteQueue();
  const adapter=createNormalSaveAppAdapter({projectRef,setProject:p=>{projectRef.current=p},queue,freshToken:()=> 't',paths:()=>({folderPath:'/A',metadataPath:'/A/.storyboard-workbench/storyboard.project.json'}),api:()=>({saveWorkspace:async p=>p,autosaveWorkspace:async()=>{},readOutputIdentity:async()=> 'a'.repeat(64)}),onSave:()=>{},onError:()=>{}});
  let writes=0;
  const desired='data:image/png;base64,EXACT_DESIRED_VERSION';
  const controller=useBitmapLayerPaintingController({api:{readLayerPng:async()=> 'old',writeLayerPng:async()=>{writes++;throw new Error('unknown native commit')},assetUrl:(p:string)=>p} as never,captureWorkspace:()=>()=>true,projectRef,folderPath:'/A',bitmapLayerWriteQueueRef:{current:queue},createHistoryEntryFromLayerAssets:()=>({}),captureEffectCompletion:()=>adapter.owner.captureEffectCompletion(),recordUndoEntry:()=>{},markShotsDirty:()=>{},updateProject:()=>{},blurBitmapLayer:async()=>desired});
  await expect(controller.handleBitmapBlur(raw.shots[0],'l',1)).rejects.toThrow('unknown native commit');
  expect(writes).toBe(1);
  const held=(adapter.owner as unknown as {captureRecoveryContent:()=>{projectRaw:Project;desiredAssets:{dataUrl:string}[];recoveryRequired:boolean}}).captureRecoveryContent();
  expect(held.desiredAssets.map(a=>a.dataUrl)).toEqual([desired]);
  expect((held.projectRaw as unknown as Record<string,unknown>).futureField).toEqual({unsupported:[9,{keep:'raw'}]});
  expect(held.recoveryRequired).toBe(true);
  (held.projectRaw as unknown as Record<string,unknown>).futureField='changed';
  expect((projectRef.current as unknown as Record<string,unknown>).futureField).toEqual({unsupported:[9,{keep:'raw'}]});
});
import type { Project } from '../shared/types';
