import { expect, it } from 'vitest';
import { handleStoryboardWindowClose } from './appWindowService';
it('protected current A cannot be discarded even when NoSave is chosen', () => {
  let destroyed=0, prevented=0;
  const owner={destroy:()=>{destroyed++},webContents:{id:1,send:()=>{}}};
  handleStoryboardWindowClose({preventDefault:()=>{prevented++}}, {
    owner,closeGuardWebContentsIds:new Set([1]),createRequestId:()=> 'close',
    saveAndCloseRequests:new Map(),showMessageBoxSync:()=>1,
    // Mandatory protection authority, not a renderer unsaved boolean.
    closeProtection: {begin:()=>{prevented++;}} as never
  } as never);
  expect(destroyed).toBe(0);
  expect(prevented).toBeGreaterThan(0);
});

import { createRecoveryCloseBarrier } from './recoveryCloseBarrier';
import { createAppAppHandlers } from './appAppRuntime';
import { registerAppIpcHandlers } from './ipc/appHandlers';
const fixture=()=>{
 let id=0,destroyed=0,prompts=0,response=1; const sent:{channel:string,payload:any}[]=[];
 const sender={id:5,mainFrame:{},send:(channel:string,payload:any)=>sent.push({channel,payload})};
 const owner={webContents:sender,destroy:()=>{destroyed++}};
 const event={sender,senderFrame:sender.mainFrame} as never;
 const protection=createRecoveryCloseBarrier({requestId:()=>`r${++id}`,showMessageBox:async()=>{prompts++;return {response}},cancelled:(_w,reason)=>sent.push({channel:'cancel',payload:{reason}})});
 const handlers=createAppAppHandlers({arch:'arm64',platform:'darwin',getVersion:()=> 'test',closeGuardWebContentsIds:new Set<number>(),saveAndCloseRequests:new Map(),ownerFromSender:()=>owner,showOpenDialog:async()=>({canceled:true,filePaths:[]}) as never,openExternal:async()=>{},recoveryCloseBarrier:protection});
 const ipc=new Map<string,Function>();registerAppIpcHandlers({handle:((name:string,fn:Function)=>ipc.set(name,fn)) as never},handlers);
 const begin=()=>{handleStoryboardWindowClose({preventDefault:()=>{}},{owner,closeGuardWebContentsIds:new Set(),saveAndCloseRequests:new Map(),createRequestId:()=> 'legacy',showMessageBoxSync:()=>{throw new Error('sync prompt forbidden')},closeProtection:protection});return sent.at(-1)!.payload.requestId;};
 const result=(requestId:string,extra={})=>({requestId,captureAvailable:true,recoveryRequired:false,busy:false,hasUnsavedChanges:true,...extra});
 return {owner,event,protection,handlers,ipc,sent,begin,result,get destroyed(){return destroyed},get prompts(){return prompts},set response(v:number){response=v}};
};
it('all close first handshakes even clean-B and guard passive effect not flushed; hidden-A latch cannot be cleared',async()=>{
 const f=fixture();f.protection.observe(f.event,true);f.protection.observe(f.event,false);
 await f.ipc.get('app:finishCloseCapture')!(f.event,f.result(f.begin(),{hasUnsavedChanges:false}));
 expect(f.destroyed).toBe(0);expect(f.prompts).toBe(0);expect(f.sent.at(-1)?.channel).toBe('cancel');
});
it('ordinary current-C NoSave still works through authenticated asynchronous close',async()=>{
 const f=fixture();await f.ipc.get('app:finishCloseCapture')!(f.event,f.result(f.begin()));expect(f.destroyed).toBe(1);expect(f.prompts).toBe(1);
});
it('wrong window/frame cannot spend a capture request; navigation and replay lose authority',async()=>{
 const f=fixture(),id=f.begin();
 await expect(f.ipc.get('app:finishCloseCapture')!({sender:{id:5,mainFrame:{}},senderFrame:{}},f.result(id))).rejects.toThrow('caller');
 await expect(f.ipc.get('app:finishCloseCapture')!({sender:f.owner.webContents,senderFrame:{}},f.result(id))).rejects.toThrow('caller');
 f.protection.invalidateDocument(f.owner);
 await expect(f.ipc.get('app:finishCloseCapture')!(f.event,f.result(id))).rejects.toThrow('caller');expect(f.destroyed).toBe(0);
});
it('Save B true cannot destroy newly held A; direct saved payload before save stage cannot close',async()=>{
 const f=fixture();f.response=0;const id=f.begin();
 expect(()=>f.ipc.get('app:finishSaveAndClose')!(f.event,{requestId:id,saved:true})).toThrow('stage');
 await f.ipc.get('app:finishCloseCapture')!(f.event,f.result(id));
 f.protection.observe(f.event,true);
 f.ipc.get('app:finishSaveAndClose')!(f.event,{requestId:id,saved:true});expect(f.destroyed).toBe(0);
 expect(()=>f.ipc.get('app:finishSaveAndClose')!(f.event,{requestId:id,saved:true})).toThrow('stage');
});
it('unsettled writer and malformed capture cancel/refuse without destroying content',async()=>{
 const f=fixture();const id=f.begin();
 await expect(f.ipc.get('app:finishCloseCapture')!(f.event,f.result(id,{recoveryRequired:undefined}))).rejects.toThrow('Malformed');
 await f.ipc.get('app:finishCloseCapture')!(f.event,f.result(id,{busy:true}));expect(f.destroyed).toBe(0);
});

