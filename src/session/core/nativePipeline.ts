import type { FlowStroke } from '../../platform/contracts/flowWave2.js';
import type { ImageBindingV2, ImagePipelineAdmission, ImagePipelineInput, ImagePipelineProgress, ImageProjectOutcome, NativeImageRef, RetainedImageInput, PipelineImageOperationIntent } from '../../platform/contracts/imageProject.js';
import type { PreparedImage } from './nativeSession.js';
import { validProjectStroke } from './imageProjectModel.js';
import { copy, same, shape } from './imageProjectValues.js';

export type PipelineLimits={maxPendingStrokes:number;maxPendingPoints:number;maxRetainedPixelBytes:number};
export type PipelineReady={pipelineId:string;anchorVersion:string;documentId:string;epoch:number;limits:PipelineLimits};
export type PipelineQueued={candidateId:string;pipelineId:string;predecessorOperationId:string|null;inputThrough:number;frameInputThrough:number;epoch:number;inputDigest:string;durable:false};
export type PipelinePrepared=PreparedImage&{predecessorOperationId:string|null;inputThrough:number;frameInputThrough:number;epoch:number;inputDigest:string};
export type PipelineEvent={operationId:string;kind:'prepared';prepared:PipelinePrepared}|{operationId:string;kind:'accepted';native:NativeImageRef};
export type PipelineState={pipelineId:string;anchorVersion:string;acceptedVersion:string;events:PipelineEvent[];blocked:unknown;availableSlots:number;queueDepth:number};
/** Short native commands only. Neither finish nor accept waits for durable IO. */
export interface NativePipelineDriver{
  validateStroke(stroke:FlowStroke):void;
  start(base:NativeImageRef,limits:PipelineLimits):Promise<PipelineReady>;
  begin(operationId:string,predecessorOperationId:string|null,stroke:FlowStroke):Promise<void>;
  append(operationId:string,fromSeq:number,points:readonly number[],pressures?:readonly number[]):Promise<void>;
  end(operationId:string,throughSeq:number):Promise<PipelineQueued>;
  cancel(operationId:string):Promise<void>;
  poll():Promise<PipelineState>;
  accept(prepared:PreparedImage,base:NativeImageRef):Promise<void>;
  stop():Promise<void>;
}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return{promise,resolve,reject};}
export type PipelineEntry={
  operationId:string;shotId:string;imageId:string;stroke:FlowStroke;predecessorOperationId:string|null;
  through:number;ended:boolean;retired:boolean;intent?:PipelineImageOperationIntent;queued?:PipelineQueued;prepared?:PipelinePrepared;
  preparedWait:ReturnType<typeof deferred<PipelinePrepared>>;acceptedWait:ReturnType<typeof deferred<NativeImageRef>>;
  completed:ReturnType<typeof deferred<ImageProjectOutcome>>;
};
export type PipelineAnchor={imageId:string;expected:ImageBindingV2;commitHash:string;native():Promise<NativeImageRef>};
/** Bounded volatile capture + native IO pump. Project/history authority is supplied
 * by the existing Session; this module owns no history stack and no project CAS. */
