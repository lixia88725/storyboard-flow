import { expect, it } from 'vitest';
import { createRecoveryCloseBarrier } from './recoveryCloseBarrier.js';
const fixture = (certifyRetained: (...args: any[]) => Promise<boolean>) => {
 const frame={}, sender={id:1,mainFrame:frame,send:()=>{}}, window={webContents:sender,destroy:()=>{destroyed=true;}};
 let destroyed=false;
 const barrier=createRecoveryCloseBarrier({requestId:()=> 'close',showMessageBox:async()=>({response:0}),cancelled:()=>{},certifyRetained} as any);
 const event={sender,senderFrame:frame} as any;
 barrier.observe(event,true);barrier.begin(window);
 const result={requestId:'close',captureAvailable:true,recoveryRequired:true,busy:false,hasUnsavedChanges:true,capture:{revision:'R2'}};
 return {barrier,event,result,isDestroyed:()=>destroyed};
};
it('ordinary protected close requires successful actual retention, not the captureAvailable assertion',async()=>{
 let called=0;const f=fixture(async()=>{called++;return true;});
 await f.barrier.finishCapture(f.event,f.result);
 expect(called).toBe(1);expect(f.isDestroyed()).toBe(false);
 await f.barrier.finishCapture(f.event,f.result);expect(f.isDestroyed()).toBe(true);
});
it('retention/readback failure never retires the permanent close latch',async()=>{
 const f=fixture(async()=>{throw new Error('readback failed');});
 await f.barrier.finishCapture(f.event,f.result);
 expect(f.isDestroyed()).toBe(false);
});
it('new RAM revision after retained byte readback cancels close and keeps the window alive',async()=>{
 const f=fixture(async()=>true);
 await f.barrier.finishCapture(f.event,f.result);
 await f.barrier.finishCapture(f.event,{...f.result,capture:{revision:'R3'}});
 expect(f.isDestroyed()).toBe(false);
});
it('document navigation while retention is pending cancels authenticated close',async()=>{
 let resolve!: (v:boolean)=>void;const f=fixture(()=>new Promise(r=>{resolve=r;}));
 const closing=f.barrier.finishCapture(f.event,f.result);await Promise.resolve();await Promise.resolve();
 f.barrier.invalidateDocument({webContents:f.event.sender,destroy:()=>{}} as any);
 // Same actual window object is required; invalidate via replacing its top frame.
 f.event.sender.mainFrame={};resolve?.(true);await closing;expect(f.isDestroyed()).toBe(false);
});
