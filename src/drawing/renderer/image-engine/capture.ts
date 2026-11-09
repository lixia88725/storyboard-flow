import type { FlowStroke } from '../../../platform/contracts/flowWave2';
import type { ImagePipelineAdmission, ImagePipelineInput } from '../../../platform/contracts/imageProject';

export type CaptureTarget = { shotId:string;layerId:string;expectedContextGeneration:number };
export type CaptureDestination = CaptureTarget | {shotId:string;layerId:null;expectedContextGeneration:null};
export type CaptureSample = { x:number;y:number;pressure:number };
export type CaptureFailure = { code:string;message:string;effect:'none'|'retained'|'unknown' };
export type CaptureRecord = { id:number;captureId:string;coordinateSpace:'pixels'|'normalized';resolvedDimensions?:{width:number;height:number};target:CaptureDestination;stroke:FlowStroke;ended:boolean;operationId?:string;sent:number;failure?:CaptureFailure };
type Entry = CaptureRecord & { authority?:string;workerAuthority?:string;beginAttempted:boolean; terminalSent:boolean;terminalSending:boolean;cancelled:boolean;batch?:{kind:string;expected:number;inputId:string} };
export type CaptureInput = (Extract<ImagePipelineInput,{kind:'begin'}> & CaptureTarget) | Exclude<ImagePipelineInput,{kind:'begin'}>;

/** Synchronous pointer capture, asynchronous Main admission. One queue preserves
 * gesture order across surfaces. Native confirmation never stalls the next pen.
 * Failed/unknown inputs stay here until the caller explicitly resolves them;
 * neither an IPC receipt nor an end admission is described as durable storage. */