export function createMainImagePipeline(options:{
  sessionId:string;incarnation:string;driver:NativePipelineDriver;limits:PipelineLimits;
  mintId():string;canAdmit():boolean;anchor(shotId:string):PipelineAnchor;
  persist(intent:PipelineImageOperationIntent):Promise<void>;
  decide(entry:PipelineEntry):Promise<ImageProjectOutcome>;
  blocked(operationId:string,error:unknown):void;
}){
  const driver=options.driver,limits=options.limits;
  if(!Number.isSafeInteger(limits.maxPendingStrokes)||limits.maxPendingStrokes<1||limits.maxPendingStrokes>4||!Number.isSafeInteger(limits.maxPendingPoints)||limits.maxPendingPoints<1||limits.maxPendingPoints>65536||!Number.isSafeInteger(limits.maxRetainedPixelBytes)||limits.maxRetainedPixelBytes<1||limits.maxRetainedPixelBytes>(256<<20))throw Error('Invalid Main pipeline limits');
  let ready:PipelineReady|undefined,anchor:PipelineAnchor|undefined,anchorRef:NativeImageRef|undefined;
  let active:PipelineEntry|undefined,last:string|null=null,inputTail=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined,polling:Promise<void>|undefined;
  let sealed=false,blocked:unknown,commands=0,points=0,issued=0;const entries=new Map<string,PipelineEntry>();
  const listeners=new Set<(progress:ImagePipelineProgress)=>void>();
  const progress=(entry:PipelineEntry,stage:ImagePipelineProgress['stage'],durable=false,inputThrough=entry.through,commitHash?:string)=>{const event:ImagePipelineProgress={operationId:entry.operationId,stage,inputThrough,durable,...(commitHash?{commitHash}:{})};for(const f of listeners)try{void Promise.resolve(f(copy(event))).catch(()=>{});}catch{/* presentation only */}};
  const fail=(e:unknown)=>{
    if(blocked)return;blocked=e??Error('Pipeline failed');sealed=true;if(timer)clearTimeout(timer);timer=undefined;
    const op=active?.operationId??[...entries.values()].find(e=>!e.retired)?.operationId??'pipeline';
    for(const entry of entries.values()){if(entry.retired)continue;if(!entry.ended)entry.completed.reject(blocked);entry.preparedWait.reject(blocked);entry.acceptedWait.reject(blocked);progress(entry,'blocked',Boolean(entry.intent));}
    options.blocked(op,blocked);
  };
  const queue=(f:()=>Promise<void>)=>{commands++;const work=inputTail.then(async()=>{if(blocked)throw blocked;await f();});inputTail=work.then(()=>undefined,e=>{fail(e);}).finally(()=>{commands--;});};
  const start=async()=>{
    if(ready)return;
    if(!anchor)throw Error('Missing pipeline anchor');anchorRef=await anchor.native();
    const proposed=await driver.start(anchorRef,limits);
    if(proposed.anchorVersion!==anchorRef.versionId||proposed.documentId!==anchorRef.documentId||!same(proposed.limits,limits))throw Error('Native pipeline anchor/limits mismatch');
    ready=proposed;
  };
  const pump=async()=>{
    if(!ready||blocked)return;
    const state=await driver.poll();if(state.pipelineId!==ready.pipelineId||state.anchorVersion!==ready.anchorVersion)throw Error('Native pipeline poll changed identity');
    if(state.blocked)throw Object.assign(Error('Native pipeline IO is blocked; original input is retained'),{effect:'retained',cause:state.blocked});
    for(const event of state.events){
      const entry=entries.get(event.operationId);if(!entry||!entry.ended)throw Error('Native pipeline event has no admitted Main operation');
      if(entry.retired){if(event.kind==='prepared'&&same(entry.prepared,event.prepared)||event.kind==='accepted'&&same(entry.prepared?.native,event.native))continue;throw Error('Retired pipeline receipt changed');}
      if(event.kind==='prepared'){
        const p=event.prepared,q=entry.queued;
        if(!q||p.candidateId!==entry.operationId||p.predecessorOperationId!==entry.predecessorOperationId||p.inputThrough!==q.inputThrough||p.frameInputThrough!==q.frameInputThrough||p.epoch!==q.epoch||p.inputDigest!==q.inputDigest)throw Error('Native prepared prefix differs from queued input');
        const base=entry.predecessorOperationId?entries.get(entry.predecessorOperationId)?.prepared?.native:anchorRef;
        if(!base||p.baseVersion!==base.versionId||p.native.storeId!==base.storeId||p.native.documentId!==base.documentId)throw Error('Native prepared predecessor/base mismatch');
        if(entry.prepared){if(!same(entry.prepared,p))throw Error('Repeated native prepared receipt changed');continue;}
        entry.prepared=copy(p);entry.preparedWait.resolve(copy(p));progress(entry,'prepared',true);
      }else{
        if(!entry.prepared||!same(entry.prepared.native,event.native))throw Error('Native accepted receipt differs from prepared');
        entry.acceptedWait.resolve(copy(event.native));progress(entry,'nativeAccepted',true);
      }
    }
  };
  const schedule=()=>{
    if(timer||blocked||!ready)return;
    timer=setTimeout(()=>{timer=undefined;polling=pump().catch(fail).finally(()=>{polling=undefined;if([...entries.values()].some(e=>e.ended&&!e.retired))schedule();});},2);
  };
  const retire=(entry:PipelineEntry)=>{
    if(entry.retired)return;points-=entry.through;entry.retired=true;
    entry.stroke={...entry.stroke,points:[]};delete entry.stroke.pressures;delete entry.intent;
    const recent=[...entries.values()].filter(e=>e.retired);for(const old of recent.slice(0,-64))entries.delete(old.operationId);
  };
  const rejected=(message:string,code='invalid-input'):ImagePipelineAdmission=>({kind:'rejected',error:{code,message,effect:blocked?'retained':'none'}});
  const admission=(e:PipelineEntry):ImagePipelineAdmission=>({kind:'admitted',operationId:e.operationId,inputThrough:e.through,durable:false});
  const input=(value:ImagePipelineInput):ImagePipelineAdmission=>{
    if(blocked||(!options.canAdmit())||(sealed&&value?.kind!=='end'&&value?.kind!=='cancel'))return rejected('Main pipeline input is sealed','busy');
    if(commands>=256)return rejected('Main input command budget full','backpressure');
    try{
      if(value?.kind==='begin'){
        if(!shape(value,['kind','shotId','stroke'])||typeof value.shotId!=='string'||!validProjectStroke(value.stroke))return rejected('Invalid pipeline begin');
        driver.validateStroke(value.stroke);
        if(active)return rejected('Finish or cancel the active gesture first','busy');
        if(issued>=65536)return rejected('Pipeline operation identity budget exhausted; stop at a settled barrier','resource-limit');
        if([...entries.values()].filter(e=>!e.retired).length>=limits.maxPendingStrokes||points+value.stroke.points.length/2>limits.maxPendingPoints)return rejected('Main stroke/point budget full','backpressure');
        // Validate before copying, then sever all caller-owned sample buffers.
        const stroke=copy(value.stroke);if(stroke.points.length/2>4096)return rejected('Begin batch exceeds native point bound');
        const nextAnchor=options.anchor(value.shotId);if(anchor&&nextAnchor.imageId!==anchor.imageId)return rejected('Pipeline target change requires a settled barrier','busy');
        if(!anchor)anchor=nextAnchor;
        const entry:PipelineEntry={operationId:options.mintId(),shotId:value.shotId,imageId:nextAnchor.imageId,stroke,predecessorOperationId:last,through:stroke.points.length/2,ended:false,retired:false,preparedWait:deferred(),acceptedWait:deferred(),completed:deferred()};
        entries.set(entry.operationId,entry);issued++;active=entry;points+=entry.through;progress(entry,'admitted');
        queue(async()=>{await start();if(blocked)throw blocked;await driver.begin(entry.operationId,entry.predecessorOperationId,stroke);progress(entry,'preview',false,stroke.points.length/2);});return admission(entry);
      }
      if(!value||!['append','end','cancel'].includes(value.kind)||!active||value.operationId!==active.operationId)return rejected('Unknown active pipeline gesture');
      const entry=active;
      if(value.kind==='append'){
        if(!shape(value,['kind','operationId','fromSeq','points'],['pressures'])||value.fromSeq!==entry.through+1||!Array.isArray(value.points)||value.points.length<2||value.points.length%2||value.points.length>8192)return rejected('Invalid pipeline sample prefix');
        const added=value.points.length/2;if(points+added>limits.maxPendingPoints)return rejected('Main point budget full','backpressure');
        const test={...entry.stroke,points:value.points,...(value.pressures?{pressures:value.pressures}:{pressures:undefined})};
        // Undefined optional properties are omitted by the data contract.
        if(test.pressures===undefined)delete test.pressures;if(!validProjectStroke(test))return rejected('Invalid pipeline samples');
        const xy=copy(value.points),pressure=value.pressures?copy(value.pressures):undefined,from=value.fromSeq;
        const old=entry.through;entry.stroke={...entry.stroke,points:[...entry.stroke.points,...xy],pressures:[...(entry.stroke.pressures??Array(old).fill(1)),...(pressure??Array(added).fill(1))]};entry.through+=added;points+=added;progress(entry,'admitted');
        queue(async()=>{await driver.append(entry.operationId,from,xy,pressure);progress(entry,'preview',false,from+added-1);});return admission(entry);
      }
      if(value.kind==='cancel'){
        if(!shape(value,['kind','operationId']))return rejected('Invalid cancel');active=undefined;
        queue(async()=>{await driver.cancel(entry.operationId);retire(entry);progress(entry,'cancelled');entry.completed.resolve({kind:'rejected',error:{code:'cancelled',message:'Preview cancelled before durable finish',effect:'none'}});});return admission(entry);
      }
      if(!shape(value,['kind','operationId','throughSeq'])||value.throughSeq!==entry.through)return rejected('End must include the exact captured prefix');
      active=undefined;entry.ended=true;last=entry.operationId;progress(entry,'admitted');
      // Reserve this operation's place in the one mixed decision queue NOW,
      // before any asynchronous IO. Board metadata invoked next follows it.
      const decision=options.decide(entry);void decision.then(result=>{entry.completed.resolve(result);if(result.kind!=='settled')fail(Error('Main pipeline durable decision remains unresolved'));},e=>{fail(e);entry.completed.reject(e);});
      queue(async()=>{
        if(!ready||!anchor||!anchorRef)throw Error('Pipeline begin was not installed');
        const intent:PipelineImageOperationIntent={schema:'flow.image-edit-intent',version:2,operationId:entry.operationId,sessionId:options.sessionId,incarnation:options.incarnation,imageId:entry.imageId,pipelineId:ready.pipelineId,anchorCommitHash:anchor.commitHash,anchor:copy(anchorRef),expectedAtAnchor:copy(anchor.expected),predecessorOperationId:entry.predecessorOperationId,inputThrough:entry.through,stroke:copy(entry.stroke)};
        await options.persist(intent);entry.intent=intent;progress(entry,'intentDurable',true);
        if(blocked)throw blocked;
        const queued=await driver.end(entry.operationId,entry.through);
        if(queued.candidateId!==entry.operationId||queued.pipelineId!==ready.pipelineId||queued.predecessorOperationId!==entry.predecessorOperationId||queued.inputThrough!==entry.through||queued.epoch!==ready.epoch||queued.durable!==false)throw Error('Native queue admission differs from Main intent');
        entry.queued=copy(queued);progress(entry,'queued');schedule();
      });return admission(entry);
    }catch(e){return rejected(e instanceof Error?e.message:String(e),typeof(e as {code?:unknown})?.code==='string'?(e as {code:string}).code:'invalid-input');}
  };
  return {
    input,subscribe(f:(event:ImagePipelineProgress)=>void){listeners.add(f);return()=>listeners.delete(f);},
    waitOperation(operationId:string){const entry=entries.get(operationId);if(!entry)return Promise.reject(Error('Unknown pipeline operation'));return entry.completed.promise;},
    async accept(entry:PipelineEntry,prepared:PreparedImage,base:NativeImageRef,commitHash:string){
      progress(entry,'projectCommitted',true,entry.through,commitHash);await driver.accept(prepared,base);schedule();return entry.acceptedWait.promise;
    },
    release:retire,
    /** Closing admission is synchronous. An already-captured active gesture must
     * be explicitly ended/cancelled before a barrier can complete. */
    seal(){sealed=true;},
    async barrier(){
      sealed=true;if(active)throw Object.assign(Error('Finish/cancel captured gesture before the barrier'),{code:'busy',effect:'retained'});
      try{await inputTail;if(blocked)throw blocked;
      await Promise.all([...entries.values()].filter(e=>e.ended).map(e=>e.completed.promise));if(blocked)throw blocked;
      if(timer){clearTimeout(timer);timer=undefined;}if(polling)await polling;
      if(ready){await pump();await driver.stop();ready=undefined;}
      entries.clear();anchor=undefined;anchorRef=undefined;last=null;points=0;issued=0;
      }catch(e){fail(e);throw e;}
    },
    resumeAdmission(){if(!blocked)sealed=false;},
    fence:fail,
    async drainInput(){await inputTail;if(polling)await polling;},
    async retainForRecovery():Promise<RetainedImageInput[]>{
      // The worker has exited. Await Main-owned fsyncs too: worker death cannot
      // cancel an in-flight project-store publication or make it safe to forget.
      await inputTail;if(polling)await polling;
      const retained:RetainedImageInput[]=[];
      for(const entry of entries.values()){
        if(entry.retired)continue;
        if(!entry.ended||!ready||!anchor||!anchorRef){retained.push({operationId:entry.operationId,shotId:entry.shotId,imageId:entry.imageId,stroke:copy(entry.stroke),ended:entry.ended,reason:!ready?'missing-pipeline-identity':'incomplete-gesture'});continue;}
        if(!entry.intent){
          const intent:PipelineImageOperationIntent={schema:'flow.image-edit-intent',version:2,operationId:entry.operationId,sessionId:options.sessionId,incarnation:options.incarnation,imageId:entry.imageId,pipelineId:ready.pipelineId,anchorCommitHash:anchor.commitHash,anchor:copy(anchorRef),expectedAtAnchor:copy(anchor.expected),predecessorOperationId:entry.predecessorOperationId,inputThrough:entry.through,stroke:copy(entry.stroke)};
          await options.persist(intent);entry.intent=intent;progress(entry,'intentDurable',true);
        }
      }
      return retained;
    },
    retainedInputs():RetainedImageInput[]{return [...entries.values()].filter(e=>!e.retired&&!e.intent).map(e=>({operationId:e.operationId,shotId:e.shotId,imageId:e.imageId,stroke:copy(e.stroke),ended:e.ended,reason:ready?'incomplete-gesture':'missing-pipeline-identity'}));},
    assertRecoverable(){if(ready||blocked)throw Object.assign(Error('Reopen the native worker to reconcile this pipeline; unknown input is never replayed'),{effect:'retained'});},
    get hasActive(){return active!==undefined;},
    get started(){return ready!==undefined||anchor!==undefined;}
  };
}
