import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { readPhotocraft } from './formats/photocraft';
import { createImageProject } from './createImageProject';
import { createProjectStore } from './persistence';
import { openFlowEditorRuntime } from './flowEditorRuntime';
import { createTiffCodec } from './formats';
import { pixelDigest } from './flowPixelIdentity';
import { applyImageEdit } from '../../drawing/core';
import { toolPlan } from '../../session/core/pixelTools';
import { reconcileExternalImage } from './flowImageReconciliation';
import { snapshotProject } from './persistence/validate';

const exec = promisify(execFile), sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const get = <T>(r:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const rgba=async(png:Uint8Array)=>[...await sharp(png).ensureAlpha().raw().toBuffer()];
async function fixtures(){
 const root=await temporaryWorkspace('photocraft-'),source=path.join(root,'sources'),out=path.join(root,'out');await fs.mkdir(source);await fs.mkdir(out);
 await exec(path.resolve('native/photocraft/target/debug/examples/fixtures'),[source]);return {root,source,out};
}
const codec=()=>createTiffCodec({scriptPath:path.resolve('src/project-files/main/formats/codec.py'),depsDir:path.resolve('vendor/python/photoshop-tiff')});

describe('pinned PhotoCraft read-only process and retained references',()=>{
 it('reads real PSD pixels and bottom-to-top layers; independent known RGBA/alpha values match',async()=>{
  const {source}=await fixtures();const result=await readPhotocraft(await fs.readFile(path.join(source,'simple.psd')),'psd');
  expect(result.reference).toBe(false);expect(result.value.layers.map(l=>l.name)).toEqual(['底图','叠画']);
  expect((await rgba(result.value.layers[0].png)).slice(0,4)).toEqual([40,80,160,255]);
  expect((await rgba(result.value.layers[1].png)).slice(0,4)).toEqual([200,100,50,128]);
  const stale=await readPhotocraft(await fs.readFile(path.join(source,'stale.psd')),'psd');expect(stale.reference).toBe(true);expect((await rgba(stale.value.layers[0].png)).slice(0,3)).toEqual([0,0,0]);
 },30000);
 it('protects complex PSD/TIFF displays and converts Display P3 through ICC, compared with libvips/lcms',async()=>{
  const {source}=await fixtures();
  for(const format of ['psd','tiff'] as const){
   const bytes=await fs.readFile(path.join(source,'complex.'+format)),read=await readPhotocraft(bytes,format);
   expect(read.reference).toBe(true);expect(read.value.layers).toHaveLength(1);
   const pixel=(await rgba(read.value.layers[0].png)).slice(0,4);
   // Independent source-over expectation (2 x 8-bit source layers).
   expect(pixel[3]).toBe(255);for(const [i,v] of [120,90,105].entries())expect(Math.abs(pixel[i]-v)).toBeLessThanOrEqual(1);
  }
  await expect(readPhotocraft(await fs.readFile(path.join(source,'untagged-cmyk.tiff')),'tiff')).rejects.toThrow('没有嵌入ICC');
  const bytes=await fs.readFile(path.join(source,'p3.tiff')),read=await readPhotocraft(bytes,'tiff');expect(read.reference).toBe(true);
  const actual=(await rgba(read.value.layers[0].png)).slice(0,4);
  const expected=[...await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer()].slice(0,4);
  for(let i=0;i<4;i++)expect(Math.abs(actual[i]-expected[i])).toBeLessThanOrEqual(2);
 },30000);
 it('imports/paints/Save/reopens with immutable originals, blocks source edits, retains protection in TIFF and rejects missing/tampered originals',async()=>{
  const {source,out}=await fixtures(),file=path.join(source,'complex.psd'),original=await fs.readFile(file);
  const issues:unknown[]=[];
  const created=await createImageProject({source:{kind:'files',files:[file]},destinationParent:out,folderName:'Proj',name:'Proj',naming:{sceneCode:'S',artistName:'A',version:'1'}},
   {signal:new AbortController().signal,decideIssues:async value=>{issues.push(...value);return 'continue';}});
  expect(issues).toHaveLength(1);expect(JSON.stringify(issues)).toContain('不是原复杂结构的往返文件');
  const stored=get(await createProjectStore().loadCheckpoint(created.root));
  const project=stored.project,shot=project.shots[0],image=project.images[shot.imageId],base=image.layers[0];expect(base.sourceReference?.format).toBe('psd');
  const originalPath=path.join(created.root,'.storyboard-flow/originals',shot.id+'.tif');expect(await fs.readFile(originalPath)).toEqual(original);
  expect(await pixelDigest(await stored.readAsset(base.assetId))).toBe(base.sourceReference?.previewPixels);
  for(const edit of [
   {kind:'setLayer' as const,layerId:base.id,patch:{locked:false}}, {kind:'setLayer' as const,layerId:base.id,patch:{visible:false}},
   {kind:'replacePixels' as const,layerId:base.id,assetId:'a'.repeat(64)}, {kind:'removeLayer' as const,layerId:base.id},
   {kind:'moveLayer' as const,layerId:base.id,index:0}
  ])expect(applyImageEdit(image,edit).ok).toBe(false);
  expect(applyImageEdit(image,{kind:'insertLayer',index:1,layer:{...base,id:'duplicate'}}).ok).toBe(false);
  expect(toolPlan(image,{kind:'clear',layerId:base.id}).ok).toBe(false);
  const runtime=await openFlowEditorRuntime(created.root);
  const ink=await sharp({create:{width:4,height:2,channels:4,background:'#ff000080'}}).png().toBuffer();
  const receipt=get(await runtime.put({operationId:'new-ink',png:ink,width:4,height:2}));
  const edited=structuredClone(project);edited.revision++;edited.images[image.id]=get(applyImageEdit(image,{kind:'insertLayer',index:1,layer:{id:'ink',name:'Drawing',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:4,height:2,assetId:receipt.assetId}})).after;
  expect(edited.images[image.id].layers[0].sourceReference).not.toBe(base.sourceReference);
  expect((await runtime.checkpoint(edited)).ok).toBe(true);expect((await runtime.saveTiff(edited)).ok).toBe(true);
  const name=(await fs.readdir(created.root)).find(n=>n.endsWith('.tif'))!;
  const tiff=get(await codec().decode(await fs.readFile(path.join(created.root,name))));expect(tiff.image.layers[0].sourceReference).toEqual(base.sourceReference);
  expect(await rgba(tiff.image.layers[1].png)).toEqual(await rgba(ink));
  expect(reconcileExternalImage(image,edited.images[image.id],{...tiff.image,layers:tiff.image.layers.map(({png,...l})=>({...l,assetId:sha(png)}))},true).kind).toBe('conflict');
  const working=path.join(created.root,name),unchanged=await fs.readFile(working);
  const stripped=structuredClone(edited.images[image.id]);delete stripped.layers[0].sourceReference;
  const changed=get(await codec().encode({image:stripped,text:{projectId:edited.id,projectName:edited.name,shotId:shot.id,shotName:shot.name,scriptText:'',dialogues:[]}},async id=>get(await runtime.read(id))));
  await fs.writeFile(working,changed);const refreshed=await runtime.refresh(edited);expect(refreshed.ok).toBe(false);
  expect(get(await createProjectStore().loadCheckpoint(created.root)).project).toEqual(edited);await fs.writeFile(working,unchanged);
  await fs.rename(source,source+'-moved');
  const reopened=await openFlowEditorRuntime(created.root);expect(reopened.open().project.images[image.id].layers).toHaveLength(2);
  expect((await reopened.saveTiff(reopened.open().project)).ok).toBe(true);
  const forged=structuredClone(edited);delete forged.images[image.id].layers[0].sourceReference;
  await expect(reopened.checkpoint(forged)).rejects.toThrow('Protected source');
  const broken=structuredClone(edited);broken.images[image.id].layers[0].locked=false;expect(()=>snapshotProject(broken)).toThrow();
  await fs.writeFile(originalPath,Buffer.from('tampered'));await expect(openFlowEditorRuntime(created.root)).rejects.toThrow('Protected source');
  await fs.writeFile(originalPath,original);await fs.rename(originalPath,originalPath+'.retained');await expect(openFlowEditorRuntime(created.root)).rejects.toThrow();
  expect(await fs.readFile(path.join(source+'-moved','complex.psd'))).toEqual(original);
 },60000);
 it('retains damaged worker evidence, refuses invalid signatures and reduced/unknown Flow envelopes never fall back',async()=>{
  await expect(readPhotocraft(Buffer.from('invalid'),'psd')).rejects.toThrow('evidence retained');
  await expect(readPhotocraft(new Uint8Array(129*1024*1024),'tiff')).rejects.toThrow('byte limit');
  await expect(readPhotocraft(Buffer.from('8BPSinvalid'),'psd','/missing/flow-photocraft')).rejects.toThrow('读取组件未准备好');
 });
});
