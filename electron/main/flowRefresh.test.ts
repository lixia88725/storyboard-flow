import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {temporaryWorkspace} from '../../test/temporaryWorkspace';
import {createTiffCodec} from '../core/formats';
import {importFlowTiffFolder} from './flowTiffImport';
import {openFlowEditorRuntime} from './flowEditorRuntime';
import {createProjectStore} from '../core/persistence';
import * as managed from './managedSourceSave';
import type {ImageDocumentV1} from '../shared/refactorV1';
const get=<T>(r:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const codec=()=>createTiffCodec({scriptPath:path.resolve('electron/core/formats/codec.py'),depsDir:path.resolve('vendor/python/photoshop-tiff')});
async function fixture(){
 const root=await temporaryWorkspace('flow-refresh-'),c=codec();
 const pixels=await Promise.all(['#ffffff','#00000000','#ff0000','#00ff00'].map(background=>sharp({create:{width:4,height:3,channels:4,background}}).png().toBuffer()));
 const image:ImageDocumentV1={id:'source',revision:0,width:4,height:3,layers:pixels.slice(0,2).map((png,i)=>({id:'layer'+i,name:'layer'+i,kind:i?'paint':'image',visible:true,locked:false,opacity:1,blendMode:'normal',width:4,height:3,assetId:hash(png)}))};
 const read=async(id:string)=>pixels.find(p=>hash(p)===id)!;
 const original=get(await c.encode({image,text:null},read));await fs.writeFile(path.join(root,'source.tif'),original);
 const p=await importFlowTiffFolder(root,c),runtime=await openFlowEditorRuntime(root);
 const editExternal=async(index:number,pixel=2)=>{const next=structuredClone(image);next.layers[index].assetId=hash(pixels[pixel]);const encoded=get(await c.encode({image:next,text:null},read));await fs.writeFile(path.join(root,'source.tif'),encoded);return hash(get(await c.decode(encoded)).image.layers[index].png);};
 return {root,c,p,runtime,pixels,original,image,editExternal};
}
it('refreshes external base before first Save, preserves local drawing/text and immutable original, and deduplicates',async()=>{
 const f=await fixture(),shot=f.p.shots[0],local=structuredClone(f.p);
 const receipt=get(await f.runtime.put({operationId:'local',png:f.pixels[3],width:4,height:3}));
 local.images[shot.imageId].layers[1].assetId=receipt.assetId;local.images[shot.imageId].revision++;local.shots[0].scriptText='local words';local.revision++;
 get(await f.runtime.checkpoint(local));const externalHash=await f.editExternal(0);
 const external=await fs.readFile(path.join(f.root,'source.tif'));
 const refreshed=get(await f.runtime.refresh(local));
 expect(refreshed.images[shot.imageId].layers.map(l=>l.assetId)).toEqual([externalHash,hash(f.pixels[3])]);
 expect(refreshed.shots).toEqual(local.shots);expect(refreshed.dialogues).toEqual(local.dialogues);expect(refreshed.parkedShots).toEqual([]);
 expect(await fs.readFile(path.join(f.root,'source.tif'))).toEqual(external);
 expect(await fs.readFile(path.join(f.root,'.storyboard-flow/originals',shot.id+'.tif'))).toEqual(Buffer.from(f.original));
 expect(get(await f.runtime.refresh(refreshed))).toEqual(refreshed);
 expect(get(await createProjectStore().loadCheckpoint(f.root)).project).toEqual(refreshed);
 expect((await f.runtime.saveTiff(refreshed)).ok).toBe(true);
 expect((await openFlowEditorRuntime(f.root)).open().project).toEqual(refreshed);
},60000);
it('keeps same-layer conflicts in Pending, does not duplicate on retry, and Save emits both versions',async()=>{
 const f=await fixture(),shot=f.p.shots[0],local=structuredClone(f.p);
 get(await f.runtime.put({operationId:'local',png:f.pixels[3],width:4,height:3}));
 local.images[shot.imageId].layers[0].assetId=hash(f.pixels[3]);local.revision++;
 get(await f.runtime.checkpoint(local));const externalHash=await f.editExternal(0);
 const refreshed=get(await f.runtime.refresh(local));expect(refreshed.parkedShots).toHaveLength(1);
 expect(refreshed.images[shot.imageId]).toEqual(local.images[shot.imageId]);
 expect(refreshed.images[refreshed.parkedShots[0].imageId].layers[0].assetId).toBe(externalHash);
 const reopened=await openFlowEditorRuntime(f.root);
 expect(get(await reopened.refresh(refreshed))).toEqual(refreshed);
 get(await reopened.saveTiff(refreshed));expect(await fs.readdir(path.join(f.root,'Pending'))).toHaveLength(1);
},60000);
it('retains a failed acceptance journal, refuses Close/Save, and retry or reopen completes once',async()=>{
 const f=await fixture();const externalHash=await f.editExternal(0);
 const write=managed.writeManagedSourceFile;
 const spy=vi.spyOn(managed,'writeManagedSourceFile').mockImplementation(async(...args)=>{
  if(args[1].endsWith('tiff-output.json')&&args[2].toString().includes('"complete":true'))throw Error('acceptance failure');
  return write(...args);
 });
 try{
  expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{effect:'unknown'}});
  expect(await f.runtime.certifyClose(f.p)).toBe(false);
  expect((await f.runtime.saveTiff(f.p)).ok).toBe(false);
 }finally{spy.mockRestore();}
 const reopened=await openFlowEditorRuntime(f.root),after=reopened.open().project;
 expect(after.images[f.p.shots[0].imageId].layers[0].assetId).toBe(externalHash);
 expect(get(await reopened.refresh(after))).toEqual(after);
},60000);
it('rejects a stale supplied checkpoint and unsupported source without replacing the working TIFF',async()=>{
 const f=await fixture(),other=structuredClone(f.p);other.name='stale';
 expect((await f.runtime.refresh(other)).ok).toBe(false);
 await fs.writeFile(path.join(f.root,'source.tif'),'unsupported');
 expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{effect:'retained'}});
 expect(await fs.readFile(path.join(f.root,'source.tif'),'utf8')).toBe('unsupported');
 expect(get(await createProjectStore().loadCheckpoint(f.root)).project).toEqual(f.p);
},60000);
it('recovers prepared assets after checkpoint publication fails before they become eligible in a new runtime',async()=>{
 const f=await fixture(),externalHash=await f.editExternal(0);
 const directory=path.join(f.root,'.storyboard-flow/checkpoints');await fs.chmod(directory,0o500);
 try{expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{effect:'unknown'}});}
 finally{await fs.chmod(directory,0o700);}
 expect(get(await createProjectStore().loadCheckpoint(f.root)).project).toEqual(f.p);
 const reopened=await openFlowEditorRuntime(f.root),after=reopened.open().project;
 expect(after.images[f.p.shots[0].imageId].layers[0].assetId).toBe(externalHash);
 expect(await reopened.certifyClose(after)).toBe(true);
},60000);
it('returns the committed result after a lost final acknowledgement instead of creating another revision',async()=>{
 const f=await fixture();await f.editExternal(0);const write=managed.writeManagedSourceFile;
 const spy=vi.spyOn(managed,'writeManagedSourceFile').mockImplementation(async(...args)=>{
  const result=await write(...args);
  if(args[1].endsWith('tiff-output.json')&&args[2].toString().includes('"complete":true'))throw Error('lost reply');
  return result;
 });
 try{expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{effect:'unknown'}});}finally{spy.mockRestore();}
 const committed=get(await createProjectStore().loadCheckpoint(f.root)).project;
 expect(get(await f.runtime.refresh(f.p))).toEqual(committed);
 expect(get(await f.runtime.refresh(committed))).toEqual(committed);
},60000);

