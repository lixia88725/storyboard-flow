import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createTiffCodec } from './formats/index';
import { prepareOutputRename, settleOutputRename } from './flowOutputRename';
import { orderedOutputNames } from '../../platform/contracts/flowNaming';
import { openFlowTiffSave } from './flowTiffSave';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const codec = () => createTiffCodec({ scriptPath: path.resolve('src/project-files/main/formats/codec.py'), depsDir: path.resolve('vendor/python/photoshop-tiff') });
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
  it('reports bound filenames for the naming preview without touching the folder',async()=>{
    const {root,p,output}=await fixture(true);
    const before=await fs.readdir(root);
    const names=await output.outputNames(p);
    expect(names.map(entry=>entry.shotId).sort()).toEqual(['second','shot']);
    expect(names.find(entry=>entry.shotId==='second')!.name).toBe('second.tif');
    expect(await fs.readdir(root)).toEqual(before);
    await expect(output.outputNames({...p,id:'other'})).rejects.toThrow('Different project');
  },60000);
  it('reserves the first unsaved Pending filename in preview without creating an output ledger',async()=>{
    const {p,png,c}=await fixture(true);
    const root=await temporaryWorkspace('flow-new-preview-'), output=await openFlowTiffSave(root,p.id,c);
    p.name='P';p.naming={sceneCode:'S',artistName:'A',version:'1'};
    const parked=p.shots.pop()!;parked.id='P_S_stb_A_v001_0010';p.parkedShots.push(parked);
    const preview=orderedOutputNames(p,await output.outputNames(p));
    expect(preview.get('shot')).toBe('P_S_stb_A_v001_0020.tif');
    await expect(fs.stat(path.join(root,'.storyboard-flow/tiff-output.json'))).rejects.toMatchObject({code:'ENOENT'});
    await output.save(p,async()=>png);
    for(const leaf of [preview.get('shot')!, 'Pending/'+parked.id+'.tif']) expect((await fs.stat(path.join(root,leaf))).isFile()).toBe(true);
  },60000);
  it('refuses an incomplete naming draft before touching the ledger or source TIFF',async()=>{
    const {root,p,source,output}=await fixture();
    const ledgerPath=path.join(root,'.storyboard-flow/tiff-output.json'), before=await fs.readFile(ledgerPath);
    p.naming={sceneCode:'scene',artistName:'',version:'v001'};
    const reader=vi.fn(async()=>{throw Error('unexpected pixel read')});
    await expect(output.save(p,reader)).rejects.toThrow('作者不能为空');
    expect(reader).not.toHaveBeenCalled();expect(await fs.readFile(ledgerPath)).toEqual(before);
    expect(await fs.readFile(path.join(root,'original.tif'))).toEqual(Buffer.from(source));
  },60000);
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
    await expect(output.save(p,async()=>png)).rejects.toThrow('System Trash capability unavailable');expect(await fs.readFile(file)).toEqual(Buffer.from(source));
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

it('applies configured ordered names, swaps them without re-encoding, keeps Pending separate and preserves originals',async()=>{
 const {root,p,png,c,source,output}=await fixture(true);
 p.naming={sceneCode:'S01',artistName:'艺术家',version:'2'};
 const prefix='中文_S01_stb_艺术家_v002_';
 const first=await output.save(p,async()=>png);
 expect(first.files.map(f=>f.name)).toEqual([prefix+'0010.tif',prefix+'0020.tif']);
 await expect(fs.stat(path.join(root,'original.tif'))).rejects.toMatchObject({code:'ENOENT'});
 const before=await Promise.all(first.files.map(f=>fs.stat(path.join(root,f.name))));
 const encoding=vi.spyOn(c,'encode'),reader=vi.fn(async()=>png);
 p.shots.reverse();p.revision++;
 const second=await output.save(p,reader);
 expect(second.files.map(f=>f.shotId)).toEqual(['second','shot']);
 expect(second.files.map(f=>f.name)).toEqual([prefix+'0010.tif',prefix+'0020.tif']);
 expect((await fs.stat(path.join(root,prefix+'0010.tif'))).ino).toBe(before[1].ino);
 expect((await fs.stat(path.join(root,prefix+'0020.tif'))).ino).toBe(before[0].ino);
 expect(encoding).not.toHaveBeenCalled();expect(reader).not.toHaveBeenCalled();
 p.parkedShots.push(p.shots.shift()!);p.revision++;
 const parked=await output.save(p,reader);
 expect(parked.files.find(f=>f.shotId==='second')?.name).toBe('Pending/'+prefix+'0010.tif');
 expect(parked.files.find(f=>f.shotId==='shot')?.name).toBe(prefix+'0020.tif');
 expect(await fs.readFile(path.join(root,'.storyboard-flow/originals/shot.tif'))).toEqual(Buffer.from(source));
 expect((await fs.readdir(root)).filter(n=>n.startsWith('.flow-renaming-'))).toEqual([]);
},60000);

