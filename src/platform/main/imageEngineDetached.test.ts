import {it,expect} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import type {RetainedSourceObject} from '../../project-files/main/image-engine/sourceStore';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import type {NativeImageRef} from '../contracts/imageProject';

async function durable(file:string,value:unknown){const h=await fs.open(file,'wx');try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}}
const reservation={maxAdditionalBytes:2<<20};
it('prepares independent immutable candidates and thumbnails without switching active document, then accepts one synthetic Main batch',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Real detached-capable native binary required');
 const root=await temporaryWorkspace('detached-node-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'detached',incarnation:'one',budgetBytes:128<<20});
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'}),d=adapter.driver;
 try{
  await connection.ready;expect(connection.supports('detachedImageJobsV1')).toBe(true);
  const initial=await d.prepareCreation('initial',{kind:'new',width:64,height:48},reservation);
  expect(initial.baseVersion).toBeNull();expect((await d.creationStatus('initial')).state).toBe('prepared');await expect(adapter.capture()).rejects.toThrow('No native editing target');
  await durable(path.join(root,'initial-main-surrogate.json'),{imageId:'a',operationId:'initial',native:initial.native});await d.settleCreation(initial);await expect(adapter.capture()).rejects.toThrow('No native editing target');
  await d.activate(initial.native);let a=initial.native,context=await d.summary();
  const p=await d.prepareEdit('fill',a,{kind:'fill',layerId:context.activeLayerId!,x:0,y:0,color:[224,32,64,255],tolerance:0},{expectedContextGeneration:context.contextGeneration});
  await durable(path.join(root,'paint-main-surrogate.json'),{imageId:'a',native:p.native});a=await d.accept(p,a);
  const source=(await adapter.capture()).payload,identity=d.displayIdentity(),generation=d.contextGeneration();
  const capturedInput={kind:'new' as const,width:20,height:16};const pending=d.prepareCreation('captured-input',capturedInput,reservation);capturedInput.width=40;const captured=await pending;expect(captured.native.width).toBe(20);await d.discardCreation(captured.candidateId);expect(await d.creationStatus(captured.candidateId)).toEqual({state:'discarded'});
  const copying=d.prepareCreation('copy',{kind:'duplicate',source:a},reservation);
  await expect(d.prepareCreation('unbounded-second',{kind:'new',width:16,height:16},reservation)).rejects.toMatchObject({code:'backpressure',effect:'none'});
  const copy=await copying,second=await d.prepareCreation('second',{kind:'new',width:32,height:24},reservation);
  expect(copy.native.documentId).not.toBe(a.documentId);expect(second.native.documentId).not.toBe(copy.native.documentId);
  expect(d.displayIdentity()).toEqual(identity);expect(d.contextGeneration()).toBe(generation);expect((await adapter.capture()).payload).toEqual(source);
  const view=await d.inspectVersion(copy.native);const raw=await sharp(view.bytes).ensureAlpha().raw().toBuffer();expect(raw).toEqual(Buffer.from(source));expect(view.summary.documentId).toBe(copy.native.documentId);
  expect(view.summary.layers[0].layerId).toMatch(/^(0|[1-9][0-9]*)$/);
  await expect(d.freeze()).rejects.toMatchObject({code:'busy'});
  const page=await d.listCreations({limit:1});expect(page.totalUnsettled).toBe(2);expect(page.entries).toHaveLength(1);expect(page.nextCursor).not.toBeNull();const tail=await d.listCreations({limit:1,cursor:page.nextCursor!,snapshotToken:page.snapshotToken});expect(tail.entries).toHaveLength(1);expect(new Set([page.entries[0].operationId,tail.entries[0].operationId])).toEqual(new Set(['copy','second']));
  await durable(path.join(root,'one-main-batch-surrogate.json'),{candidates:[{imageId:'copy',native:copy.native},{imageId:'second',native:second.native}]});
  await d.settleCreation(copy);await expect(d.listCreations({limit:1,snapshotToken:page.snapshotToken})).rejects.toMatchObject({code:'stale-context',effect:'none'});await d.settleCreation(second);await expect(d.settleCreation({...copy,native:second.native})).rejects.toMatchObject({code:'conflict',effect:'none'});expect(await d.creationStatus(copy.candidateId)).toEqual({state:'accepted',native:copy.native});expect((await d.listCreations()).totalUnsettled).toBe(0);expect(d.displayIdentity()).toEqual(identity);
  await d.activate(second.native);expect((await adapter.capture()).payload.every(n=>n===255)).toBe(true);
  await d.activate(a);expect((await adapter.capture()).payload).toEqual(source);expect(d.displayIdentity()!.epoch).toBeGreaterThan(identity!.epoch);
  await d.freeze();await d.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},30000);

it('reopens a prepared creation after SIGKILL without guessing its image or automatically accepting/installing it',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Real detached-capable native binary required');
 const root=await temporaryWorkspace('detached-recovery-'),store=path.join(root,'native');
 let connection=startImageEngine({binary,store,sessionId:'detached-recovery',incarnation:'one',budgetBytes:64<<20});
 let adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});
 try{
  await connection.ready;await durable(path.join(root,'complete-main-input.json'),{operationId:'creation',imageId:'explicit-image',input:{kind:'new',width:48,height:32}});
  // Only the coordinator's durable input survives. It deliberately does not keep
  // or decide the final candidate receipt before the worker is killed.
  await adapter.driver.prepareCreation('creation',{kind:'new',width:48,height:32},reservation);
  connection.terminateOwnedProcess();expect((await connection.exited).signal).toBe('SIGKILL');
  connection=startImageEngine({binary,store,sessionId:'detached-recovery',incarnation:'one',budgetBytes:64<<20});adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});await connection.ready;
  expect((await adapter.driver.listCreations()).entries.map(e=>e.operationId)).toEqual(['creation']);
  const status=await adapter.driver.creationStatus('creation');expect(status.state).toBe('prepared');if(status.state!=='prepared')throw Error('Prepared source missing');const candidate=status.prepared;
  await expect(adapter.capture()).rejects.toThrow('No native editing target');
  const inspection=await adapter.driver.inspectVersion(candidate.native);expect(inspection.summary.width).toBe(48);await expect(adapter.capture()).rejects.toThrow('No native editing target');
  await durable(path.join(root,'main-cas-decision.json'),{imageId:'explicit-image',operationId:'creation',native:candidate.native});await adapter.driver.settleCreation(candidate);
  connection.terminateOwnedProcess();await connection.exited;
  connection=startImageEngine({binary,store,sessionId:'detached-recovery',incarnation:'one',budgetBytes:64<<20});adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'});await connection.ready;
  expect(await adapter.driver.creationStatus('creation')).toEqual({state:'accepted',native:candidate.native});await adapter.driver.settleCreation(candidate);await expect(adapter.capture()).rejects.toThrow('No native editing target');
  await adapter.driver.activate(candidate.native);expect((await adapter.capture()).payload).toHaveLength(48*32*4);
  await adapter.driver.freeze();await adapter.driver.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},30000);

