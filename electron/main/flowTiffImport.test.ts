import { describe,it,expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../test/temporaryWorkspace';
import { createTiffCodec, type TiffCodec } from '../core/formats/index';
import { createProjectStore } from '../core/persistence';
import { importFlowTiffFolder } from './flowTiffImport';
import { openFlowTiffSave } from './flowTiffSave';
import type { ImageDocumentV1 } from '../shared/refactorV1';
const get=<T>(r:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const codec=()=>createTiffCodec({scriptPath:path.resolve('electron/core/formats/codec.py'),depsDir:path.resolve('vendor/python/photoshop-tiff')});
async function fixture(){
 const root=await temporaryWorkspace('flow-folder-import-');
 const png=await sharp({create:{width:4,height:3,channels:4,background:'#123456'}}).png().toBuffer();
 const image:ImageDocumentV1={id:'shared-image',revision:4,width:4,height:3,layers:[{id:'layer',name:'图层',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:4,height:3,assetId:createHash('sha256').update(png).digest('hex')}]};
 const original=get(await codec().encode({image,text:{projectId:'foreign-project',projectName:'foreign',shotId:'shared-shot',shotName:'镜头',scriptText:'中文\n说明',dialogues:[{id:'same-dialogue',shotId:'shared-shot',text:'对白'}]}},async()=>png));
 await fs.writeFile(path.join(root,'10.tif'),original);
 return {root,png,original};
}
describe('TIFF folder to isolated editable project',()=>{
 it('imports plain/layered/Pending in natural order, remaps colliding portable IDs and preserves originals until Save',async()=>{
  const {root,png,original}=await fixture();
  await fs.writeFile(path.join(root,'2.tif'),original);await fs.mkdir(path.join(root,'Pending'));await fs.writeFile(path.join(root,'Pending/3.tif'),original);
  await promisify(execFile)('python3',[path.resolve('electron/core/formats/fixtures.py'),'plain','unused',path.join(root,'1.tiff')],{env:{...process.env,FLOW_PYTHON_DEPS_DIR:path.resolve('vendor/python/photoshop-tiff'),PYTHONDONTWRITEBYTECODE:'1'}});
  const p=await importFlowTiffFolder(root,codec());
  expect(p.shots).toHaveLength(3);expect(p.parkedShots).toHaveLength(1);
  expect(p.shots.map(s=>s.name)).toEqual(['1','镜头','镜头']);
  const all=[...p.shots,...p.parkedShots];expect(new Set(all.map(s=>s.id)).size).toBe(4);
  expect(new Set(all.map(s=>s.imageId)).size).toBe(4);expect(new Set(p.dialogues.map(d=>d.id)).size).toBe(3);
  expect(p.dialogues.every(d=>all.some(s=>s.id===d.shotId))).toBe(true);
  const store=get(await createProjectStore().loadCheckpoint(root));
  expect(await sharp(Buffer.from(await store.readAsset(p.images[p.shots[1].imageId].layers[0].assetId))).raw().toBuffer()).toEqual(await sharp(png).raw().toBuffer());
  expect(await fs.readFile(path.join(root,'2.tif'))).toEqual(Buffer.from(original));
  const ledger=JSON.parse(await fs.readFile(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8'));
  expect(ledger.entries.map((e:{name:string})=>e.name)).toEqual(['1.tiff','2.tif','10.tif','3.tif']);
  await expect(fs.stat(path.join(root,'.storyboard-flow/originals'))).rejects.toMatchObject({code:'ENOENT'});
  p.revision++;p.shots[1].scriptText='edited';
  await (await openFlowTiffSave(root,p.id,codec())).save(p,store.readAsset);
  expect(await fs.readFile(path.join(root,'.storyboard-flow/originals',p.shots[1].id+'.tif'))).toEqual(Buffer.from(original));
  expect(get(await codec().decode(await fs.readFile(path.join(root,'2.tif')))).text?.scriptText).toBe('edited');
 },60000);
 it('rejects a bad TIFF without publishing a partial project or changing any original',async()=>{
  const {root,original}=await fixture();await fs.writeFile(path.join(root,'broken.tif'),'not TIFF');
  await expect(importFlowTiffFolder(root,codec())).rejects.toThrow('Import failed');
  expect((await fs.readdir(root)).sort()).toEqual(['10.tif','broken.tif']);
  expect(await fs.readFile(path.join(root,'10.tif'))).toEqual(Buffer.from(original));
 },60000);
 it('refuses existing project data without trying to reinterpret it',async()=>{
  const {root}=await fixture();await fs.mkdir(path.join(root,'.storyboard-flow'));await fs.writeFile(path.join(root,'.storyboard-flow/keep'),'existing');
  await expect(importFlowTiffFolder(root,codec())).rejects.toThrow('already exists');
  expect(await fs.readFile(path.join(root,'.storyboard-flow/keep'),'utf8')).toBe('existing');
 });
 it('detects a source changed during decode and leaves the changed file untouched',async()=>{
  const {root}=await fixture();const c=codec();
  const changing:TiffCodec={...c,async decode(bytes){const result=await c.decode(bytes);await fs.writeFile(path.join(root,'10.tif'),'external edit');return result;}};
  await expect(importFlowTiffFolder(root,changing)).rejects.toThrow('Source changed');
  expect(await fs.readFile(path.join(root,'10.tif'),'utf8')).toBe('external edit');
  expect(await fs.readdir(root)).toEqual(['10.tif']);
 },60000);
 it.each([false,true])('never replaces a project namespace appearing during preparation (nonempty=%s)',async(nonempty)=>{
  const {root}=await fixture();const c=codec();
  const racing:TiffCodec={...c,async decode(bytes){const result=await c.decode(bytes);await fs.mkdir(path.join(root,'.storyboard-flow'));if(nonempty)await fs.writeFile(path.join(root,'.storyboard-flow/foreign'),'keep');return result;}};
  await expect(importFlowTiffFolder(root,racing)).rejects.toThrow('publication failed');
  if(nonempty)expect(await fs.readFile(path.join(root,'.storyboard-flow/foreign'),'utf8')).toBe('keep');
  expect(await fs.readdir(path.join(root,'.storyboard-flow'))).toEqual(nonempty?['foreign']:[]);
 },60000);
 it('allows only one complete namespace from simultaneous bootstrap attempts',async()=>{
  const {root}=await fixture();
  const results=await Promise.allSettled([importFlowTiffFolder(root,codec()),importFlowTiffFolder(root,codec())]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const p=get(await createProjectStore().loadCheckpoint(root)).project;
  expect(p.shots).toHaveLength(1);expect((await fs.readdir(root)).filter(n=>n.startsWith('.flow-import-'))).toEqual([]);
 },60000);
 it('refuses TIFF symlinks and duplicate root/Pending names without publication',async()=>{
  const {root}=await fixture();await fs.symlink(path.join(root,'10.tif'),path.join(root,'alias.tif'));
  await expect(importFlowTiffFolder(root,codec())).rejects.toThrow('regular file');await fs.unlink(path.join(root,'alias.tif'));
  await fs.mkdir(path.join(root,'Pending'));await fs.copyFile(path.join(root,'10.tif'),path.join(root,'Pending/10.tif'));
  await expect(importFlowTiffFolder(root,codec())).rejects.toThrow('Duplicate TIFF names');
  await expect(fs.stat(path.join(root,'.storyboard-flow'))).rejects.toMatchObject({code:'ENOENT'});
 });
});
