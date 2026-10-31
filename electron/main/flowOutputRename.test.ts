import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryWorkspace } from '../../test/temporaryWorkspace';
import { orderedOutputNames, prepareOutputRename, settleOutputRename, preflightOutputNames, validOutputRename } from './flowOutputRename';
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