it('rejects a foreign final-name collision before codec preparation or any output replacement',async()=>{
 const {root,p,png,c,source,output}=await fixture();p.naming={sceneCode:'scene',artistName:'artist',version:'v001'};
 const target=path.join(root,'中文_scene_stb_artist_v001_0010.tif');await fs.writeFile(target,'unrelated');
 const encode=vi.spyOn(c,'encode');
 await expect(output.save(p,async()=>png)).rejects.toThrow('filename collision');
 expect(encode).not.toHaveBeenCalled();expect(await fs.readFile(target,'utf8')).toBe('unrelated');
 expect(await fs.readFile(path.join(root,'original.tif'))).toEqual(Buffer.from(source));
},60000);

it('reopened Save resumes a durable rename journal before interpreting old source bindings',async()=>{
 const {root,p,png,c,output}=await fixture(true);p.naming={sceneCode:'S',artistName:'A',version:'1'};
 await output.save(p,async()=>png);p.shots.reverse();p.revision++;
 const ledgerPath=path.join(root,'.storyboard-flow/tiff-output.json');
 const ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));
 ledger.rename=await prepareOutputRename(root,ledger.entries,orderedOutputNames(p,ledger.entries));delete ledger.saved;
 await fs.writeFile(ledgerPath,JSON.stringify(ledger));
 await expect(settleOutputRename(root,ledger.rename,async()=>{await fs.writeFile(ledgerPath,JSON.stringify(ledger));throw Error('interrupted after phase publication')},async()=>{})).rejects.toThrow('interrupted');
 const beforePreview=await fs.readFile(ledgerPath);
 await expect(output.outputNames(p)).rejects.toThrow('请先完成');
 expect(await fs.readFile(ledgerPath)).toEqual(beforePreview);
 const reader=vi.fn(async()=>{throw Error('unchanged TIFF must not reread PNG')});
 const result=await (await openFlowTiffSave(root,p.id,c)).save(p,reader);
 expect(result.files.map(f=>f.shotId)).toEqual(['second','shot']);
 expect(value(await c.decode(await fs.readFile(path.join(root,result.files[0].name)))).text?.shotId).toBe('second');
 expect(reader).not.toHaveBeenCalled();
 expect(JSON.parse(await fs.readFile(ledgerPath,'utf8')).rename).toBeUndefined();
 expect((await fs.readdir(root)).some(n=>n.startsWith('.flow-renaming-'))).toBe(false);
},60000);