it('reserves checkpoint and Close admission before asynchronous journal checks',async()=>{
 const f=await fixture();
 const saving=f.runtime.checkpoint(f.p);
 expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{code:'busy'}});
 expect(await f.runtime.certifyClose(f.p)).toBe(false);
 get(await saving);
 const closing=f.runtime.certifyClose(f.p);
 expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{code:'busy'}});
 expect((await f.runtime.checkpoint(f.p)).ok).toBe(false);
 expect(await closing).toBe(true);
},60000);

it.each([0,300])('refuses oversized prepared/completed refresh states before intent, remaining editable (%i)',async(extra)=>{
 const probe=await fixture();probe.image.layers[0].name='x'.repeat(2000);await probe.editExternal(0);
 const write=managed.writeManagedSourceFile;let preparedSize=0;
 const spy=vi.spyOn(managed,'writeManagedSourceFile').mockImplementation(async(...args)=>{
  if(args[1].endsWith('tiff-output.json')&&args[2].toString().includes('"complete":false'))preparedSize=Buffer.byteLength(args[2]);
  return write(...args);
 });
 try{get(await probe.runtime.refresh(probe.p));}finally{spy.mockRestore();}
 expect(preparedSize).toBeGreaterThan(0);
 const f=await fixture();f.image.layers[0].name='x'.repeat(2000);await f.editExternal(0);
 const ledgerPath=path.join(f.root,'.storyboard-flow/tiff-output.json');
 const ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));
 ledger.padding='x'.repeat(8*1024*1024-preparedSize-100+extra);
 await fs.writeFile(ledgerPath,JSON.stringify(ledger));const before=await fs.readFile(ledgerPath);
 expect(await f.runtime.refresh(f.p)).toMatchObject({ok:false,error:{effect:'retained',message:expect.stringContaining('transaction budget')}});
 expect(await fs.readFile(ledgerPath)).toEqual(before);
 expect(get(await createProjectStore().loadCheckpoint(f.root)).project).toEqual(f.p);
 expect(await f.runtime.certifyClose(f.p)).toBe(true);
},60000);
