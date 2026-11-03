import * as managed from './managedSourceSave';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openFlowEditorRuntime } from './flowEditorRuntime';
import { openFlowAssetDepot } from './persistence/depot';
import { createProjectStore } from './persistence';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
const get = <T>(r: {ok:true;value:T}|{ok:false;error:{message:string}}):T => { if(!r.ok) throw Error(r.error.message); return r.value; };
async function fixture() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'flow-editor-runtime-'));
 const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:100,maxPngBytes:10000}));
 const png=await sharp({create:{width:4,height:4,channels:4,background:'#fff'}}).png().toBuffer();
 const asset=get(await depot.put({operationId:'seed',png,width:4,height:4}));
 const project:ProjectV1={schema:'storyboard-flow.project',version:1,id:'project',revision:0,name:'test',shots:[{id:'shot',imageId:'image',name:'one',scriptText:''}],parkedShots:[],dialogues:[],images:{image:{id:'image',revision:0,width:4,height:4,layers:[{id:'layer',name:'paint',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:4,height:4,assetId:asset.assetId}]}}};
 get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
 return {root,project,png};
}
describe('dedicated editor root and Close certification',()=>{
 it('requires exact durable content, allows retry, then seals new writes',async()=>{
  const {root,project,png}=await fixture();
  try{
   const runtime=await openFlowEditorRuntime(root);
   expect(await runtime.certifyClose(null)).toBe(false);
   const changed=structuredClone(project);changed.revision++;changed.shots[0].scriptText='中文';
   expect(await runtime.certifyClose(changed)).toBe(false);
   expect((await runtime.checkpoint({...changed,id:'other'})).ok).toBe(false);
   expect((await runtime.checkpoint(changed)).ok).toBe(true);
   expect(await runtime.certifyClose(changed)).toBe(true);
   expect((await runtime.put({operationId:'late',png,width:4,height:4})).ok).toBe(false);
   expect((await runtime.checkpoint(changed)).ok).toBe(false);
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it('refuses missing/corrupt assets at Close without manufacturing a success',async()=>{
  const {root,project}=await fixture();
  try{
   const runtime=await openFlowEditorRuntime(root);
   const asset=project.images.image.layers[0].assetId;
   await fs.writeFile(path.join(root,'.storyboard-flow/checkpoints/assets',asset+'.png'),'bad');
   expect(await runtime.certifyClose(project)).toBe(false);
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it('does not certify a replacement directory even when its checkpoint and PNGs match',async()=>{
  const {root,project}=await fixture();const moved=root+'-original';
  try{
   const runtime=await openFlowEditorRuntime(root);
   await fs.rename(root,moved);await fs.cp(moved,root,{recursive:true});
   expect(await runtime.certifyClose(project)).toBe(false);
  }finally{await fs.rm(root,{recursive:true,force:true});await fs.rm(moved,{recursive:true,force:true});}
 });
 it('refuses a directory without a checkpoint and returns a private bootstrap',async()=>{
  const {root,project}=await fixture();
  try{
   const runtime=await openFlowEditorRuntime(root);const a=runtime.open();a.project.name='mutated';
   expect(runtime.open().project).toEqual(project);
   await expect(openFlowEditorRuntime(path.join(root,'missing'))).rejects.toThrow();
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
});

it('refuses Close while a real Trash ACK is not durable, then allows retry without another Trash call',async()=>{
 const {root,project}=await fixture();
 const sink=await temporaryWorkspace('flow-runtime-trash-');
 const trash=vi.fn(async(file:string)=>{await fs.rename(file,path.join(sink,'owned.tif'));});
 const runtime=await openFlowEditorRuntime(root,trash);
 const originalWrite=managed.writeManagedSourceFile;
 try {
  expect((await runtime.saveTiff(project)).ok).toBe(true);
  const removed=structuredClone(project);removed.shots=[];removed.revision++;
  expect((await runtime.checkpoint(removed)).ok).toBe(true);
  const write=vi.spyOn(managed,'writeManagedSourceFile').mockImplementation(async(...args)=>{
   if(args[1].endsWith('/tiff-output.json')&&Buffer.from(args[2]).toString().includes('"phase":"confirmed"'))throw Error('confirmation disk failure');
   return originalWrite(...args);
  });
  try {
   const result=await runtime.saveTiff(removed);expect(result.ok).toBe(false);
   if(!result.ok)expect(result.error.message).toContain('confirmation disk failure');
   expect(trash).toHaveBeenCalledTimes(1);
   expect(await runtime.certifyClose(removed)).toBe(false);
  } finally {write.mockRestore();}
  expect((await runtime.saveTiff(removed)).ok).toBe(true);
  expect(trash).toHaveBeenCalledTimes(1);
  expect(await runtime.certifyClose(removed)).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
