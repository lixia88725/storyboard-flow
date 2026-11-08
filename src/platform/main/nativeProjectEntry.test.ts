import {expect,it,vi,onTestFinished} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const injected=vi.hoisted(()=>({kind:'legacy' as 'legacy'|'native'|'damaged',picked:'',dialog:vi.fn()}));
vi.mock('electron',()=>({MessageChannelMain:class{},dialog:{showOpenDialog:injected.dialog}}));
vi.mock('../../project-files/main/image-engine/workspaceProbe.js',()=>{
 class LegacyImageWorkspaceProjectError extends Error{constructor(readonly root:string){super('legacy');}}
 return {LegacyImageWorkspaceProjectError,
 probeImageWorkspaceProject:async(root:string)=>{if(injected.kind==='legacy')throw new LegacyImageWorkspaceProjectError(root);return{kind:'native',root,format:'journal',identity:{id:'project',name:'Example'}};},
 inspectImageWorkspaceFolder:async(root:string)=>injected.kind==='native'?{kind:'native',plan:{kind:'native',root,format:'journal',identity:{id:'project',name:'Example'}}}:injected.kind==='legacy'?{kind:'legacy'}:{kind:'damaged',reason:'broken'}
};});
import {registerNativeProjectEntry} from './nativeProjectEntry';
import type {ImageWorkspaceRuntime} from '../../project-files/main/image-engine/workspaceRuntimeContract';
async function fixture(kind:'legacy'|'native'|'damaged',initial=false,closeDuringInit=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'flow-native-entry-'));onTestFinished(()=>fs.rm(root,{recursive:true,force:true}));
 const project=path.join(root,'project');await fs.mkdir(path.join(project,'.storyboard-flow'),{recursive:true});
 injected.kind=kind;injected.picked=project;injected.dialog.mockReset();injected.dialog.mockResolvedValue({canceled:false,filePaths:[project]});
 const routes=new Map<string,Function>(),owner={sessionId:'s',incarnation:'i',workspaceEpoch:1},create=vi.fn(async()=>{throw Error('unexpected creation');});
 const runtime={open:()=>({snapshot:{owner,session:{project:{name:'Example'}}}}),subscribe:()=>()=>{},dispose:vi.fn()} as unknown as ImageWorkspaceRuntime;
 const open=vi.fn(async()=>runtime),window={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:vi.fn()},close:vi.fn(),destroy:vi.fn()};
 const entry=await registerNativeProjectEntry({ipc:{handle:(key:string,fn:Function)=>routes.set(key,fn),removeHandler:(key:string)=>routes.delete(key)} as never,window:window as never,userData:path.join(root,'profile'),requestedRoot:initial?project:'--choose',caller:event=>{if(!(event as unknown as {trusted:boolean}).trusted)throw Error('untrusted');},open,report:()=>{},onRegistered:p=>{if(closeDuringInit)expect(p.requestClose()).toBe(true);},creation:{createProject:create,createBlankProject:create,inspectUpgrade:async()=>({projectId:'project',projectName:'Example',sourceDigest:'a'.repeat(64),activeBoards:2,pendingBoards:1,issues:[]}),copyUpgrade:async()=>{throw Error('unexpected upgrade');}}});
 onTestFinished(()=>entry.disposeBridge());
 return{entry,open,create,owner,routes,window,invoke:(name:string,...args:unknown[])=>routes.get('flow-editor:'+name)!({trusted:true},...args)};
}
it('routes a CLI legacy project to explicit copy creation without opening a writable native owner',async()=>{
 const h=await fixture('legacy',true),state=await h.invoke('launcher-state');
 expect(state).toMatchObject({engine:'native',open:false,upgradeDraft:{kind:'copy-upgrade',activeBoards:2,pendingBoards:1,originalPreserved:true}});
 expect(h.open).not.toHaveBeenCalled();expect(h.create).not.toHaveBeenCalled();
});
it('uses the same copy flow for a picked legacy project, with window authentication before picker effects',async()=>{
 const h=await fixture('legacy');expect(()=>h.routes.get('flow-editor:choose-open')!({trusted:false})).toThrow('untrusted');expect(injected.dialog).not.toHaveBeenCalled();
 expect(await h.invoke('choose-open')).toMatchObject({kind:'copy-upgrade',draft:{originalPreserved:true}});expect(h.open).not.toHaveBeenCalled();
});
it('refuses a stale owner before looking up or creating a new draft',async()=>{
 const h=await fixture('native',true);
 await expect(h.invoke('launch',{kind:'create',draftId:'untrusted-draft'},{...h.owner,incarnation:'old'})).rejects.toThrow('归属');
 expect(h.create).not.toHaveBeenCalled();expect(h.open).toHaveBeenCalledOnce();
});
it('also routes an existing recent project to the copy sheet without retiring the current owner',async()=>{
 const h=await fixture('native',true),state=await h.invoke('launcher-state');injected.kind='legacy';
 const result=await h.invoke('launch',{kind:'recent',id:state.currentId},h.owner);
 expect(result).toMatchObject({canceled:false,kind:'copy-upgrade',draft:{originalPreserved:true}});
 expect(h.entry.workspace.current()).not.toBeNull();expect(h.open).toHaveBeenCalledOnce();
});
it('does not downgrade a damaged project to an image-import draft',async()=>{
 const h=await fixture('damaged');await expect(h.invoke('choose-open')).rejects.toThrow('数据不完整');expect(h.open).not.toHaveBeenCalled();expect(h.create).not.toHaveBeenCalled();
});

it('retains a close requested during CLI initialization until the native renderer is ready',async()=>{
 const h=await fixture('native',true,true);expect(h.window.close).not.toHaveBeenCalled();
 await h.invoke('native-window-ready');await new Promise(r=>setImmediate(r));expect(h.window.close).toHaveBeenCalledOnce();
});
it('authenticates retained-project recovery and provides a reachable recovery result',async()=>{
 const h=await fixture('legacy');expect(()=>h.routes.get('flow-editor:recover-native-projects')!({trusted:false})).toThrow('untrusted');
 expect(await h.invoke('recover-native-projects')).toEqual({ok:true,remaining:0});
});
it('keeps a damaged CLI project in the launcher with an explicit error instead of orphaning the window',async()=>{
 const h=await fixture('damaged',true);expect(await h.invoke('launcher-state')).toMatchObject({open:false,initialIssue:expect.stringContaining('数据不完整')});expect(h.open).not.toHaveBeenCalled();
});
