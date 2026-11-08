import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
vi.mock('electron',()=>({MessageChannelMain:class{}}));
import {registerImageWorkspaceIpc} from './imageWorkspaceIpc';
import type {ImageWorkspaceRuntime,ImageWorkspaceFrameTransport} from '../../project-files/main/image-engine/workspaceRuntimeContract';
import type {ImageWorkspaceEvent} from '../contracts/imageWorkspace';
class Port extends EventEmitter{messages:unknown[]=[];closed=false;started=false;start(){this.started=true;}postMessage(v:unknown){this.messages.push(v);}close(){if(this.closed)return;this.closed=true;this.emit('close');}}
const owner={sessionId:'s',incarnation:'i',workspaceEpoch:1},identity={owner,nonce:'n',streamGeneration:1};
function setup(){
 const routes=new Map<string,Function>(),events:unknown[]=[],transfers:unknown[]=[],ports:Port[]=[];
 const ipc={handle:(name:string,fn:Function)=>routes.set(name,fn),removeHandler:(name:string)=>routes.delete(name)};
 const window={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:(...args:unknown[])=>events.push(args),postMessage:(...args:unknown[])=>transfers.push(args)}};
 const adapter=registerImageWorkspaceIpc({ipc:ipc as never,window:window as never,caller:event=>{if(!(event as unknown as {trusted:boolean}).trusted)throw Error('wrong window');},channel:()=>{const port1=new Port(),port2=new Port();ports.push(port1,port2);return{port1,port2} as never;}});
 let subscriber:((e:ImageWorkspaceEvent)=>void)|undefined;
 const runtime={open:vi.fn(()=>({frames:identity})),input:vi.fn(()=>({kind:'admitted'})),request:vi.fn(),waitOperation:vi.fn(),thumbnail:vi.fn(),subscribe:(fn:(e:ImageWorkspaceEvent)=>void)=>{subscriber=fn;return()=>{subscriber=undefined;};},connectFrames:vi.fn(async()=>{})} as unknown as ImageWorkspaceRuntime;
 adapter.bind(runtime);
 const invoke=(name:string,...args:unknown[])=>routes.get('flow-image-workspace:'+name)!({trusted:true},...args);
 return{routes,events,transfers,ports,adapter,runtime,invoke,emit:(e:ImageWorkspaceEvent)=>subscriber?.(e)};
}
describe('native workspace Electron adapter',()=>{
 it('authenticates the exact window before invoking a runtime and forwards full input identity',()=>{
  const h=setup();expect(()=>h.routes.get('flow-image-workspace:bootstrap')!({trusted:false})).toThrow('wrong window');expect(h.runtime.open).not.toHaveBeenCalled();
  const input={kind:'end',operationId:'op',throughSeq:2},trace={captureId:'capture',inputId:'input',attemptId:'attempt'};
  h.invoke('input',owner,input,trace);expect(h.runtime.input).toHaveBeenCalledWith(owner,input,trace);h.adapter.dispose();expect(h.routes.size).toBe(0);
 });
 it('transfers the renderer port before waiting for its ready acknowledgement',async()=>{
  const h=setup();let transport:ImageWorkspaceFrameTransport|undefined;
  vi.mocked(h.runtime.connectFrames).mockImplementation((_identity,value)=>{transport=value;return new Promise<void>(resolve=>{value.subscribe(reply=>{if(reply.kind==='ready')resolve();});});});
  const connected=h.invoke('connect',identity);expect(h.transfers).toHaveLength(1);expect(h.ports[0].started).toBe(true);
  h.ports[0].emit('message',{data:{...identity,kind:'ready'}});await connected;
  transport!.close();expect(h.ports[0].closed).toBe(true);h.adapter.dispose();
 });
 it('closes both port ends when the runtime refuses a connection',async()=>{
  const h=setup();vi.mocked(h.runtime.connectFrames).mockRejectedValue(Error('stale owner'));
  await expect(h.invoke('connect',identity)).rejects.toThrow('stale owner');expect(h.ports.every(p=>p.closed)).toBe(true);h.adapter.dispose();
 });
 it('forwards only the bound runtime events and closes prior display ports on rebind',async()=>{
  const h=setup();await h.invoke('connect',identity);h.emit({kind:'fault',owner,error:{code:'x',message:'x',effect:'none'}});expect(h.events.length).toBe(1);
  h.adapter.bind(null);expect(h.ports[0].closed).toBe(true);h.emit({kind:'fault',owner,error:{code:'x',message:'x',effect:'none'}});expect(h.events.length).toBe(1);expect(()=>h.invoke('bootstrap')).toThrow('请先打开项目');h.adapter.dispose();
 });
});