it('hydrates authorized retained PNG bytes and inspects their version without replacing the current target',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Real detached-capable native binary required');
 const root=await temporaryWorkspace('detached-retained-'),store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'retained',incarnation:'one',budgetBytes:64<<20}),adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'}),d=adapter.driver;
 try{
  await connection.ready;const first=await d.prepareCreation('first',{kind:'new',width:32,height:24},reservation);await durable(path.join(root,'first-decision.json'),first.native);await d.settleCreation(first);await d.activate(first.native);const baseline=await adapter.capture(),identity=d.displayIdentity();
  const png=await sharp({create:{width:48,height:32,channels:4,background:{r:32,g:64,b:96,alpha:.5}}}).png().toBuffer();const file=path.join(root,'retained-source.png');await fs.writeFile(file,png,{flag:'wx'});const actual=await fs.realpath(file),st=await fs.stat(actual,{bigint:true});
  const source:RetainedSourceObject={path:actual,digest:createHash('sha256').update(png).digest('hex'),byteLength:png.length,identity:{dev:String(st.dev),ino:String(st.ino),size:String(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs)}};
  const prepared=await d.prepareRetained('hydrate',source,'png',reservation,{interpretationId:'photocraft-v1'});expect(prepared.native.documentId).not.toBe(first.native.documentId);expect(d.displayIdentity()).toEqual(identity);expect((await adapter.capture()).payload).toEqual(baseline.payload);
  const view=await d.inspectVersion(prepared.native);expect(view.summary).toMatchObject({width:48,height:32,sourceSelectionPresent:false,paintScope:'full-layer'});const raw=await sharp(view.bytes).ensureAlpha().raw().toBuffer();expect([...raw.subarray(0,4)]).toEqual([32,64,96,128]);
  expect(createHash('sha256').update(await fs.readFile(file)).digest('hex')).toBe(source.digest);
  await durable(path.join(root,'hydrated-binding-decision.json'),{imageId:'retained-image',operationId:'hydrate',native:prepared.native});await d.settleCreation(prepared);expect(d.displayIdentity()).toEqual(identity);await d.activate(prepared.native);expect([...(await adapter.capture()).payload.subarray(0,4)]).toEqual([32,64,96,128]);
  await d.freeze();await d.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},20000);
