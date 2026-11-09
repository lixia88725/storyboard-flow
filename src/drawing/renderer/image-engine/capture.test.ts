import {describe,it,expect} from 'vitest';
import {createImageInputCapture,type CaptureInput} from './capture';
import type {ImagePipelineAdmission} from '../../../platform/contracts/imageProject';
const target={shotId:'shot',layerId:'layer',expectedContextGeneration:1};
const style={tool:'brush' as const,color:'#ff0000',size:10,opacity:.5,softness:0};
const p=(x:number)=>({x,y:x+1,pressure:.4});
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
function harness(delayFirst=false){
 const calls:CaptureInput[]=[];let serial=0,op='',through=0;const gate=deferred<void>();
 const confirmations=new Map<string,ReturnType<typeof deferred<{ok:true}>>>();
 const capture=createImageInputCapture({
  async input(input){calls.push(structuredClone(input));if(delayFirst&&calls.length===1)await gate.promise;
   if(input.kind==='begin'){op=`op${++serial}`;through=input.stroke.points.length/2;}
   if(input.kind==='append'){expect(input.fromSeq).toBe(through+1);through+=input.points.length/2;}
   if(input.kind==='end')expect(input.throughSeq).toBe(through);
   return{kind:'admitted',operationId:op,inputThrough:through,durable:false};
  },settled(id){const item=deferred<{ok:true}>();confirmations.set(id,item);return item.promise;},
 });return{capture,calls,gate,confirmations};
}
describe('renderer image input capture',()=>{
 it('keeps down/move/up and the next gesture while the first Main admission is delayed',async()=>{
  const h=harness(true);const first=h.capture.begin(target,style,p(0));expect(first.ok).toBe(true);if(!first.ok)return;
  h.capture.append(first.id,[p(1),p(2)]);h.capture.end(first.id);
  const second=h.capture.begin(target,{...style,tool:'eraser'},p(3));expect(second.ok).toBe(true);if(!second.ok)return;h.capture.end(second.id);
  expect(h.calls.length).toBe(1);h.gate.resolve();await tick();
  expect(h.calls.map(c=>c.kind)).toEqual(['begin','append','end','begin','end']);
  expect(h.calls[1]).toMatchObject({fromSeq:2,points:[1,2,2,3],pressures:[.4,.4]});
  expect(h.capture.state().pending).toBe(2); // admission is not durability
  h.confirmations.get('op2')!.resolve({ok:true});await tick();expect(h.capture.state().pending).toBe(1);
  h.confirmations.get('op1')!.resolve({ok:true});await tick();expect(h.capture.dispose()).toBe(true);
 });
 it('snapshots style/target and emits bounded append batches without dropping samples',async()=>{
  const h=harness(true),t={...target},s={...style};const begin=h.capture.begin(t,s,p(0));if(!begin.ok)throw Error();
  t.layerId='changed';s.size=999;h.capture.append(begin.id,Array.from({length:9000},(_,i)=>p(i+1)));h.capture.end(begin.id);h.gate.resolve();await tick();
  expect(h.calls[0]).toMatchObject({layerId:'layer',stroke:{size:10}});
  const appends=h.calls.filter((v):v is Extract<CaptureInput,{kind:'append'}>=>v.kind==='append');
  expect(appends.map(v=>v.points.length/2)).toEqual([4096,4096,808]);expect(h.calls.at(-1)).toMatchObject({throughSeq:9001});
 });
 it('retains ambiguous IPC inputs and never automatically retries or disposes them',async()=>{
  let count=0;const c=createImageInputCapture({input:async()=>{count++;throw Error('lost reply');},settled:async()=>({ok:true})});
  const b=c.begin(target,style,p(0));if(!b.ok)throw Error();c.append(b.id,[p(1)]);c.end(b.id);await tick();
  expect(count).toBe(1);expect(c.records()[0]).toMatchObject({stroke:{points:[0,1,1,2]},failure:{effect:'unknown'}});
  expect(c.begin(target,style,p(2)).ok).toBe(false);expect(c.resolveIncomplete(b.id,'submit-prefix')).toBe(false);expect(c.dispose()).toBe(false);
 });
 it('does not silently submit a truncated long stroke',async()=>{
  const calls:CaptureInput[]=[];let through=0;
  const c=createImageInputCapture({maxPoints:4,maxStrokePoints:2,input:async v=>{calls.push(v);if(v.kind==='begin')through=1;if(v.kind==='append')through+=v.points.length/2;return{kind:'admitted',operationId:'op',inputThrough:through,durable:false};},settled:async()=>({ok:true})});
  const b=c.begin(target,style,p(0));if(!b.ok)throw Error();await tick();expect(c.append(b.id,[p(1)])).toBe(true);await tick();
  expect(c.append(b.id,[p(2)])).toBe(false);c.end(b.id);await tick();expect(calls.some(v=>v.kind==='end')).toBe(false);
  expect(c.resolveIncomplete(b.id,'submit-prefix')).toBe(true);await tick();expect(calls.at(-1)).toMatchObject({kind:'end',throughSeq:2});
 });
 it('cancel while begin is awaiting its receipt sends cancel instead of end',async()=>{
  const h=harness(true);const b=h.capture.begin(target,style,p(0));if(!b.ok)throw Error();h.capture.append(b.id,[p(1)]);h.capture.cancel(b.id);h.gate.resolve();await tick();
  expect(h.calls.map(v=>v.kind)).toEqual(['begin','cancel']);expect(h.capture.state().pending).toBe(0);
 });
 it('pause rejects new down but preserves accepted move and up',async()=>{
  const h=harness();const b=h.capture.begin(target,style,p(0));if(!b.ok)throw Error();h.capture.pause(true);expect(h.capture.append(b.id,[p(1)])).toBe(true);h.capture.end(b.id);await tick();
  expect(h.capture.begin(target,style,p(2)).ok).toBe(false);expect(h.calls.at(-1)?.kind).toBe('end');
 });
 it('does not treat an invalid receipt as an accepted prefix',async()=>{
  const c=createImageInputCapture({input:async()=>({kind:'admitted',operationId:'x',inputThrough:99,durable:false}) as ImagePipelineAdmission,settled:async()=>({ok:true})});
  c.begin(target,style,p(0));await tick();expect(c.records()[0]).toMatchObject({sent:0,failure:{code:'invalid-receipt',effect:'unknown'}});
 });
 it('retains a complete gesture while its cold target is being activated',async()=>{
  const ready=deferred<{ok:true;target:typeof target}>(),calls:CaptureInput[]=[];let through=0;
  const c=createImageInputCapture({resolveTarget:()=>ready.promise,input:async value=>{calls.push(value);if(value.kind==='begin')through=1;if(value.kind==='append')through+=value.points.length/2;return{kind:'admitted',operationId:'op',inputThrough:through,durable:false};},settled:async()=>({ok:true})});
  const b=c.begin({shotId:target.shotId,layerId:null,expectedContextGeneration:null},style,p(0));if(!b.ok)throw Error();
  c.append(b.id,[p(1),p(2)]);c.end(b.id);expect(calls).toEqual([]);ready.resolve({ok:true,target});await tick();
  expect(calls.map(v=>v.kind)).toEqual(['begin','append','end']);expect(calls[0]).toMatchObject(target);expect(c.state().pending).toBe(0);
 });
 it('retries a proven no-effect capacity refusal only when Main makes progress',async()=>{
  let available=false,count=0;
  const c=createImageInputCapture({input:async()=>{count++;return available?{kind:'admitted',operationId:'op',inputThrough:1,durable:false}:{kind:'rejected',error:{code:'backpressure',message:'full',effect:'none'}};},settled:async()=>({ok:true})});
  const b=c.begin(target,style,p(0));if(!b.ok)throw Error();c.end(b.id);await tick();expect(count).toBe(1);expect(c.state()).toMatchObject({waiting:true,blocked:false,pending:1});
  available=true;c.wake();await tick();expect(count).toBe(3);expect(c.state().pending).toBe(0);
 });

 it('maps cold normalized input using authoritative dimensions, including moves after resolution',async()=>{
  const ready=deferred<{ok:true;target:typeof target;width:number;height:number}>(),calls:CaptureInput[]=[];let through=0;
  const c=createImageInputCapture({resolveTarget:()=>ready.promise,input:async value=>{calls.push(value);if(value.kind==='begin')through=1;if(value.kind==='append')through+=value.points.length/2;return{kind:'admitted',operationId:'op',inputThrough:through,durable:false};},settled:async()=>({ok:true})});
  const b=c.begin({shotId:target.shotId,layerId:null,expectedContextGeneration:null},style,{x:.5,y:.5,pressure:1},'normalized');if(!b.ok)throw Error();
  c.append(b.id,[{x:.6,y:.7,pressure:.5}]);ready.resolve({ok:true,target,width:1920,height:1080});await tick();
  c.append(b.id,[{x:.7,y:.8,pressure:.4}]);c.end(b.id);await tick();
  expect(calls[0]).toMatchObject({stroke:{points:[960,540]}});expect(calls[1]).toMatchObject({points:[1152,756]});expect(calls[2]).toMatchObject({points:[1344,864]});
 });
 it('does not lose a capacity wake that arrives before a busy IPC reply',async()=>{
  const first=deferred<ImagePipelineAdmission>();let count=0;const traces:{captureId:string;inputId:string;attemptId:string}[]=[];
  const c=createImageInputCapture({input:async(_value,trace)=>{traces.push(trace);count++;return count===1?first.promise:{kind:'admitted',operationId:'op',inputThrough:1,durable:false};},settled:async()=>({ok:true})});
  const b=c.begin(target,style,p(0));if(!b.ok)throw Error();c.end(b.id);c.wake();first.resolve({kind:'rejected',error:{code:'busy',message:'busy',effect:'none'}});await tick();
  expect(count).toBe(3);expect(traces[1].inputId).toBe(traces[0].inputId);expect(traces[1].attemptId).not.toBe(traces[0].attemptId);expect(c.state().pending).toBe(0);
 });

 it('does not lose readiness notification before cold activation reports busy',async()=>{
  let attempts=0;
  const gate=deferred<{ok:false;error:{code:string;message:string;effect:'none'}}>();
  const c=createImageInputCapture({resolveTarget:async()=>++attempts===1?gate.promise:{ok:true,target},input:async()=>({kind:'admitted',operationId:'op',inputThrough:1,durable:false}),settled:async()=>({ok:true})});
  const b=c.begin({shotId:target.shotId,layerId:null,expectedContextGeneration:null},style,p(0));if(!b.ok)throw Error();
  c.end(b.id);c.wake();gate.resolve({ok:false,error:{code:'busy',message:'busy',effect:'none'}});await tick();
  expect(attempts).toBe(2);expect(c.state().pending).toBe(0);
 });

});

