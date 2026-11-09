import {it,expect} from 'vitest';
import path from 'node:path';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import type {NativeImageRef} from '../contracts/imageProject';
import type {ImageEngineEdit} from '../contracts/imageEngine';

it('executes typed product edits and temporary selection across a real native connection',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Product edit native binary required');
 const root=await temporaryWorkspace('product-edit-node-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'product-edits',incarnation:'one',budgetBytes:128<<20});
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});
 try{
  await connection.ready;expect(connection.supports('productImageEditsV1')).toBe(true);
  const p=(await connection.request('new',{kind:'new',width:32,height:24})).header.body as Record<string,any>;
  let native:NativeImageRef={storeId:'native',documentId:p.receipt.documentId,versionId:p.receipt.versionId,manifestSha256:p.receipt.manifestSha256,width:32,height:24};
  await adapter.acceptOpened({candidateId:'new',baseVersion:null,native});
  let summary=await adapter.driver.summary(),serial=0;
  expect(summary.displayIdentity).toEqual(adapter.driver.displayIdentity());expect(summary.layers).toHaveLength(1);
  const commit=async(edit:ImageEngineEdit)=>{const prepared=await adapter.driver.prepareEdit(`edit-${++serial}`,native,edit,{expectedContextGeneration:summary.contextGeneration});native=await adapter.driver.accept(prepared,native);summary=await adapter.driver.summary();return prepared;};
  await commit({kind:'newLayer',name:'draw'});
  const top=summary.activeLayerId!,bottom=summary.layers[1].layerId,base=native;
  await commit({kind:'fill',layerId:top,x:0,y:0,color:[255,0,0,255],tolerance:0});
  const filled=await adapter.capture(),before=(filled.header.body as any).frame;
  const polygon=[{x:4,y:5},{x:12,y:5},{x:12,y:12},{x:4,y:12}];
  summary=await adapter.driver.selectionContext(native,top,polygon,summary.contextGeneration);
  expect(summary.temporarySelection).toMatchObject({layerId:top,pointCount:4,bounds:[4,5,8,7]});expect(summary.selection.present).toBe(false);
  expect(summary.displayIdentity.epoch).toBe(before.epoch);expect(summary.imageVersionRef).toBe(native.versionId);
  const gen=summary.contextGeneration;
  await expect(adapter.driver.prepareEdit('stale',native,{kind:'clear',layerId:top},{expectedContextGeneration:gen-1})).rejects.toMatchObject({code:'stale-context',effect:'none'});
  const discarded=await adapter.driver.prepareEdit('discarded-opacity',native,{kind:'setLayerOpacities',changes:[{layerId:top,before:1,opacity:.25}]},{expectedContextGeneration:gen});
  await expect(adapter.capture()).rejects.toMatchObject({code:'busy',effect:'none'});
  await adapter.driver.discard(discarded.candidateId);summary=await adapter.driver.summary();
  expect(summary.temporarySelection?.pointCount).toBe(4);expect((await adapter.capture()).payload).toEqual(filled.payload);
  await commit({kind:'transform',layerId:top,selection:polygon,matrix:[1,0,0,1,6,3]});
  const transformed=await adapter.capture();expect(transformed.payload).not.toEqual(filled.payload);expect(summary.temporarySelection).toBeNull();
  await commit({kind:'blur',layerId:top,radius:3,selection:polygon});expect((await adapter.capture()).payload).not.toEqual(transformed.payload);
  await commit({kind:'setLayer',layerId:top,patch:{opacity:.4,blendMode:'multiply',name:'renamed',visible:false}});
  expect(summary.layers[0]).toMatchObject({name:'renamed',opacity:expect.closeTo(.4),blendMode:'multiply',visible:false});
  await commit({kind:'moveLayers',layerIds:[top],targetLayerId:bottom,placement:'after'});expect(summary.layers[1].layerId).toBe(top);
  summary=await adapter.driver.selectLayerContext(native,bottom,summary.contextGeneration);expect(summary.activeLayerId).toBe(bottom);
  expect(adapter.driver.displayIdentity()).toEqual(summary.displayIdentity);
  await adapter.driver.install(base);summary=await adapter.driver.summary();expect(summary.imageVersionRef).toBe(base.versionId);expect(summary.temporarySelection).toBeNull();
  await adapter.driver.freeze();await adapter.driver.close();expect((await connection.exited).code).toBe(0);
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},30000);

