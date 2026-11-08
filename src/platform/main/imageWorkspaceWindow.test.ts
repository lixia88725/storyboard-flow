import {expect,it,vi} from 'vitest';
vi.mock('electron',()=>({MessageChannelMain:class{}}));
import {registerImageWorkspaceWindow} from './imageWorkspaceWindow';
import type {ImageWorkspaceRuntime,ImageWorkspaceProjectPlan} from '../../project-files/main/image-engine/workspaceRuntimeContract';
import type {ImageWorkspaceRequest} from '../contracts/imageWorkspace';
const owner={sessionId:'session',incarnation:'instance',workspaceEpoch:1};
const plan:ImageWorkspaceProjectPlan={kind:'native',root:'/fixture/root',format:'journal',identity:{id:'project',name:'project'}};
function setup(){
 const routes=new Map<string,Function>(),sent:unknown[][]=[],deferred:(()=>void)[]=[],calls:string[]=[];
 const destroy=vi.fn(),report=vi.fn();let releaseFails=false;
 const runtime={open:()=>({snapshot:{owner}}),subscribe:()=>()=>{},
  request:async({command}:ImageWorkspaceRequest)=>{calls.push(command.kind);return command.kind==='prepareClose'?{kind:'closePrepared',ticket:'ticket'}:{kind:'closed'};},
  dispose:async()=>{calls.push('dispose');if(releaseFails)throw Error('release failed');}
 } as unknown as ImageWorkspaceRuntime;
 const ipc={handle:(key:string,fn:Function)=>routes.set(key,fn),removeHandler:(key:string)=>routes.delete(key)};
 const window={isDestroyed:()=>false,destroy,webContents:{isDestroyed:()=>false,send:(...args:unknown[])=>sent.push(args)}};
 const adapter=registerImageWorkspaceWindow({ipc:ipc as never,window:window as never,caller:event=>{if(!(event as unknown as {trusted:boolean}).trusted)throw Error('untrusted');},open:async()=>runtime,report,defer:task=>deferred.push(task)});
 const finish=(id:string,ticket='ticket')=>routes.get('flow-editor:finish-native-close')!({trusted:true},owner,id,ticket);
 return{adapter,routes,sent,calls,destroy,report,deferred,finish,failRelease:(value:boolean)=>{releaseFails=value;}};
}
it('permits empty launcher close but requires renderer drain and Main certification for an open project',async()=>{
 const h=setup();expect(h.adapter.requestClose()).toBe(false);await h.adapter.launch(plan);
 expect(h.adapter.requestClose()).toBe(true);h.adapter.requestClose();expect(h.sent).toHaveLength(2);expect(h.sent[1][1]).toBe(h.sent[0][1]);
 expect(h.calls).toEqual([]);expect(h.destroy).not.toHaveBeenCalled();
 expect(await h.finish(h.sent[0][1] as string)).toEqual({ok:true});
 expect(h.calls).toEqual(['certifyClose','dispose']);expect(h.destroy).not.toHaveBeenCalled();
 h.deferred[0]();expect(h.destroy).toHaveBeenCalledOnce();h.adapter.disposeBridge();expect(h.routes.size).toBe(0);
});
it('rejects a foreign caller and stale close ID before touching the project',async()=>{
 const h=setup();await h.adapter.launch(plan);h.adapter.requestClose();
 await expect(h.routes.get('flow-editor:finish-native-close')!({trusted:false},owner,h.sent[0][1],'ticket')).rejects.toThrow('untrusted');
 expect(await h.finish('stale')).toMatchObject({ok:false});expect(h.calls).toEqual([]);expect(h.deferred).toHaveLength(0);
});
it('does not destroy the window when certified resource release fails; a new close retries only release',async()=>{
 const h=setup();await h.adapter.launch(plan);h.adapter.requestClose();h.failRelease(true);
 expect(await h.finish(h.sent[0][1] as string)).toMatchObject({ok:false});expect(h.deferred).toHaveLength(0);
 h.failRelease(false);h.adapter.requestClose();expect(h.sent).toHaveLength(2);
 expect(await h.finish(h.sent[1][1] as string)).toEqual({ok:true});expect(h.calls).toEqual(['certifyClose','dispose','dispose']);
});
