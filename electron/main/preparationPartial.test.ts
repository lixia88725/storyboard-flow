import {test,expect,onTestFinished} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createWorkspaceRecoveryStore} from './workspaceRecoveryStore';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4zyD3HwAFPAIdh7bqkQAAAABJRU5ErkJggg==','base64');
test('first preparation sidecar partial with no seal permits latest finite content, never inventory retirement or original deletion',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'partial-prep-'));onTestFinished(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const caller={sender:{},frame:{},window:{},document:{}},budget={bytes:100000,records:150,assets:10,jsonDepth:20};
 const offer={revision:'g1',projectRaw:{text:'latest RAM'},viewState:{},scriptState:{},effectFacts:{sourceEffects:0,sidecarEffects:'partial'},continuationState:{notExecutable:true},assets:[{assetId:'pixels',bytes:png,role:'desired',width:1,height:1,encoding:'png'}],requiredAssetIds:['pixels']};
 const failing=createWorkspaceRecoveryStore({authorize:async()=>{},budget,fault:async(phase,file)=>{if(phase==='written'&&file.includes('/assets/'))throw new Error('partial');}});
 await expect(failing.retain(caller,root,offer)).rejects.toThrow('partial');
 const partialRoot=path.join(root,'.storyboard-workbench/workspace-recovery-v1');const before=await fs.readdir(partialRoot);
 const safe=createWorkspaceRecoveryStore({authorize:async()=>{},budget,allowUnsealedStart:true} as any);
 const ack=await safe.retain(caller,root,{...offer,revision:'close:g2'});expect(ack.revision).toBe('close:g2');
 const state=await safe.inspectReadonly(root);expect(state.state).toBe('protectedIncomplete');expect(state.content?.projectRaw).toEqual(offer.projectRaw);expect(await safe.readAsset(root,ack.generationId,'pixels')).toEqual(png);for(const item of before)expect(await fs.lstat(path.join(partialRoot,item))).toBeTruthy();
});