it('refuses hidden source-selection clipping before admitting product paint in serial and pipeline modes',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Product guard native binary required');
 const root=await temporaryWorkspace('product-selection-guard-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'guard',incarnation:'one',budgetBytes:64<<20});
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});
 try{
  await connection.ready;expect(connection.supports('intrinsicSelectionPaintGuardV1')).toBe(true);
  const created=(await connection.request('new',{kind:'new',width:32,height:24})).header.body as any;
  let native:NativeImageRef={storeId:'native',...Object.fromEntries(['documentId','versionId','manifestSha256','width','height'].map(k=>[k,created.receipt[k]]))} as NativeImageRef;
  await adapter.acceptOpened({candidateId:'new',baseVersion:null,native});
  const selected=(await connection.request('intrinsic',{kind:'edit',edit:{kind:'rect',x:4,y:5,width:8,height:7}},native.versionId)).header.body as any;
  const prepared={candidateId:'intrinsic',baseVersion:native.versionId,native:{...native,versionId:selected.receipt.versionId,manifestSha256:selected.receipt.manifestSha256}};
  native=await adapter.driver.accept(prepared,native);
  const summary=await adapter.driver.summary(),before=(await adapter.capture()).payload;
  expect(summary.paintScope).toBe('source-selection-refused');expect(summary.tools.paint.enabled).toBe(false);
  const stroke={tool:'brush' as const,color:'#224466',size:7,opacity:1,softness:.5,points:[2,2],brush:{tip:'pencil' as const,hardness:.5,grain:.55,spacing:.035,pressureSize:.45,pressureOpacity:.6,seed:42}};
  await expect(adapter.driver.preparePaint('blocked-serial',native,stroke)).rejects.toMatchObject({code:'unsupported-source-selection',effect:'none'});
  await adapter.driver.cancelPreview('blocked-serial');
  await expect(adapter.driver.preparePaint('blocked-basic',native,{...stroke,brush:undefined})).rejects.toMatchObject({code:'unsupported-source-selection',effect:'none'});
  await adapter.driver.cancelPreview('blocked-basic');expect(await adapter.driver.status('blocked-serial')).toEqual({state:'absent'});
  const pipeline=adapter.driver.pipeline!;await pipeline.start(native,{maxPendingStrokes:4,maxPendingPoints:65536,maxRetainedPixelBytes:16<<20});
  await expect(pipeline.begin('blocked-pipeline',null,stroke)).rejects.toMatchObject({code:'unsupported-source-selection',effect:'none'});
  const polled=await pipeline.poll();expect(polled.queueDepth).toBe(0);await pipeline.stop();
  expect((await adapter.capture()).payload).toEqual(before);expect((await adapter.driver.summary()).selection.bounds).toEqual([4,5,8,7]);
  await adapter.driver.freeze();await adapter.driver.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},15000);

it('preserves native pipeline preparation errors instead of reporting malformed prepared receipts',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Real native binary required');
 const root=await temporaryWorkspace('pipeline-failure-receipt-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'failure-receipt',incarnation:'one',budgetBytes:32<<20});
 const original=connection.request;
 connection.request=async(...args)=>{const response=await original(...args);if(args[1].kind==='pipelinePoll')response.header.body={...(response.header.body as object),events:[{operationId:'failed-paint',result:{kind:'failure',error:{code:'storage',message:'Synthetic snapshot persistence failed',effect:'unknown'}}}]};return response;};
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});
 try{
  await connection.ready;const p=(await connection.request('new',{kind:'new',width:32,height:24})).header.body as Record<string,any>;
  const native:NativeImageRef={storeId:'native',documentId:p.receipt.documentId,versionId:p.receipt.versionId,manifestSha256:p.receipt.manifestSha256,width:32,height:24};
  await adapter.acceptOpened({candidateId:'new',baseVersion:null,native});
  await adapter.driver.pipeline!.start(native,{maxPendingStrokes:4,maxPendingPoints:65536,maxRetainedPixelBytes:16<<20});
  await expect(adapter.driver.pipeline!.poll()).rejects.toMatchObject({code:'storage',message:'Synthetic snapshot persistence failed',effect:'retained',nativeEffect:'unknown',operationId:'failed-paint',command:'pipelinePoll'});
  await adapter.driver.pipeline!.stop();await adapter.driver.freeze();await adapter.driver.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},15000);