export function createImageInputCapture(options:{
 input(input:CaptureInput,trace:{captureId:string;inputId:string;attemptId:string}):Promise<ImagePipelineAdmission>;
 authority?():string;
 workerAuthority?():string|undefined;
 checkTarget?(target:CaptureDestination):string|undefined;
 resolveTarget?(shotId:string,expected?:CaptureTarget):Promise<{ok:true;target:CaptureTarget;width?:number;height?:number}|{ok:false;error:CaptureFailure}|{ok:false;notAdmitted:'paint-layer-unavailable';message:string}>;
 settled(operationId:string):Promise<{ok:true}|{ok:false;error:CaptureFailure}>;
 notAdmitted?(message:string):void;
 changed?():void;
 maxPoints?:number;maxStrokePoints?:number;maxStrokes?:number;
}) {
 const maxPoints=options.maxPoints??200_000,maxStrokePoints=options.maxStrokePoints??100_000,maxStrokes=options.maxStrokes??32;
 if(!Number.isSafeInteger(maxStrokePoints)||maxStrokePoints<1||!Number.isSafeInteger(maxPoints)||maxPoints<maxStrokePoints||!Number.isSafeInteger(maxStrokes)||maxStrokes<1)throw Error('Invalid input capture budget');
 const entries:Entry[]=[];let active:Entry|undefined,nextId=0,running=false,paused=false,disposed=false,waiting=false,wakeVersion=0,retryAfterPump=false;
 const idleWaiters=new Set<()=>void>();
 const notify=()=>{try{options.changed?.();}catch{/* Observers cannot change admission. */}};
 const blocked=()=>entries.some(e=>e.failure);
 const sampleValid=(s:CaptureSample)=>Number.isFinite(s.x)&&Number.isFinite(s.y)&&Number.isFinite(s.pressure)&&s.pressure>=0&&s.pressure<=1;
 const fail=(e:Entry,error:CaptureFailure)=>{e.failure={...error};notify();};
 const forget=(e:Entry)=>{const index=entries.indexOf(e);if(index>=0)entries.splice(index,1);notify();};
 const watch=(e:Entry)=>{
  void options.settled(e.operationId!).then(result=>{
   if(!entries.includes(e))return;
   if(result.ok){forget(e);wakeVersion++;kick();}else fail(e,result.error);
  },()=>fail(e,{code:'transport',message:'无法确认笔迹是否已经保存；已保留输入。',effect:'unknown'}));
 };
 async function admitted(e:Entry,input:CaptureInput,expected:number):Promise<boolean>{
  const beforeWake=wakeVersion;
  let reply:ImagePipelineAdmission;
  if(!e.batch||e.batch.kind!==input.kind||e.batch.expected!==expected)e.batch={kind:input.kind,expected,inputId:crypto.randomUUID()};
  if(input.kind==='begin')e.beginAttempted=true;
  try{reply=await options.input(input,{captureId:e.captureId,inputId:e.batch.inputId,attemptId:crypto.randomUUID()});}catch{fail(e,{code:'transport',message:'绘画连接中断；已保留输入，未自动重试。',effect:'unknown'});return false;}
  if(reply.kind==='rejected'){
   if(reply.error.effect==='none'&&['backpressure','busy'].includes(reply.error.code)){waiting=true;retryAfterPump=wakeVersion!==beforeWake;notify();return false;}
   fail(e,reply.error);return false;
  }
  if((e.operationId&&reply.operationId!==e.operationId)||reply.inputThrough!==expected||reply.durable!==false){
   fail(e,{code:'invalid-receipt',message:'绘画接收确认与输入不一致；已停止发送。',effect:'unknown'});return false;
  }
  e.operationId=reply.operationId;e.sent=expected;notify();return true;
 }
 async function pump(){
  if(running||disposed||blocked())return;running=true;waiting=false;
  try{
   while(!disposed&&!blocked()){
    const e=entries.find(item=>!item.terminalSent);if(!e)return;
    if(!e.operationId){
     if(e.cancelled){forget(e);continue;}
     if(options.resolveTarget){
      const beforeResolveWake=wakeVersion;
      let resolved:Awaited<ReturnType<NonNullable<typeof options.resolveTarget>>>;
      try{resolved=await options.resolveTarget(e.target.shotId,e.target.layerId===null?undefined:e.target);}catch{fail(e,{code:'target-transport',message:'无法确认画布准备结果，已保留输入。',effect:'unknown'});return;}
      if(e.workerAuthority!==undefined&&e.workerAuthority!==options.workerAuthority?.()){fail(e,{code:'target-authority-changed',message:'原生画布已变化，已保留原始输入。',effect:'none'});return;}
      // Only an unbound cold candidate proven never sent may end as ordinary admission refusal.
      // A prior begin attempt, even busy/none, keeps the original recovery obligation.
      if(!resolved.ok&&'notAdmitted' in resolved){if(e.target.layerId===null&&!e.operationId&&e.sent===0&&!e.beginAttempted){if(active===e)active=undefined;forget(e);options.notAdmitted?.(resolved.message);continue;}fail(e,{code:'invalid-admission',message:resolved.message,effect:'unknown'});return;}
      if(!resolved.ok){if(resolved.error.effect==='none'&&['busy','backpressure'].includes(resolved.error.code)){waiting=true;retryAfterPump=wakeVersion!==beforeResolveWake;notify();return;}fail(e,resolved.error);return;}
      if(resolved.target.shotId!==e.target.shotId||(e.target.layerId!==null&&(resolved.target.layerId!==e.target.layerId||resolved.target.expectedContextGeneration!==e.target.expectedContextGeneration))){fail(e,{code:'target',message:'画布准备结果与落笔目标不一致。',effect:'unknown'});return;}
      e.target={...resolved.target};
      if(e.authority===undefined)e.authority=options.authority?.();
      if(e.coordinateSpace==='normalized'){
       if(!Number.isSafeInteger(resolved.width)||!Number.isSafeInteger(resolved.height)||resolved.width!<=0||resolved.height!<=0){fail(e,{code:'target-size',message:'无法确认图片尺寸，已保留原始输入。',effect:'none'});return;}
       e.resolvedDimensions={width:resolved.width!,height:resolved.height!};
      }
      if(e.cancelled){forget(e);continue;}
     }
     if(e.authority!==undefined&&e.authority!==options.authority?.()){fail(e,{code:'target-authority-changed',message:'绘画会话或原生画布已变化，已保留原始输入。',effect:'none'});return;}
     if(e.target.layerId===null||(e.coordinateSpace==='normalized'&&!e.resolvedDimensions)){fail(e,{code:'target',message:'画布尚未准备好，已保留输入。',effect:'none'});return;}
     // Keep begin small even if many samples arrived before the IPC became ready.
     const stroke={...e.stroke,points:nativePoints(e,0,1),pressures:e.stroke.pressures?.slice(0,1)};
     if(!await admitted(e,{kind:'begin',...e.target,stroke},1))return;
    }
    if(e.cancelled){
     if(!await admitted(e,{kind:'cancel',operationId:e.operationId!},e.sent))return;
     e.terminalSent=true;forget(e);continue;
    }
    const total=e.stroke.points.length/2;
    if(e.sent<total){
     const end=Math.min(total,e.sent+4096);
     if(!await admitted(e,{kind:'append',operationId:e.operationId!,fromSeq:e.sent+1,points:nativePoints(e,e.sent,end),pressures:e.stroke.pressures?.slice(e.sent,end)},end))return;
     continue;
    }
    if(!e.ended)return;
    e.terminalSending=true;
    if(!await admitted(e,{kind:'end',operationId:e.operationId!,throughSeq:e.sent},e.sent))return;
    e.terminalSent=true;watch(e);
   }
  }finally{running=false;for(const resolve of idleWaiters)resolve();idleWaiters.clear();if(retryAfterPump){retryAfterPump=false;kick();}}
 }
 const kick=()=>{void pump();};
 const nativePoints=(e:Entry,start:number,end:number)=>{const points=e.stroke.points.slice(start*2,end*2);if(e.coordinateSpace==='normalized'){const size=e.resolvedDimensions!;for(let i=0;i<points.length;i+=2){points[i]*=size.width;points[i+1]*=size.height;}}return points;};
 return {
  begin(target:CaptureDestination,style:Omit<FlowStroke,'points'|'pressures'>,point:CaptureSample,coordinateSpace:'pixels'|'normalized'='pixels'):{ok:true;id:number}|{ok:false;reason:string}{
   if(disposed||paused||active||blocked())return{ok:false,reason:'绘画正在结算或等待处理。'};
   const reason=options.checkTarget?.(target);if(reason)return{ok:false,reason};
   // Reserve a complete gesture before accepting down. Existing accepted input
   // is never evicted to make room for a new gesture.
   if(entries.length>=maxStrokes||entries.reduce((n,e)=>n+e.stroke.points.length/2,0)+maxStrokePoints>maxPoints)return{ok:false,reason:'正在保存之前的笔迹，请稍候。'};
   if(!sampleValid(point))return{ok:false,reason:'无效的落笔坐标或压力。'};
   const e:Entry={workerAuthority:options.workerAuthority?.(),beginAttempted:false,authority:target.layerId===null?undefined:options.authority?.(),id:++nextId,captureId:crypto.randomUUID(),coordinateSpace,target:{...target},stroke:{...structuredClone(style),points:[point.x,point.y],pressures:[point.pressure]},ended:false,sent:0,terminalSent:false,terminalSending:false,cancelled:false};
   entries.push(e);active=e;notify();kick();return{ok:true,id:e.id};
  },
  append(id:number,points:readonly CaptureSample[]):boolean{
   const e=active;if(!e||e.id!==id||e.ended||e.failure||disposed)return false;
   if(points.some(p=>!sampleValid(p))){fail(e,{code:'invalid-sample',message:'本笔包含无效采样，尚未提交。',effect:'none'});return false;}
   if(e.stroke.points.length/2+points.length>maxStrokePoints){fail(e,{code:'capture-budget',message:'本笔过长，已暂停采样；不会自动提交不完整笔迹。',effect:'none'});return false;}
   // Append in place to avoid quadratic copies during long pointer gestures.
   const xy=e.stroke.points as number[],pressures=e.stroke.pressures as number[];
   for(const p of points){xy.push(p.x,p.y);pressures.push(p.pressure);}notify();kick();return true;
  },
  end(id:number){if(!active||active.id!==id)return false;active.ended=true;active=undefined;notify();kick();return true;},
  cancel(id:number){const e=entries.find(x=>x.id===id);if(!e||e.terminalSent||e.terminalSending||e.failure)return false;e.cancelled=true;e.ended=true;if(active===e)active=undefined;notify();kick();return true;},
  /** Retry only a proven no-effect capacity refusal, on a Main progress event. */
  wake(){wakeVersion++;if(waiting)kick();},
  pause(value:boolean){paused=value;notify();},
  /** May be used for a user-confirmed incomplete prefix only; unknown IPC
   * results cannot be cleared or replayed through this path. */
  resolveIncomplete(id:number,choice:'submit-prefix'|'cancel'){
   const e=entries.find(x=>x.id===id);if(!e||!e.ended||!['capture-budget','invalid-sample'].includes(e.failure?.code??''))return false;
   e.failure=undefined;e.cancelled=choice==='cancel';notify();kick();return true;
  },
  /** Only the workspace controller calls this after Main persisted the exact
   * full original and returned its explicit disposition receipt. */
  waitTransportIdle(){return running?new Promise<void>(resolve=>idleWaiters.add(resolve)):Promise.resolve();},
  acknowledgeArchived(captureId:string,capturedThrough:number){
   const e=entries.find(x=>x.captureId===captureId);
   if(running||!e||!e.ended||active===e||capturedThrough!==e.stroke.points.length/2)return false;
   forget(e);kick();return true;
  },
  contains(id:number){return entries.some(entry=>entry.id===id);},
  records():readonly CaptureRecord[]{return entries.map(({workerAuthority:_worker,beginAttempted:_attempted,authority:_authority,terminalSent:_sent,terminalSending:_sending,cancelled:_cancel,batch:_batch,...record})=>structuredClone(record));},
  state(){return{activeId:active?.id??null,pending:entries.length,blocked:blocked(),waiting,paused,disposed};},
  /** The caller must settle or explicitly preserve inputs before disposing. */
  dispose(){if(entries.length||running)return false;disposed=true;notify();return true;},
 };
}
