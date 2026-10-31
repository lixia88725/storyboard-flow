import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryWorkspace } from '../../test/temporaryWorkspace';
import { assertOutputLedgerBudget, orderedOutputNames, prepareOutputRename, settleOutputRename, preflightOutputNames, validOutputRename } from './flowOutputRename';
async function fixture(){
 const root=await temporaryWorkspace('flow-rename-');
 const entries=[];
 for(const [id,name] of [['a','0010.tif'],['b','0020.tif']]){
  await fs.writeFile(path.join(root,name),id);
  entries.push({shotId:id,name,current:createHash('sha256').update(id).digest('hex')});
 }
 const names=new Map([['a','0020.tif'],['b','0010.tif']]);
 await preflightOutputNames(root,entries,names);
 return {root,entries,names,plan:(await prepareOutputRename(root,entries,names))!};
}
it('recovers a persisted batch after every source was staged and phase persistence failed',async()=>{
 const {root,plan}=await fixture();const original=structuredClone(plan);
 await expect(settleOutputRename(root,plan,async()=>{throw Error('ledger failure')},async()=>{})).rejects.toThrow('ledger failure');
 // Disk still has stage intent; idempotent restaging verifies the existing inode.
 const recovered=structuredClone(original);
 await settleOutputRename(root,recovered,async()=>{},async()=>{});
 expect(await fs.readFile(path.join(root,'0010.tif'),'utf8')).toBe('b');
 expect(await fs.readFile(path.join(root,'0020.tif'),'utf8')).toBe('a');
 expect((await fs.readdir(root)).sort()).toEqual(['0010.tif','0020.tif']);
});
it('recovers partial publication and refuses replaced destination even with identical bytes',async()=>{
 const {root,plan}=await fixture();
 await expect(settleOutputRename(root,plan,async()=>{throw Error('stop after staging')},async()=>{})).rejects.toThrow();
 const first=plan.files[0];await fs.link(path.join(root,first.stage),path.join(root,first.to));await fs.unlink(path.join(root,first.stage));
 const second=plan.files[1];await fs.writeFile(path.join(root,second.to),'b');
 await expect(settleOutputRename(root,plan,async()=>{},async()=>{})).rejects.toThrow('identity changed');
 expect(await fs.readFile(path.join(root,second.stage),'utf8')).toBe('b');
 await fs.unlink(path.join(root,second.to));await settleOutputRename(root,plan,async()=>{},async()=>{});
 expect(await fs.readFile(path.join(root,'0010.tif'),'utf8')).toBe('b');
});
it('rejects path traversal, duplicate destinations and corrupt rename journals',async()=>{
 const {plan}=await fixture();expect(validOutputRename(plan)).toBe(true);
 const altered=structuredClone(plan);altered.files[0].stage='../outside.tif';expect(validOutputRename(altered)).toBe(false);
 const duplicate=structuredClone(plan);duplicate.files[0].to=duplicate.files[1].to;expect(validOutputRename(duplicate)).toBe(false);
});

it('normalizes unsafe leading dots and empty sanitized fields before publishing a journal',async()=>{
 const project={name:'...',naming:{sceneCode:'/',artistName:'*',version:'?'},shots:[{id:'a'}],parkedShots:[]} as unknown as import('../shared/refactorV1').ProjectV1;
 expect(orderedOutputNames(project,[{shotId:'a',name:'source.tif',current:null}]).get('a')).toBe('project_scene_stb_artist_v001_0010.tif');
});

it('keeps case-sensitive shot IDs distinct in a durable rename plan',async()=>{
 const {root,entries,names}=await fixture();entries[1].shotId='A';names.delete('b');names.set('A','0010.tif');
 const plan=(await prepareOutputRename(root,entries,names))!;expect(validOutputRename(plan)).toBe(true);
 await settleOutputRename(root,plan,async()=>{},async()=>{});
 expect(await fs.readFile(path.join(root,'0010.tif'),'utf8')).toBe('b');
});
it('reserves long-name batch journal capacity before any output work',()=>{
 const entries=Array.from({length:10000},(_,i)=>({shotId:String(i),name:'s'.repeat(230)+i+'.tif',current:'0'.repeat(64)}));
 const names=new Map(entries.map(e=>[e.shotId,'t'.repeat(230)+e.shotId+'.tif']));
 expect(()=>assertOutputLedgerBudget({entries},names)).toThrow('transaction budget');
 expect(()=>assertOutputLedgerBudget({entries:entries.slice(0,1000)},names)).not.toThrow();
});
it('checks unchanged active destination names for case-folded foreign entries',async()=>{
 const {root,entries}=await fixture();const names=new Map(entries.map(e=>[e.shotId,e.name]));
 // Names differing by case require a case-sensitive volume. Mock only the directory
 // listing to exercise its policy on this Mac; real file mutation is not claimed.
 const readdir=vi.spyOn(fs,'readdir').mockResolvedValue(['0010.tif','0020.tif','0010.TIF'] as never);
 try {await expect(preflightOutputNames(root,entries,names)).rejects.toThrow('collision');}finally{readdir.mockRestore()}
});
