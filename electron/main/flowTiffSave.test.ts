import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../test/temporaryWorkspace';
import { createTiffCodec } from '../core/formats/index';
import { openFlowTiffSave } from './flowTiffSave';
import type { ProjectV1 } from '../shared/refactorV1';
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const codec = () => createTiffCodec({ scriptPath: path.resolve('electron/core/formats/codec.py'), depsDir: path.resolve('vendor/python/photoshop-tiff') });
const value = <T>(r: {ok:true;value:T}|{ok:false;error:{message:string}}) => { if(!r.ok)throw Error(r.error.message);return r.value; };
async function fixture(two = false) {
  const root=await temporaryWorkspace('flow-output-');
  const png=await sharp({create:{width:2,height:1,channels:4,background:'#fff'}}).png().toBuffer();
  const p:ProjectV1={schema:'storyboard-flow.project',version:1,id:'project',name:'中文',revision:0,shots:[{id:'shot',imageId:'image',name:'镜头',scriptText:''}],parkedShots:[],dialogues:[],images:{image:{id:'image',revision:0,width:2,height:1,layers:[{id:'layer',name:'底层',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:2,height:1,assetId:hash(png)}]}}};
  if(two){p.images.image2={...structuredClone(p.images.image),id:'image2'};p.shots.push({id:'second',imageId:'image2',name:'Two',scriptText:''});}
  const c=codec();const source=value(await c.encode({image:p.images.image,text:null},async()=>png));
  await fs.writeFile(path.join(root,'original.tif'),source);
  if(two)await fs.writeFile(path.join(root,'second.tif'),source);
  const output=await openFlowTiffSave(root,p.id,c);
  await output.bindSources(p,[{shotId:'shot',name:'original.tif',digest:hash(source)},...(two?[{shotId:'second',name:'second.tif',digest:hash(source)}]:[])]);
  return {root,p,png,c,source,output};
}
describe('new TIFF output native Save protocol',()=>{
  it('saves captured pixels/text, preserves first backup through repeated Save and Undo output, and reopens ledger',async()=>{
    const {root,p,png,c,source,output}=await fixture();
    const edit=await sharp({create:{width:2,height:1,channels:4,background:'#112233'}}).png().toBuffer();
    p.revision=1;p.images.image.revision=1;p.images.image.layers[0].assetId=hash(edit);p.shots[0].scriptText='保存';
    const receipt=await output.save(p,async()=>edit);expect(receipt.revision).toBe(1);
    const decoded=value(await c.decode(await fs.readFile(path.join(root,'original.tif'))));expect(decoded.text?.scriptText).toBe('保存');
    expect(await sharp(decoded.image.layers[0].png).raw().toBuffer()).toEqual(await sharp(edit).raw().toBuffer());
    const backup=path.join(root,'.storyboard-flow/originals/shot.tif');expect(await fs.readFile(backup)).toEqual(Buffer.from(source));
    await output.save(p,async()=>edit);expect(await fs.readFile(backup)).toEqual(Buffer.from(source));
    p.revision=2;p.images.image.revision=0;p.images.image.layers[0].assetId=hash(png);
    const reopened=await openFlowTiffSave(root,p.id,c);await reopened.save(p,async()=>png);
    expect(await fs.readFile(backup)).toEqual(Buffer.from(source));
    const undo=value(await c.decode(await fs.readFile(path.join(root,'original.tif'))));
    expect(await sharp(undo.image.layers[0].png).raw().toBuffer()).toEqual(await sharp(png).raw().toBuffer());
  },60000);
  it('refuses external edits and lifecycle changes without replacing files',async()=>{
    const {root,p,png,source,output}=await fixture();const file=path.join(root,'original.tif');
    await fs.writeFile(file,'external');await expect(output.save(p,async()=>png)).rejects.toThrow('outside Flow');expect(await fs.readFile(file,'utf8')).toBe('external');
    await fs.writeFile(file,source);p.parkedShots=p.shots;p.shots=[];
    await expect(output.save(p,async()=>png)).rejects.toThrow('lifecycle');expect(await fs.readFile(file)).toEqual(Buffer.from(source));
  },60000);
  it('snapshots before await and admits no output when pixel preparation fails',async()=>{
    const {root,p,png,source,output}=await fixture();const file=path.join(root,'original.tif');
    await expect(output.save(p,async()=>{throw Error('missing');})).rejects.toThrow();expect(await fs.readFile(file)).toEqual(Buffer.from(source));
    let release!:()=>void;const gate=new Promise<void>(r=>release=r);
    const saved=output.save(p,async()=>{await gate;return png;});p.shots[0].scriptText='later edit';p.revision=9;release();
    const receipt=await saved;expect(receipt.revision).toBe(0);
    const decoded=value(await codec().decode(await fs.readFile(file)));expect(decoded.text?.scriptText).toBe('');
  },60000);
  it('retains a partial native failure with no successful receipt, and a reopen can retry known pending bytes',async()=>{
    const {root,p,png,c,source,output}=await fixture(true);p.shots[0].scriptText='first output';
    const second=path.join(root,'second.tif');await fs.chmod(second,0o444);
    try {
      await expect(output.save(p,async()=>png)).rejects.toThrow();
      expect(await fs.readFile(path.join(root,'original.tif'))).not.toEqual(Buffer.from(source));
      expect(await fs.readFile(second)).toEqual(Buffer.from(source));
      const ledger=JSON.parse(await fs.readFile(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8'));
      expect(ledger.saved).toBeUndefined();
      expect(await fs.readFile(path.join(root,'.storyboard-flow/originals/shot.tif'))).toEqual(Buffer.from(source));
    } finally { await fs.chmod(second,0o644); }
    const reopened=await openFlowTiffSave(root,p.id,c);expect((await reopened.save(p,async()=>png)).files).toHaveLength(2);
  },60000);

  it('refuses a missing or altered original backup after first output without changing the TIFF',async()=>{
    const {root,p,png,output}=await fixture();
    await output.save(p,async()=>png);
    const file=path.join(root,'original.tif'), backup=path.join(root,'.storyboard-flow/originals/shot.tif');
    const saved=await fs.readFile(file), original=await fs.readFile(backup);
    await fs.writeFile(backup,'corrupt');
    await expect(output.save(p,async()=>png)).rejects.toThrow('backup mismatch');
    expect(await fs.readFile(file)).toEqual(saved);
    await fs.unlink(backup);
    await expect(output.save(p,async()=>png)).rejects.toThrow('Missing original backup');
    expect(await fs.readFile(file)).toEqual(saved);
    await fs.writeFile(backup,original);
  },60000);

});