it('never retargets an already captured concrete gesture after asynchronous resolution',async()=>{
 const sent:CaptureInput[]=[];const c=createImageInputCapture({resolveTarget:async()=>({ok:true,target:{...target,layerId:'other'}}),input:async input=>{sent.push(input);throw Error('must not send');},settled:async()=>({ok:true})});
 const b=c.begin(target,style,p(0));if(!b.ok)throw Error();c.end(b.id);await tick();expect(sent).toEqual([]);expect(c.records()[0]).toMatchObject({target,failure:{code:'target'}});expect(c.dispose()).toBe(false);
});
it('retains the original when a concrete gesture belongs to a replaced native worker',async()=>{
 let authority='worker-one';const resolved=deferred<{ok:true;target:typeof target}>();let sends=0;
 const c=createImageInputCapture({authority:()=>authority,resolveTarget:()=>resolved.promise,input:async()=>{sends++;throw Error();},settled:async()=>({ok:true})});
 const b=c.begin(target,style,p(0));if(!b.ok)throw Error();c.end(b.id);authority='worker-two';resolved.resolve({ok:true,target});await tick();expect(sends).toBe(0);expect(c.records()[0]).toMatchObject({failure:{code:'target-authority-changed'},stroke:{points:[0,1]}});
});
it('releases only a typed cold-layer refusal proven before any begin IPC',async()=>{
 let notices=0,sends=0;const c=createImageInputCapture({resolveTarget:async()=>({ok:false,notAdmitted:'paint-layer-unavailable',message:'不能绘画'}),notAdmitted:()=>notices++,input:async()=>{sends++;throw Error();},settled:async()=>({ok:true})});
 const b=c.begin({shotId:'shot',layerId:null,expectedContextGeneration:null},style,p(0));if(!b.ok)throw Error();await tick();expect(sends).toBe(0);expect(notices).toBe(1);expect(c.state()).toMatchObject({pending:0,activeId:null,blocked:false});expect(c.end(b.id)).toBe(false);expect(c.dispose()).toBe(true);
});
it('never applies a not-admitted disposition after even a busy begin IPC',async()=>{
 let resolves=0,sends=0;const c=createImageInputCapture({resolveTarget:async()=>++resolves===1?{ok:true,target}:{ok:false,notAdmitted:'paint-layer-unavailable',message:'不能绘画'},input:async()=>{sends++;return{kind:'rejected',error:{code:'busy',message:'busy',effect:'none'}};},settled:async()=>({ok:true})});
 const b=c.begin({shotId:'shot',layerId:null,expectedContextGeneration:null},style,p(0));if(!b.ok)throw Error();c.end(b.id);await tick();c.wake();await tick();expect(sends).toBe(1);expect(c.state()).toMatchObject({pending:1,blocked:true});expect(c.records()[0].failure?.effect).toBe('unknown');
});
it('preserves a cold candidate when a worker changes before its unpaintable-layer reply',async()=>{
 let worker='one';const gate=deferred<{ok:false;notAdmitted:'paint-layer-unavailable';message:string}>();const c=createImageInputCapture({workerAuthority:()=>worker,resolveTarget:()=>gate.promise,input:async()=>{throw Error();},settled:async()=>({ok:true})});
 const b=c.begin({shotId:'shot',layerId:null,expectedContextGeneration:null},style,p(0));if(!b.ok)throw Error();c.end(b.id);worker='two';gate.resolve({ok:false,notAdmitted:'paint-layer-unavailable',message:'不能绘画'});await tick();expect(c.state()).toMatchObject({pending:1,blocked:true});expect(c.records()[0].failure?.code).toBe('target-authority-changed');
});
