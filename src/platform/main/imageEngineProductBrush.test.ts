import {it,expect} from 'vitest';
import path from 'node:path';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import {BRUSH_PRESETS,strokeBrushFor} from '../../drawing/renderer/brushPresets';
import type {NativeImageRef} from '../contracts/imageProject';
import type {PreparedImage} from '../../session/core/nativeSession';
it('maps all five actual product presets and resumes only after a real native acknowledgement',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Product-capable native binary required');
 const root=await temporaryWorkspace('product-presets-node-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'product',incarnation:'one',budgetBytes:64<<20});
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});
 try{
  await connection.ready;expect(connection.supports('flowBrushPresetsV1')).toBe(true);
  const p=(await connection.request('new',{kind:'new',width:128,height:96})).header.body as Record<string,any>;
  expect(p.kind).toBe('prepared');let native:NativeImageRef={storeId:'native',documentId:p.receipt.documentId,versionId:p.receipt.versionId,manifestSha256:p.receipt.manifestSha256,width:128,height:96};
  await adapter.acceptOpened({candidateId:'new',baseVersion:null,native});
  let count=0;
  for(const preset of Object.values(BRUSH_PRESETS)){
   const stroke={tool:preset.tool,color:'#224466',size:preset.factory.size,opacity:.5,softness:1-preset.hardness,points:[20,20,100,70],pressures:[.2,1],brush:strokeBrushFor(preset.id,901)};
   const prepared:PreparedImage=await adapter.driver.preparePaint(`preset-${++count}`,native,stroke);expect(prepared.baseVersion).toBe(native.versionId);native=await adapter.driver.accept(prepared,native);
  }
  await adapter.driver.freeze();await adapter.driver.resume();
  const frame=await adapter.capture();expect((frame.header.body as any).frame.imageVersionRef).toBe(native.versionId);
  const legacy={...connection,supports:(cap:Parameters<typeof connection.supports>[0])=>cap==='flowBrushPresetsV1'?false:connection.supports(cap)};
  const old=createNativeSessionAdapter({connection:legacy,storeRoot:store,storeId:'native'});
  expect(()=>old.driver.pipeline!.validateStroke({tool:'brush',color:'#224466',size:7,opacity:1,softness:.5,points:[1,1],brush:strokeBrushFor('pencil',901)})).toThrow('flowBrushPresetsV1');
  await adapter.driver.freeze();await adapter.driver.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},30000);
