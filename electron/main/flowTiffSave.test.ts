import { describe, it, expect, vi } from 'vitest';
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
    await fs.writeFile(file,source);p.shots=[];
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

  it('keeps edits logical until Save, writes Pending TIFF, restores on a later Save and retains assets/originals',async()=>{
    const {root,p,png,source,output,c}=await fixture();
    const rootFile=path.join(root,'original.tif'), parkedFile=path.join(root,'Pending/original.tif');
    const image=structuredClone(p.images);
    p.parkedShots=p.shots;p.shots=[];p.revision++;
    expect(await fs.readFile(rootFile)).toEqual(Buffer.from(source));
    await expect(fs.stat(parkedFile)).rejects.toMatchObject({code:'ENOENT'});
    const receipt=await output.save(p,async()=>png);
    expect(receipt.files[0].name).toBe('Pending/original.tif');
    await expect(fs.stat(rootFile)).rejects.toMatchObject({code:'ENOENT'});
    expect(value(await c.decode(await fs.readFile(parkedFile))).text?.shotId).toBe('shot');
    expect(p.images).toEqual(image);
    await output.save(p,async()=>png);
    p.shots=p.parkedShots;p.parkedShots=[];p.revision++;
    await expect(fs.stat(rootFile)).rejects.toMatchObject({code:'ENOENT'});
    await (await openFlowTiffSave(root,p.id,c)).save(p,async()=>png);
    await expect(fs.stat(parkedFile)).rejects.toMatchObject({code:'ENOENT'});
    expect(await fs.readFile(path.join(root,'.storyboard-flow/originals/shot.tif'))).toEqual(Buffer.from(source));
  },60000);
  it('does not overwrite unrelated Pending destinations, and retries after the collision is resolved',async()=>{
    const {root,p,png,output}=await fixture();
    await fs.mkdir(path.join(root,'Pending'));const target=path.join(root,'Pending/original.tif');
    await fs.writeFile(target,'foreign');p.parkedShots=p.shots;p.shots=[];
    await expect(output.save(p,async()=>png)).rejects.toThrow();
    expect(await fs.readFile(target,'utf8')).toBe('foreign');
    await fs.unlink(target);expect((await output.save(p,async()=>png)).files[0].name).toBe('Pending/original.tif');
  },60000);
  it.each([false,true])('recovers a persisted move after link publication (source released=%s)',async(released)=>{
    const {root,p,png,output,c}=await fixture();await output.save(p,async()=>png);
    const source=path.join(root,'original.tif'),target=path.join(root,'Pending/original.tif');
    const ledgerPath=path.join(root,'.storyboard-flow/tiff-output.json');
    const ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8')), entry=ledger.entries[0];
    const stat=await fs.lstat(source,{bigint:true});
    entry.move={from:'active',to:'parked',digest:entry.current,dev:String(stat.dev),ino:String(stat.ino)};
    delete ledger.saved;await fs.writeFile(ledgerPath,JSON.stringify(ledger));
    await fs.mkdir(path.dirname(target));await fs.link(source,target);if(released)await fs.unlink(source);
    p.parkedShots=p.shots;p.shots=[];
    await (await openFlowTiffSave(root,p.id,c)).save(p,async()=>png);
    expect((await fs.stat(target)).nlink).toBe(1);await expect(fs.stat(source)).rejects.toMatchObject({code:'ENOENT'});
    expect(JSON.parse(await fs.readFile(ledgerPath,'utf8')).entries[0].move).toBeUndefined();
  },60000);
  it('refuses an aliased Pending directory without touching its files',async()=>{
    const {root,p,png,output}=await fixture();
    const other=await temporaryWorkspace('flow-output-alias-');
    await fs.symlink(other,path.join(root,'Pending'));p.parkedShots=p.shots;p.shots=[];
    await expect(output.save(p,async()=>png)).rejects.toThrow();expect(await fs.readdir(other)).toEqual([]);
  },60000);

  it('does not read pixels or encode again for unchanged Save or membership-only moves',async()=>{
    const {root,p,png,output,c}=await fixture();await output.save(p,async()=>png);
    const encoding=vi.spyOn(c,'encode'), reader=vi.fn(async()=>png);
    const originalInode=(await fs.stat(path.join(root,'original.tif'))).ino;
    await output.save(p,reader);p.parkedShots=p.shots;p.shots=[];p.revision++;
    await output.save(p,reader);
    expect(encoding).not.toHaveBeenCalled();expect(reader).not.toHaveBeenCalled();
    expect((await fs.stat(path.join(root,'Pending/original.tif'))).ino).toBe(originalInode);
    p.parkedShots[0].scriptText='new text';await output.save(p,reader);
    expect(encoding).toHaveBeenCalledTimes(1);expect(reader).toHaveBeenCalled();
  },60000);

});