it('deletes only at Save, retires owned TIFFs, reuses ordered names and regenerates Undo from assets',async()=>{
 const {root,p,png,c,source}=await fixture(true);
 const sink=await temporaryWorkspace('flow-trash-sink-');
 const trash=vi.fn(async(file:string)=>{await fs.rename(file,path.join(sink,path.basename(file)));});
 const output=await openFlowTiffSave(root,p.id,c,trash);
 p.naming={sceneCode:'S',artistName:'A',version:'1'};
 const before=structuredClone(p), images=structuredClone(p.images);
 const first=await output.save(p,async()=>png), removed=first.files[0].name;
 p.shots.shift();p.revision++;
 expect(await fs.readFile(path.join(root,removed))).toBeTruthy();expect(trash).not.toHaveBeenCalled();
 const next=await output.save(p,async()=>png);
 expect(next.files).toHaveLength(1);expect(next.files[0].name).toBe(removed);
 expect(value(await c.decode(await fs.readFile(path.join(root,removed)))).text?.shotId).toBe('second');
 expect(trash).toHaveBeenCalledTimes(1);
 const ledger=JSON.parse(await fs.readFile(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8'));
 expect(ledger.entries.find((e:{shotId:string})=>e.shotId==='shot').retired).toBe('trashed');
 expect(p.images).toEqual(images);
 const foreign=path.join(root,'shot.tif');await fs.writeFile(foreign,'foreign TIFF at old intermediate name');
 const restored=structuredClone(before);restored.revision=2;
 const result=await (await openFlowTiffSave(root,p.id,c,trash)).save(restored,async()=>png);
 expect(result.files.map(f=>f.name)).toEqual(first.files.map(f=>f.name));
 expect(await fs.readFile(foreign,'utf8')).toBe('foreign TIFF at old intermediate name');
 expect(value(await c.decode(await fs.readFile(path.join(root,removed)))).text?.shotId).toBe('shot');
 expect(trash).toHaveBeenCalledTimes(1);
 expect(await fs.readFile(path.join(root,'.storyboard-flow/originals/shot.tif'))).toEqual(Buffer.from(source));
},60000);

it('preserves imported originals when deleting before first Save and resumes a partial multi-file Trash failure',async()=>{
 const {root,p,png,c,source}=await fixture(true);
 const sink=await temporaryWorkspace('flow-delete-import-');let fail=true;
 const trash=vi.fn(async(file:string)=>{
   if(path.basename(file)==='second.tif'&&fail)throw Error('OS rejected second');
   await fs.rename(file,path.join(sink,path.basename(file)));
 });
 const output=await openFlowTiffSave(root,p.id,c,trash);p.shots=[];p.revision++;
 await expect(output.save(p,async()=>png)).rejects.toThrow('OS rejected second');
 const file=path.join(root,'.storyboard-flow/tiff-output.json');let ledger=JSON.parse(await fs.readFile(file,'utf8'));
 expect(ledger.saved).toBeUndefined();expect(ledger.entries[0].retired).toBe('trashed');
 expect(ledger.entries[1].deletion.phase).toBe('dispatching');
 for(const id of ['shot','second'])expect(await fs.readFile(path.join(root,'.storyboard-flow/originals',id+'.tif'))).toEqual(Buffer.from(source));
 fail=false;expect((await (await openFlowTiffSave(root,p.id,c,trash)).save(p,async()=>png)).files).toEqual([]);
 expect(trash).toHaveBeenCalledTimes(3);
 ledger=JSON.parse(await fs.readFile(file,'utf8'));expect(ledger.entries.every((e:{retired:string})=>e.retired==='trashed')).toBe(true);
},60000);

it('deletes Pending output and refuses missing established output without a Trash ACK',async()=>{
 const {root,p,png,c,output}=await fixture();p.parkedShots=p.shots;p.shots=[];
 await output.save(p,async()=>png);
 const sink=await temporaryWorkspace('flow-delete-pending-'), trash=vi.fn(async(file:string)=>{await fs.rename(file,path.join(sink,'owned.tif'));});
 const save=await openFlowTiffSave(root,p.id,c,trash), file=path.join(root,'Pending/original.tif');
 const saved=await fs.readFile(file);await fs.unlink(file);p.parkedShots=[];
 await expect(save.save(p,async()=>png)).rejects.toThrow('outside Flow');expect(trash).not.toHaveBeenCalled();
 await fs.writeFile(file,saved);await save.save(p,async()=>png);expect(trash).toHaveBeenCalledTimes(1);
 await expect(fs.stat(file)).rejects.toMatchObject({code:'ENOENT'});
},60000);

it('retires an absent never-published output distinctly, without manufacturing a Trash ACK',async()=>{
 const {root,p,png,c}=await fixture();
 const file=path.join(root,'.storyboard-flow/tiff-output.json');
 const ledger=JSON.parse(await fs.readFile(file,'utf8'));
 ledger.entries.push({shotId:'unpublished',name:'unpublished.tif',original:null,current:null,pending:hash(Buffer.from('never published'))});
 await fs.writeFile(file,JSON.stringify(ledger));
 const trash=vi.fn();await (await openFlowTiffSave(root,p.id,c,trash)).save(p,async()=>png);
 expect(trash).not.toHaveBeenCalled();
 expect(JSON.parse(await fs.readFile(file,'utf8')).entries.find((e:{shotId:string})=>e.shotId==='unpublished').retired).toBe('absent-unpublished');
},60000);

it('prepares kept pixels before new deletions and accepts known pending bytes for deletion',async()=>{
 const {root,p,png,c}=await fixture(true);
 const sink=await temporaryWorkspace('flow-delete-pending-bytes-');
 const trash=vi.fn(async(file:string)=>{await fs.rename(file,path.join(sink,'owned.tif'));});
 const output=await openFlowTiffSave(root,p.id,c,trash);p.shots.shift();
 await expect(output.save(p,async()=>{throw Error('pixel failure');})).rejects.toThrow();
 expect(trash).not.toHaveBeenCalled();expect(await fs.readFile(path.join(root,'original.tif'))).toBeTruthy();
 // Save previously admitted/preserved this original, then replacement publication
 // succeeded while its ledger ACK failed. The pending digest is authoritative.
 const file=path.join(root,'.storyboard-flow/tiff-output.json');
 const ledger=JSON.parse(await fs.readFile(file,'utf8')), entry=ledger.entries[0];
 await fs.mkdir(path.join(root,'.storyboard-flow/originals'),{recursive:true});
 await fs.copyFile(path.join(root,'original.tif'),path.join(root,'.storyboard-flow/originals/shot.tif'));
 const changed=Buffer.from('known pending synthetic output');entry.pending=hash(changed);
 await fs.writeFile(file,JSON.stringify(ledger));await fs.writeFile(path.join(root,'original.tif'),changed);
 await output.save(p,async()=>png);expect(trash).toHaveBeenCalledTimes(1);
 expect(await fs.readFile(path.join(sink,'owned.tif'))).toEqual(changed);
},60000);

it('observes external changes read-only, distinguishes local edits, and does not resurrect deleted shots',async()=>{
 const {root,p,png,output}=await fixture(true);await output.save(p,async()=>png);
 const file=path.join(root,'.storyboard-flow/tiff-output.json'), ledger=await fs.readFile(file);
 const before=structuredClone(p);
 const status=(inspectDisk=false)=>output.folderStatus({project:p,inspectDisk});
 expect(await status(true)).toBe('current');
 p.revision++;expect(await status()).toBe('current');
 p.shots[0].scriptText='local';expect(await status()).toBe('pending');
 p.shots[0].scriptText=before.shots[0].scriptText;
 expect(await output.inspectExternal(p)).toEqual([]);
 await fs.writeFile(path.join(root,'original.tif'),'external bytes');
 expect(await status(true)).toBe('external');
 const observed=await output.inspectExternal(p);
 expect(observed).toEqual([{shotId:'shot',name:'original.tif',location:'active',status:'changed',digest:hash(Buffer.from('external bytes')),localOutputChanges:false}]);
 p.shots[0].scriptText='local text';expect(await status()).toBe('both');
 expect((await output.inspectExternal(p))[0].localOutputChanges).toBe(true);
 p.shots.shift();expect(await output.inspectExternal(p)).toEqual([]);
 expect(await fs.readFile(file)).toEqual(ledger);expect(p.images).toEqual(before.images);
 await expect(output.save(p,async()=>png)).rejects.toThrow('outside Flow');
 expect(await fs.readFile(path.join(root,'original.tif'),'utf8')).toBe('external bytes');
},60000);

it('detects missing and Pending TIFFs without adopting foreign additions or accepting interrupted Save state',async()=>{
 const {root,p,png,output}=await fixture();p.parkedShots=p.shots;p.shots=[];await output.save(p,async()=>png);
 await fs.writeFile(path.join(root,'foreign.tif'),'not a known shot');
 expect(await output.inspectExternal(p)).toEqual([]);
 await fs.unlink(path.join(root,'Pending/original.tif'));
 expect(await output.inspectExternal(p)).toEqual([{shotId:'shot',name:'original.tif',location:'parked',status:'missing',digest:null,localOutputChanges:false}]);
 const file=path.join(root,'.storyboard-flow/tiff-output.json'),ledger=JSON.parse(await fs.readFile(file,'utf8'));
 ledger.entries[0].pending=hash(Buffer.from('pending'));await fs.writeFile(file,JSON.stringify(ledger));
 await expect(output.inspectExternal(p)).rejects.toThrow('pending Save');
},60000);

it('budgets larger image baselines before writing any TIFF or pending journal',async()=>{
 const {root,p,png,source,output}=await fixture();
 const ledgerPath=path.join(root,'.storyboard-flow/tiff-output.json');
 const ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));
 ledger.padding='x'.repeat(8*1024*1024-8000-Buffer.byteLength(JSON.stringify(ledger)));
 await fs.writeFile(ledgerPath,JSON.stringify(ledger));const before=await fs.readFile(ledgerPath);
 const layer=p.images.image.layers[0];p.images.image.layers=Array.from({length:20},(_,i)=>({...layer,id:'layer'+i,name:'layer '+i+'x'.repeat(600)}));p.revision++;
 await expect(output.save(p,async()=>png)).rejects.toThrow('transaction budget');
 expect(await fs.readFile(path.join(root,'original.tif'))).toEqual(Buffer.from(source));
 expect(await fs.readFile(ledgerPath)).toEqual(before);
},60000);

