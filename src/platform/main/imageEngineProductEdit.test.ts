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
