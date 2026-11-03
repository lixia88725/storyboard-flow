import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createFlowWorkspace } from './flowWorkspace';
import { openFlowEditorRuntime } from './flowEditorRuntime';
import { openFlowAssetDepot } from './persistence/depot';
import { createProjectStore } from './persistence';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
const get = <T>(r: {ok:true;value:T}|{ok:false;error:{message:string}}):T => { if(!r.ok) throw Error(r.error.message); return r.value; };
async function fixture() {
 const base=await temporaryWorkspace('flow-switch-'), root=path.join(base,'a'), other=path.join(base,'b');await fs.mkdir(root);
 const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:100,maxPngBytes:10000}));
 const png=await sharp({create:{width:4,height:4,channels:4,background:'#fff'}}).png().toBuffer();
 const asset=get(await depot.put({operationId:'seed',png,width:4,height:4}));
 const project:ProjectV1={schema:'storyboard-flow.project',version:1,id:'same-project',revision:0,name:'test',shots:[{id:'shot',imageId:'image',name:'one',scriptText:''}],parkedShots:[],dialogues:[],images:{image:{id:'image',revision:0,width:4,height:4,layers:[{id:'layer',name:'paint',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:4,height:4,assetId:asset.assetId}]}}};
 get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
 await fs.cp(root,other,{recursive:true});
 const runtime=await openFlowEditorRuntime(root), workspace=createFlowWorkspace({root,runtime});
 return {root,other,runtime,workspace,project,png,assetId:asset.assetId,token:workspace.open().sessionId};
}
it('switches copied same-ID projects and rejects every old capability, including after returning to A',async()=>{
 const f=await fixture();
 const b=await f.workspace.switchProject(f.token,f.project,async()=>({root:f.other,runtime:await openFlowEditorRuntime(f.other)}));
 expect(b?.project.id).toBe(f.project.id);expect(b?.sessionId).not.toBe(f.token);
 for(const invoke of [()=>f.workspace.read(f.token,f.assetId),()=>f.workspace.put(f.token,{operationId:'late',png:f.png,width:4,height:4}),()=>f.workspace.checkpoint(f.token,f.project),()=>f.workspace.saveTiff(f.token,f.project),()=>f.workspace.certifyClose(f.token,f.project)])expect(invoke).toThrow('Stale');
 expect((await f.runtime.checkpoint(f.project)).ok).toBe(false);
 const edited=structuredClone(f.project);edited.revision++;edited.shots[0].scriptText='B only';
 expect((await f.workspace.checkpoint(b!.sessionId,edited)).ok).toBe(true);
 const a=await f.workspace.switchProject(b!.sessionId,edited,async()=>({root:f.root,runtime:await openFlowEditorRuntime(f.root)}));
 expect(a?.sessionId).not.toBe(f.token);expect(a?.project.shots[0].scriptText).toBe('');
 expect(()=>f.workspace.read(f.token,f.assetId)).toThrow('Stale');
 expect(get(await createProjectStore().loadCheckpoint(f.other)).project.shots[0].scriptText).toBe('B only');
});
it('cancel, same root and failed preparation preserve the original writable session',async()=>{
 const f=await fixture();
 expect(await f.workspace.switchProject(f.token,f.project,async()=>null)).toBeNull();
 expect(await f.workspace.switchProject(f.token,f.project,async()=>({root:f.root,runtime:f.runtime}))).toBeNull();
 await expect(f.workspace.switchProject(f.token,f.project,async()=>{throw Error('invalid project')})).rejects.toThrow('invalid project');
 expect(f.workspace.open().sessionId).toBe(f.token);
 expect((await f.workspace.checkpoint(f.token,f.project)).ok).toBe(true);
});
it('failed durable certification does not retire the old owner',async()=>{
 const f=await fixture(), changed=structuredClone(f.project);changed.revision++;
 await expect(f.workspace.switchProject(f.token,changed,async()=>({root:f.other,runtime:await openFlowEditorRuntime(f.other)}))).rejects.toThrow('Checkpoint verification');
 expect(f.workspace.open().sessionId).toBe(f.token);
 expect((await f.workspace.checkpoint(f.token,changed)).ok).toBe(true);
});
it('holds a single transition and refuses newly arriving writes or Close until selection settles',async()=>{
 const f=await fixture();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve});
 const switching=f.workspace.switchProject(f.token,f.project,async()=>{await gate;return null});
 expect(()=>f.workspace.checkpoint(f.token,f.project)).toThrow('transitioning');
 expect(()=>f.workspace.certifyClose(f.token,f.project)).toThrow('transitioning');
 await expect(f.workspace.switchProject(f.token,f.project,async()=>null)).rejects.toThrow('transitioning');
 release();await switching;
 expect((await f.workspace.checkpoint(f.token,f.project)).ok).toBe(true);
});
it('an admitted in-flight write prevents certification; switching can be retried after it settles',async()=>{
 const f=await fixture();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve});
 const checkpoint=f.runtime.checkpoint.bind(f.runtime);let pending=true;
 const runtime={...f.runtime,certifyClose:async(project:ProjectV1|null)=>pending?false:f.runtime.certifyClose(project)};
 const workspace=createFlowWorkspace({root:f.root,runtime});
 const write=(async()=>{await gate;await checkpoint(f.project);pending=false})();
 await expect(workspace.switchProject(f.token,f.project,async()=>({root:f.other,runtime:await openFlowEditorRuntime(f.other)}))).rejects.toThrow('Checkpoint verification');
 release();await write;
 expect(await workspace.switchProject(f.token,f.project,async()=>({root:f.other,runtime:await openFlowEditorRuntime(f.other)}))).not.toBeNull();
});