it('deletes a parked TIFF only at Save and regenerates Pending output on Undo without a second Trash',async()=>{
 const {root,p,png,c,source,output}=await fixture();p.parkedShots=p.shots;p.shots=[];p.revision++;
 await output.save(p,async()=>png);
 const parked=path.join(root,'Pending/original.tif');
 const sink=await temporaryWorkspace('flow-delete-parked-');let moved=0;
 const trash=vi.fn(async(file:string)=>{await fs.rename(file,path.join(sink,`owned-${++moved}.tif`));});
 const save=await openFlowTiffSave(root,p.id,c,trash);
 const deleted=structuredClone(p);deleted.parkedShots=[];deleted.revision++;
 const receipt=await save.save(deleted,async()=>png);
 expect(receipt.files).toEqual([]);expect(trash).toHaveBeenCalledTimes(1);
 await expect(fs.stat(parked)).rejects.toMatchObject({code:'ENOENT'});
 const ledgerPath=path.join(root,'.storyboard-flow/tiff-output.json');
 expect(JSON.parse(await fs.readFile(ledgerPath,'utf8')).entries.find((e:{shotId:string})=>e.shotId==='shot').retired).toBe('trashed');
 expect(await fs.readFile(path.join(root,'.storyboard-flow/originals/shot.tif'))).toEqual(Buffer.from(source));

 const restored=structuredClone(p);restored.revision+=2;
 const again=await save.save(restored,async()=>png);
 expect(trash).toHaveBeenCalledTimes(1);
 const name=again.files[0].name;
 expect(name).toMatch(/^Pending\/shot-[0-9a-f-]{36}\.tif$/);
 const decoded=value(await c.decode(await fs.readFile(path.join(root,name))));
 expect(decoded.text?.shotId).toBe('shot');
 expect(await sharp(decoded.image.layers[0].png).raw().toBuffer()).toEqual(await sharp(png).raw().toBuffer());
 expect(await fs.readFile(path.join(root,'.storyboard-flow/originals/shot.tif'))).toEqual(Buffer.from(source));

 const third=await save.save(restored,async()=>png);
 expect(third.files.map(f=>f.name)).toEqual([name]);expect(trash).toHaveBeenCalledTimes(1);
},60000);
