import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import {promisify} from 'node:util';import {execFile} from 'node:child_process';import {createHash} from 'node:crypto';import sharp from 'sharp';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {readPhotocraft,writePhotocraftPsd} from './formats/photocraft';
import * as platform from '../../platform/main/platform/index';
import {publishPsdExclusive} from './flowPsdExport';
import {createImageProject} from './createImageProject';import {openFlowEditorRuntime} from './flowEditorRuntime';import {pixelDigest} from './flowPixelIdentity';
import type {ImageDocumentV1} from '../../platform/contracts/refactorV1';
const execute=promisify(execFile),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const get=<T>(r:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
async function setup(){const root=await temporaryWorkspace('psd-export-'),source=path.join(root,'source');await fs.mkdir(source);await execute(path.resolve('native/photocraft/target/debug/examples/fixtures'),[source]);return{root,source};}
async function input(source:string){
 const original=await fs.readFile(path.join(source,'complex.psd')),read=await readPhotocraft(original,'psd'),assets=new Map<string,Uint8Array>();
 const image:ImageDocumentV1={id:'image',revision:0,width:4,height:2,layers:[]};
 for(const layer of read.value.layers){const {png,...props}=layer;assets.set(sha(png),png);image.layers.push({...props,assetId:sha(png),sourceReference:{originalId:'shot',digest:sha(original),format:'psd',previewPixels:await pixelDigest(png)}});}
 for(const[i,blendMode]of(['normal','multiply','screen']as const).entries()){
  const png=await sharp({create:{width:4,height:2,channels:4,background:['#ff000080','#40b4dc80','#ffff00ff'][i]}}).png().toBuffer();assets.set(sha(png),png);
  image.layers.push({id:'ink'+i,name:'Flow layer '+i,kind:'paint',visible:i!==2,locked:i===2,opacity:[0.5,0.75,1][i],blendMode,width:4,height:2,assetId:sha(png)});
 }
 return{original,image,assets,read:async(id:string)=>{const b=assets.get(id);if(!b)throw Error('Missing');return b;}};
}
describe('append-only protected PSD export',()=>{
 it('preserves source structures, appends separate Flow layers and refreshes merged pixels',async()=>{
  const{root,source}=await setup(),x=await input(source),bytes=await writePhotocraftPsd(x.original,x.image,x.read);expect(Buffer.from(bytes.subarray(0,4)).toString()).toBe('8BPS');
  const target=path.join(root,'new.psd');await publishPsdExclusive(target,bytes);expect(await fs.readFile(path.join(source,'complex.psd'))).toEqual(x.original);
  const read=await readPhotocraft(bytes,'psd');expect(read.reference).toBe(true);
  const actual=await sharp(read.value.layers[0].png).ensureAlpha().raw().toBuffer();
  const before=[120,90,105];const normal=before.map((b,i)=>b*(1-128/255*.5)+[255,0,0][i]*(128/255*.5));
  const expected=normal.map((b,i)=>Math.round(b*(1-128/255*.75)+b*[64,180,220][i]/255*(128/255*.75)));
  expected.push(255);for(let i=0;i<4;i++)expect(Math.abs(actual[i]-expected[i])).toBeLessThanOrEqual(1);
 },30000);
 it('rejects stale layers and unsupported TIFF/P3/missing assets without publishing a destination',async()=>{
  const{source}=await setup(),x=await input(source);
  const stale=await fs.readFile(path.join(source,'stale.psd')),staleImage=structuredClone(x.image);staleImage.layers[0].sourceReference!.digest=sha(stale);
  await expect(writePhotocraftPsd(stale,staleImage,x.read)).rejects.toThrow('不一致');
  const p3=await fs.readFile(path.join(source,'p3.psd')),p3Image=structuredClone(x.image);p3Image.layers[0].sourceReference!.digest=sha(p3);await expect(writePhotocraftPsd(p3,p3Image,x.read)).rejects.toThrow('ICC');
  const tiff=structuredClone(x.image);tiff.layers[0].sourceReference!.format='tiff';await expect(writePhotocraftPsd(x.original,tiff,x.read)).rejects.toThrow('TIFF');
  await expect(writePhotocraftPsd(x.original,x.image,async()=>Buffer.from('invalid'))).rejects.toThrow('identity');
 });
 it('exclusive publication refuses existing files, directories, aliases and internal preservation paths',async()=>{
  const{root}=await setup(),file=path.join(root,'keep.psd'),bytes=Buffer.from('candidate');await fs.writeFile(file,'retained');await expect(publishPsdExclusive(file,bytes)).rejects.toThrow('已存在');expect(await fs.readFile(file,'utf8')).toBe('retained');
  const dir=path.join(root,'folder.psd');await fs.mkdir(dir);await expect(publishPsdExclusive(dir,bytes)).rejects.toThrow('已存在');
  const alias=path.join(root,'alias.psd');await fs.symlink(file,alias);await expect(publishPsdExclusive(alias,bytes)).rejects.toThrow('已存在');
  const internal=path.join(root,'.storyboard-flow');await fs.mkdir(internal);await expect(publishPsdExclusive(path.join(internal,'no.psd'),bytes)).rejects.toThrow('保管');
  const out=path.join(root,'race.psd');const results=await Promise.allSettled([publishPsdExclusive(out,Buffer.from('first')),publishPsdExclusive(out,Buffer.from('second'))]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(['first','second']).toContain(await fs.readFile(out,'utf8'));
 });
 it('uses the Windows directory-sync contract and retains unknown publication failures',async()=>{
  const {root}=await setup(),file=path.join(root,'windows.psd');
  const sync=vi.spyOn(platform,'syncDirectory').mockResolvedValue('skipped');
  try{await publishPsdExclusive(file,Buffer.from('synced file bytes'));expect(sync).toHaveBeenCalledWith(root);expect(await fs.readFile(file,'utf8')).toBe('synced file bytes');
   sync.mockRejectedValueOnce(Error('directory sync failed'));
   const failed=path.join(root,'unknown.psd');await expect(publishPsdExclusive(failed,Buffer.from('retained bytes'))).rejects.toMatchObject({effect:'unknown'});expect(await fs.readFile(failed,'utf8')).toBe('retained bytes');
   expect((await fs.readdir(root)).some(n=>n.startsWith('.flow-psd-'))).toBe(true);
  }finally{sync.mockRestore();}
 });
 it('runtime binds durable capture and retained original; cancellation and failure leave the project and destination unchanged',async()=>{
  const{root,source}=await setup(),out=path.join(root,'out');await fs.mkdir(out);
  const{root:projectRoot}=await createImageProject({source:{kind:'files',files:[path.join(source,'complex.psd')]},destinationParent:out,folderName:'Proj',name:'Proj',naming:{sceneCode:'S',artistName:'A',version:'1'}},{signal:new AbortController().signal,decideIssues:async()=> 'continue'});
  const runtime=await openFlowEditorRuntime(projectRoot),p=runtime.open().project,shot=p.shots[0],image=p.images[shot.imageId];
  const ink=await sharp({create:{width:4,height:2,channels:4,background:'#ff000080'}}).png().toBuffer(),receipt=get(await runtime.put({operationId:'ink',png:ink,width:4,height:2}));
  image.layers.push({id:'ink',name:'Drawing',kind:'paint',visible:true,locked:false,opacity:.5,blendMode:'normal',width:4,height:2,assetId:receipt.assetId});image.revision++;p.revision++;expect((await runtime.checkpoint(p)).ok).toBe(true);
  const before=await fs.readFile(path.join(projectRoot,'.storyboard-flow/checkpoints/project.json'));
  let enter!:()=>void,release!:(target:string|null)=>void;const entered=new Promise<void>(r=>enter=r);
  const cancel=runtime.exportPsd(p,shot.id,async()=>{enter();return new Promise<string|null>(r=>release=r);});
  await entered;
  try{
    expect((await runtime.put({operationId:'blocked',png:ink,width:4,height:2})).ok).toBe(false);
    expect((await runtime.checkpoint(p)).ok).toBe(false);expect((await runtime.saveTiff(p)).ok).toBe(false);expect(await runtime.certifyClose(p)).toBe(false);
  }finally{release(null);}
  expect(await cancel).toEqual({canceled:true});
  const target=path.join(root,'edited.psd'),result=await runtime.exportPsd(p,shot.id,async()=>target);expect('ok'in result&&result.ok).toBe(true);
  const digest=sha(await fs.readFile(target));const again=await runtime.exportPsd(p,shot.id,async()=>target);expect('ok'in again&&again.ok).toBe(false);expect(sha(await fs.readFile(target))).toBe(digest);
  expect(await fs.readFile(path.join(projectRoot,'.storyboard-flow/checkpoints/project.json'))).toEqual(before);
  const stale=structuredClone(p);stale.revision++;const rejected=await runtime.exportPsd(stale,shot.id,async()=>{throw Error('picker must not be called')});expect('ok'in rejected&&rejected.ok).toBe(false);
 },30000);
});
