import {it,expect} from 'vitest';
import path from 'node:path';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import type {NativeImageRef} from '../contracts/imageProject';
import type {ImageEngineEdit} from '../contracts/imageEngine';
import {createImageFrameStore,type ImageFrameHeader} from '../../drawing/renderer/image-engine/frames';

it('previews absolute multi-layer edits through real native frames and durably adopts only the final matched COW version',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Product preview native binary required');
 const root=await temporaryWorkspace('product-preview-node-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'preview',incarnation:'one',budgetBytes:64<<20});
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});
 try{
  await connection.ready;expect(connection.supports('productEditPreviewV1')).toBe(true);
  const created=(await connection.request('new',{kind:'new',width:32,height:24})).header.body as any;
  let native:NativeImageRef={storeId:'native',documentId:created.receipt.documentId,versionId:created.receipt.versionId,manifestSha256:created.receipt.manifestSha256,width:32,height:24};
  await adapter.acceptOpened({candidateId:'new',baseVersion:null,native});let context=await adapter.driver.summary();
  for(const [op,edit] of [['layer',{kind:'newLayer',name:'drawing'}],['fill',{kind:'fill',layerId:null,x:0,y:0,color:[255,0,0,255],tolerance:0}]] as const){
   const actual=edit.kind==='fill'?{...edit,layerId:context.activeLayerId!}:edit;
   const p=await adapter.driver.prepareEdit(op,native,actual,{expectedContextGeneration:context.contextGeneration});native=await adapter.driver.accept(p,native);context=await adapter.driver.summary();
  }
  const original=(await adapter.capture()).payload,generation=context.contextGeneration;
  const edit=(opacity:number):ImageEngineEdit=>({kind:'setLayerOpacities',changes:context.layers.map(l=>({layerId:l.layerId,before:1,opacity}))});
  const first=await adapter.driver.previewEdit(native,'opacity',1,edit(.25),generation),firstFrame=await adapter.capture();
  const second=await adapter.driver.previewEdit(native,'opacity',2,edit(.6),generation),secondFrame=await adapter.capture();
  expect(first.stamp.editDigest).not.toBe(second.stamp.editDigest);expect(firstFrame.payload).not.toEqual(secondFrame.payload);
  const header=(secondFrame.header.body as any).frame as ImageFrameHeader,frames=createImageFrameStore(second.displayIdentity);
  expect(header.previewId).toBe('opacity');expect(header.imageVersionRef).toBe(native.versionId);expect(frames.accept(header,secondFrame.payload).ok).toBe(true);
  const summary=await adapter.driver.summary();expect(summary.layers[0].opacity).toBe(1);expect(summary.contextGeneration).toBe(generation);expect(summary.editPreview?.stamp).toEqual(second.stamp);
  await expect(adapter.driver.cancelEditPreview(native,first.stamp)).rejects.toMatchObject({code:'conflict',effect:'none'});
  await expect(adapter.driver.prepareEdit('wrong',native,edit(.2),{expectedContextGeneration:generation,preview:second.stamp})).rejects.toMatchObject({code:'conflict',effect:'none'});
  context=await adapter.driver.cancelEditPreview(native,second.stamp);expect(context.editPreview).toBeNull();expect((await adapter.capture()).payload).toEqual(original);
  const final=await adapter.driver.previewEdit(native,'final',1,edit(.4),generation),visual=(await adapter.capture()).payload;
  const prepared=await adapter.driver.prepareEdit('final-edit',native,edit(.4),{expectedContextGeneration:generation,preview:final.stamp});
  await expect(adapter.driver.cancelEditPreview(native,final.stamp)).rejects.toMatchObject({code:'busy'});
  expect((await adapter.driver.status('final-edit')).state).toBe('prepared');
  native=await adapter.driver.accept(prepared,native);expect((await adapter.capture()).payload).toEqual(visual);
  context=await adapter.driver.summary();expect(context.editPreview).toBeNull();expect(context.layers[0].opacity).toBeCloseTo(.4);expect(context.contextGeneration).toBeGreaterThan(generation);
  await adapter.driver.freeze();await adapter.driver.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},20000);
