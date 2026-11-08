import fs from 'node:fs/promises';
import sharp from 'sharp';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { startImageEngine } from '../../../platform/main/imageEngineConnection.js';
import type { createImageEngineWorkerOwner } from '../../../platform/main/imageEngineWorkerOwner.js';
import type { NativeFrame } from '../../../platform/main/imageEngineFraming.js';
import type { NativeImageRef } from '../../../platform/contracts/imageProject.js';
import { validImageEngineEdit, validImageEnginePreviewStamp, validImageEngineProtectedSourcePolicy } from '../../../platform/contracts/imageEngine.js';
import type { ImageEngineEdit, ImageEngineEditContext, ImageEngineContextSummary, ImageEngineDisplayIdentity, ImageEnginePreviewStamp, ImageEnginePreviewResult, ImageEngineCreationInput, ImageEngineJobReservation, ImageEngineInspection, ImageEngineSourceOptions } from '../../../platform/contracts/imageEngine.js';
import { validSelection } from '../../../platform/contracts/flowSelection.js';
import type { FlowSelection } from '../../../platform/contracts/flowSelection.js';
import { parseNativeProductContext, parseNativeInspection } from './nativeProductContext.js';
import type { FlowStroke } from '../../../platform/contracts/flowWave2.js';
import type { NativeOperationStatus, NativeSessionDriver, PreparedImage } from '../../../session/core/nativeSession.js';
import { validNativeImageRef, validProjectStroke } from '../../../session/core/imageProjectModel.js';
import { record, same } from '../../../session/core/imageProjectValues.js';
import type { NativePipelineDriver, PipelineLimits, PipelineReady, PipelineQueued, PipelinePrepared, PipelineState, PipelineEvent } from '../../../session/core/nativePipeline.js';
import type { RetainedSourceObject } from './sourceStore.js';
import { validWorkspaceOutputMetadataEnvelope } from './workspaceOutputContract.js';
import type { WorkspaceOutputMetadataEnvelope } from './workspaceOutputContract.js';
import type {ImageEngineSourceDisplayProof,ImageEngineProtectedSourcePolicy} from '../../../platform/contracts/imageEngine.js';

export type NativeCreationPage={snapshotToken:string;totalUnsettled:number;entries:{operationId:string;state:'intent'|'prepared';prepared?:PreparedImage}[];nextCursor:string|null};
export type NativeCreationStatus=NativeOperationStatus|{state:'pending';phase:string};
export type NativeVersionOutput={bytes:Uint8Array;sha256:string;byteLength:number;width:number;height:number;layerCount:number;versionId:string;documentId:string;metadataSha256:string};
export type NativeRetainedPreparation={kind:'editable';prepared:PreparedImage;proof:ImageEngineSourceDisplayProof}|{kind:'reference';prepared:PreparedImage;proof:ImageEngineSourceDisplayProof;policy:ImageEngineProtectedSourcePolicy;reason:{code:string;message:string}};
export type NativeProductDriver = {
  /** Reads the authenticated immutable version JSON; no actor IO/thumbnail gate. */
  versionSourcePolicy(ref:NativeImageRef):Promise<ImageEngineProtectedSourcePolicy|null>;
  prepareRetainedGuarded(operationId:string,source:RetainedSourceObject,formatHint:'tiff'|'psd',reservation:ImageEngineJobReservation,options?:ImageEngineSourceOptions):Promise<NativeRetainedPreparation>;
  exportVersion(ref:NativeImageRef,format:'psd'|'tiff',metadata:WorkspaceOutputMetadataEnvelope,maxBytes?:number):Promise<NativeVersionOutput>;
  prepareCreation(operationId:string,input:ImageEngineCreationInput,reservation:ImageEngineJobReservation):Promise<PreparedImage>;
  prepareRetained(operationId:string,source:RetainedSourceObject,formatHint:string,reservation:ImageEngineJobReservation,options?:ImageEngineSourceOptions):Promise<PreparedImage>;
  settleCreation(value:PreparedImage):Promise<NativeImageRef>;
  listCreations(options?:{cursor?:string;snapshotToken?:string;limit?:number}):Promise<NativeCreationPage>;
  creationStatus(operationId:string):Promise<NativeCreationStatus>;
  discardCreation(operationId:string):Promise<void>;
  activate(ref:NativeImageRef):Promise<void>;
  inspectVersion(ref:NativeImageRef,limits?:{maxEdge:number;maxBytes:number}):Promise<ImageEngineInspection>;
  prepareEdit(operationId:string,base:NativeImageRef,edit:ImageEngineEdit,context:ImageEngineEditContext):Promise<PreparedImage>;
  summary():Promise<ImageEngineContextSummary>;
  selectLayerContext(base:NativeImageRef,layerId:string,expectedContextGeneration:number):Promise<ImageEngineContextSummary>;
  selectionContext(base:NativeImageRef,layerId:string,selection:FlowSelection|null,expectedContextGeneration:number):Promise<ImageEngineContextSummary>;
  previewEdit(base:NativeImageRef,previewId:string,fromSeq:number,edit:ImageEngineEdit,expectedContextGeneration:number):Promise<ImageEnginePreviewResult>;
  cancelEditPreview(base:NativeImageRef,stamp:ImageEnginePreviewStamp):Promise<ImageEngineContextSummary>;
  displayIdentity():ImageEngineDisplayIdentity|null;
  contextGeneration():number|null;
};
type Connection=ReturnType<typeof startImageEngine>;
type WorkerOwner=Awaited<ReturnType<typeof createImageEngineWorkerOwner>>;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function refuse(message:string,code='conflict',effect:'none'|'retained'|'unknown'='none'):never{throw Object.assign(Error(message),{code,effect});}
async function boundedFile(file:string,limit:number,expected?:RetainedSourceObject['identity']){
  if(!path.isAbsolute(file)||await fs.realpath(file)!==file||typeof constants.O_NOFOLLOW!=='number')refuse('Native input path cannot be verified');
  const entry=await fs.lstat(file,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.size>BigInt(limit))refuse('Native input exceeds bounds');
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await h.stat({bigint:true});if(before.dev!==entry.dev||before.ino!==entry.ino)refuse('Native input changed while opening');
    if(expected&&(expected.dev!==String(before.dev)||expected.ino!==String(before.ino)||expected.size!==String(before.size)||expected.mtimeNs!==String(before.mtimeNs)||expected.ctimeNs!==String(before.ctimeNs)))refuse('Retained source identity changed before streaming');
    const parts:Buffer[]=[],buf=Buffer.allocUnsafe(64<<10);let n=0;
    while(true){const r=await h.read(buf,0,Math.min(buf.length,limit-n+1),n);if(!r.bytesRead)break;n+=r.bytesRead;if(n>limit)refuse('Native input grew beyond bounds');parts.push(Buffer.from(buf.subarray(0,r.bytesRead)));}
    const after=await h.stat({bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||BigInt(n)!==before.size)refuse('Native input changed during streaming');return Buffer.concat(parts,n);
  }finally{await h.close();}
}

/** Real Node transport adapter. Only these Flow operations cross the seam. No
 * file Save, native user Undo, arbitrary command or renderer path. */
export function createNativeSessionAdapter(options:{storeRoot:string;storeId:string;onFrame?:(frame:NativeFrame)=>void}&({connection:Connection;workerOwner?:never}|{workerOwner:WorkerOwner;connection?:never})){
  const owner=options.workerOwner,initial=owner?.current(),storeId=options.storeId,storeRoot=options.storeRoot;
  if(!initial&&!options.connection)refuse('Worker owner has no available native connection','unavailable','unknown');
  let connection:Connection=initial?.connection??options.connection!,generation=initial?.generation??0,fenced=false,closing=false,faultNotified=false;
  const faultListeners=new Set<()=>void>();
  const fault=()=>{if(owner)fenced=true;if(closing||faultNotified)return;faultNotified=true;for(const f of faultListeners)try{void Promise.resolve(f()).catch(()=>{});}catch{/* Session remains fenced */}};
  const armExit=()=>{const captured=connection,epoch=generation;void captured.exited.then(()=>{if(epoch===generation&&captured===connection)fault();});};armExit();
  const requireCurrent=()=>{if(owner&&(fenced||owner.current()?.connection!==connection||owner.current()?.generation!==generation)){fault();refuse('Worker generation is unavailable; reconcile original input','worker-unavailable','unknown');}return connection;};
  // Bind the whole logical operation before any local IO. Per-call fencing alone
  // would let a coroutine stalled in a manifest/source read adopt a new worker.
  const operationContext=()=>{
    const target=requireCurrent(),epoch=generation;
    const identity=()=>{if(epoch!==generation||target!==connection)refuse('Old native operation fenced','worker-unavailable','unknown');};
    return{connection:target,identity,check(){identity();if(requireCurrent()!==target)refuse('Native operation context changed','worker-unavailable','unknown');}};
  };
  let display:ImageEngineDisplayIdentity|null=null,contextGeneration:number|null=null;
  let current:NativeImageRef|null=null,candidate:string|undefined,previewOperation:string|undefined,serial=0;
  const next=()=>`control-${++serial}`;
  type Job={input:boolean;run():Promise<void>};const jobs:Job[]=[];let running=false,inputRun=0;
  // Single wire owner. A waiting CAS is never enqueued here; after at most eight
  // input commands one waiting poll/accept gets a turn, so IO cannot starve.
  const wire=<T>(input:boolean,work:()=>Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
    if(jobs.length>=512){reject(Object.assign(Error('Native short-command queue full'),{code:'backpressure',effect:'none'}));return;}
    jobs.push({input,run:async()=>{try{resolve(await work());}catch(e){reject(e);}}});
    if(!running){running=true;void(async()=>{while(jobs.length){const control=jobs.findIndex(j=>!j.input);let index=inputRun>=8&&control>=0?control:jobs.findIndex(j=>j.input);if(index<0)index=0;const [job]=jobs.splice(index,1);if(job.input)inputRun++;else inputRun=0;await job.run();}running=false;})();}
  });
  const call=async(operationId:string,body:Record<string,unknown>,base:string|null=current?.versionId??null,payload?:Uint8Array,input=false)=>{
    const captured=structuredClone(body),capturedPayload=payload?new Uint8Array(payload):undefined,target=requireCurrent(),epoch=generation;
    const assertGeneration=()=>{if(epoch!==generation||target!==requireCurrent())refuse('Old worker reply/command fenced','worker-unavailable','unknown');};
    try{
      const frame=await wire(input,async()=>{assertGeneration();return target.request(operationId,captured,base,capturedPayload);});assertGeneration();const reply=frame.header.body;
      if(!record(reply)||typeof reply.kind!=='string')refuse('Malformed native reply','protocol','unknown');
      if(reply.kind==='failure'){const error=reply.error;if(!record(error)||typeof error.message!=='string')refuse('Malformed native failure','protocol','unknown');refuse(error.message,String(error.code??'native'),error.effect==='none'?'none':error.effect==='retained'?'retained':'unknown');}
      const shown=record(reply.frame)?reply.frame:reply;
      if(typeof shown.documentId==='string'&&Number.isSafeInteger(shown.epoch)&&Number(shown.epoch)>=0){
        display={sessionId:String(frame.header.sessionId),incarnation:String(frame.header.incarnation),documentId:shown.documentId,workerEpoch:Number(frame.header.workerEpoch),epoch:Number(shown.epoch)};
      }else if(reply.documentId===null)display=null;
      if(Number.isSafeInteger(reply.contextGeneration)&&Number(reply.contextGeneration)>=0)contextGeneration=Number(reply.contextGeneration);
      if(record(reply.frame))try{void Promise.resolve(options.onFrame?.(frame)).catch(()=>{});}catch{/* presentation only */}return{reply,frame};
    }catch(e){if(epoch===generation&&target===connection&&(e as {effect?:unknown})?.effect!=='none')fault();throw e;}
  };
  const nativeRef=(receipt:unknown):NativeImageRef=>{
    if(!record(receipt)||receipt.schema!=='flow.image-version'||receipt.version!==1)refuse('Invalid native version receipt','protocol','unknown');
    const ref={storeId,documentId:receipt.documentId,versionId:receipt.versionId,manifestSha256:receipt.manifestSha256,width:receipt.width,height:receipt.height};
    if(!validNativeImageRef(ref))refuse('Invalid native version identity','protocol','unknown');return ref;
  };
  const prepared=(reply:Record<string,unknown>):PreparedImage=>{
    if(reply.kind!=='prepared'||typeof reply.candidateId!=='string'||(reply.baseVersion!==null&&typeof reply.baseVersion!=='string'))refuse('Expected durable native prepared receipt','protocol','unknown');
    candidate=reply.candidateId;return{candidateId:reply.candidateId,baseVersion:reply.baseVersion,native:nativeRef(reply.receipt)};
  };
  const verifyNativeFile=async(ref:NativeImageRef):Promise<ImageEngineProtectedSourcePolicy|null>=>{
    if(!validNativeImageRef(ref)||ref.storeId!==storeId)refuse('Unknown native store/ref');
    const raw=await boundedFile(path.join(storeRoot,'versions',ref.versionId+'.json'),16<<20);
    if(sha(raw)!==ref.versionId||ref.versionId!==ref.manifestSha256)refuse('Native manifest hash changed','corrupt','retained');
    const parsed:unknown=JSON.parse(raw.toString('utf8'));
    if(!record(parsed)||parsed.schema!=='flow.image-native-snapshot'||parsed.version!==1||parsed.documentId!==ref.documentId||!record(parsed.nativeManifest)||!record(parsed.nativeManifest.document)||!record(parsed.nativeManifest.document.size)||parsed.nativeManifest.document.size.width!==ref.width||parsed.nativeManifest.document.size.height!==ref.height)refuse('Native manifest geometry/identity mismatch','corrupt','retained');
    const source=parsed.source;if(source!==null&&source!==undefined&&!record(source))refuse('Malformed immutable native source','corrupt','retained');
    const policy=record(source)?source.displayPolicy:undefined;
    if(policy!==undefined&&policy!==null){if(!validImageEngineProtectedSourcePolicy(policy)||!record(source)||source.digest!==policy.original.digest||source.byteLength!==policy.original.byteLength||source.formatHint!==policy.original.format||typeof source.protectedBaseManifestSha256!=='string'||!/^[0-9a-f]{64}$/.test(source.protectedBaseManifestSha256))refuse('Malformed immutable protected source binding','corrupt','retained');}
    // Full compressed object verification occurs inside native load/install;
    // a live prepared receipt already follows native durable object publication.
    return policy==null?null:structuredClone(policy as ImageEngineProtectedSourcePolicy);
  };
  const verifyNative=async(ref:NativeImageRef)=>{await verifyNativeFile(ref);};
  const install=async(ref:NativeImageRef)=>{
    const op=operationContext();await verifyNative(ref);op.check();if(current&&same(current,ref))return;
    const result=await call(next(),current?{kind:'install',versionId:ref.versionId}:{kind:'load',versionId:ref.versionId});op.check();
    if(!['installed','loaded'].includes(result.reply.kind as string)||result.reply.versionId!==ref.versionId)refuse('Native install identity mismatch','protocol','unknown');current={...ref};
  };
  const capture=async()=>{const op=operationContext();if(!current)refuse('No native editing target');const result=await call(next(),{kind:'capture'},pipelineReady?.anchorVersion??current.versionId);op.check();return result.frame;};
  const confirm=async(ref:NativeImageRef,base:NativeImageRef|null)=>{
    const op=operationContext();
    // An accepted journal record alone does not prove that context installation
    // succeeded. A successful base-checked Capture confirms the actual context.
    try{await call(next(),{kind:'capture'},ref.versionId);op.check();current={...ref};return;}
    catch(e){if((e as {code?:string}).code!=='conflict')throw e;}
    if(!base)refuse('Native accepted context remains unknown','conflict','unknown');
    await call(next(),{kind:'capture'},base.versionId);op.check();current={...base};await install(ref);op.check();
  };
  const brushFor=(stroke:FlowStroke)=>{
    if(!validProjectStroke(stroke))refuse('Invalid stroke');
    const product=Boolean(stroke.brush&&requireCurrent().supports('flowBrushPresetsV1'));
    if(stroke.brush&&!product&&(stroke.brush.tip!=='hard'||stroke.brush.grain!==0||stroke.brush.pressureSize!==0||stroke.brush.pressureOpacity!==0))refuse('Native binary lacks flowBrushPresetsV1 for this product preset; original input retained.','unsupported-brush');
    if(stroke.brush&&(!['hard','soft','pencil'].includes(stroke.brush.tip)||![stroke.brush.hardness,stroke.brush.grain,stroke.brush.pressureSize,stroke.brush.pressureOpacity].every(n=>n>=0&&n<=1)||stroke.brush.spacing<0.01||stroke.brush.spacing>1||!Number.isInteger(stroke.brush.seed)||stroke.brush.seed<0||stroke.brush.seed>0xffffffff))refuse('Invalid product brush settings','invalid-input');
    const seed=stroke.brush?.seed??0;if(!Number.isSafeInteger(seed)||seed<0)refuse('Native pipeline requires a nonnegative safe integer seed');
    return{flowProduct:true,size:stroke.size,opacity:stroke.opacity,color:stroke.color,erase:stroke.tool==='eraser',hardness:stroke.brush?.hardness??1-stroke.softness,spacing:stroke.brush?.spacing??0.06,seed,...(product?{flowBrush:structuredClone(stroke.brush)}:{brush:{pressureSize:false,pressureOpacity:false}})};
  };
  const pointBatch=(xy:readonly number[],pressures?:readonly number[])=>Array.from({length:xy.length/2},(_,i)=>({x:xy[i*2],y:xy[i*2+1],pressure:pressures?.[i]??1}));
  let pipelineReady:PipelineReady|undefined;
  const pipelineBase=()=>{if(!pipelineReady)refuse('No active native pipeline');return pipelineReady.anchorVersion;};
  const queued=(r:Record<string,unknown>):PipelineQueued=>{
    if(r.kind!=='queued'||r.durable!==false||typeof r.candidateId!=='string'||typeof r.pipelineId!=='string'||(r.predecessorOperationId!==null&&typeof r.predecessorOperationId!=='string')||!Number.isSafeInteger(r.inputThrough)||!Number.isSafeInteger(r.frameInputThrough)||!Number.isSafeInteger(r.epoch)||typeof r.inputDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.inputDigest))refuse('Invalid native volatile queue receipt','protocol','unknown');
    return r as unknown as PipelineQueued;
  };
  const pipeline:NativePipelineDriver={
    validateStroke(stroke){requireCurrent();brushFor(stroke);},
    async start(base,limits){
      const op=operationContext();
      if(!requireCurrent().supports('strokePipelineV1'))refuse('Native binary does not support strokePipelineV1','unsupported');
      await install(base);op.check();const{reply}=await call(next(),{kind:'pipelineStart',...limits},base.versionId);op.check();
      if(reply.kind!=='pipelineReady'||typeof reply.pipelineId!=='string'||typeof reply.documentId!=='string'||typeof reply.anchorVersion!=='string'||!Number.isSafeInteger(reply.epoch)||!same(reply.limits,limits))refuse('Invalid native pipeline start','protocol','unknown');
      pipelineReady={pipelineId:reply.pipelineId,anchorVersion:reply.anchorVersion,documentId:reply.documentId,epoch:Number(reply.epoch),limits:{...limits}};return structuredClone(pipelineReady);
    },
    async begin(operationId,predecessorOperationId,stroke){
      const op=operationContext();
      const points=pointBatch(stroke.points,stroke.pressures);previewOperation=operationId;
      const{reply}=await call(`${operationId}-begin`,{kind:'strokeBegin',previewId:operationId,predecessorOperationId,brush:brushFor(stroke),points:points.slice(0,256)},pipelineBase(),undefined,true).catch(e=>{if((e as {effect?:unknown}).effect==='none'&&previewOperation===operationId)previewOperation=undefined;throw e;});op.check();
      if(reply.kind!=='frame')refuse('Native begin did not confirm preview','protocol','unknown');
      for(let offset=256;offset<points.length;offset+=256){await pipeline.append(operationId,offset+1,stroke.points.slice(offset*2,(offset+256)*2),stroke.pressures?.slice(offset,offset+256));op.check();}
    },
    async append(operationId,fromSeq,xy,pressure){
      const op=operationContext();
      const points=pointBatch(xy,pressure);for(let offset=0;offset<points.length;offset+=256){
        const{reply}=await call(`${operationId}-points-${fromSeq+offset}`,{kind:'strokeAppend',previewId:operationId,fromSeq:fromSeq+offset,points:points.slice(offset,offset+256)},pipelineBase(),undefined,true);op.check();
        if(reply.kind!=='frame')refuse('Native append did not confirm preview','protocol','unknown');
      }
    },
    async end(operationId,throughSeq){const op=operationContext();const{reply}=await call(operationId,{kind:'strokeFinish',previewId:operationId,throughSeq},pipelineBase(),undefined,true);op.check();const value=queued(reply);previewOperation=undefined;return value;},
    async cancel(operationId){const op=operationContext();const{reply}=await call(next(),{kind:'strokeCancel',previewId:operationId},pipelineBase(),undefined,true);op.check();if(reply.kind!=='cancelled')refuse('Native pipeline preview cancellation unconfirmed','protocol','unknown');previewOperation=undefined;},
    async poll(){
      const op=operationContext();
      const{reply}=await call(next(),{kind:'pipelinePoll',pipelineId:pipelineReady?.pipelineId},pipelineBase());op.check();
      if(reply.kind!=='pipelineState'||typeof reply.pipelineId!=='string'||typeof reply.anchorVersion!=='string'||typeof reply.acceptedVersion!=='string'||!Array.isArray(reply.events)||!Number.isSafeInteger(reply.availableSlots)||!Number.isSafeInteger(reply.queueDepth))refuse('Invalid native pipeline poll','protocol','unknown');
      const events:PipelineEvent[]=reply.events.map(event=>{
        if(!record(event)||typeof event.operationId!=='string'||!record(event.result))refuse('Invalid native pipeline event','protocol','unknown');const r=event.result;
        if(r.kind==='accepted')return{operationId:event.operationId,kind:'accepted',native:nativeRef(r.receipt)};
        if(r.kind!=='prepared'||typeof r.candidateId!=='string'||typeof r.baseVersion!=='string'||(r.predecessorOperationId!==null&&typeof r.predecessorOperationId!=='string')||!Number.isSafeInteger(r.inputThrough)||!Number.isSafeInteger(r.frameInputThrough)||!Number.isSafeInteger(r.epoch)||typeof r.inputDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.inputDigest))refuse('Native pipeline preparation failed or has malformed prefix','protocol','retained');
        const p:PipelinePrepared={candidateId:r.candidateId,baseVersion:r.baseVersion,native:nativeRef(r.receipt),predecessorOperationId:r.predecessorOperationId as string|null,inputThrough:Number(r.inputThrough),frameInputThrough:Number(r.frameInputThrough),epoch:Number(r.epoch),inputDigest:r.inputDigest};return{operationId:event.operationId,kind:'prepared',prepared:p};
      });
      return{pipelineId:reply.pipelineId,anchorVersion:reply.anchorVersion,acceptedVersion:reply.acceptedVersion,events,blocked:reply.blocked,availableSlots:Number(reply.availableSlots),queueDepth:Number(reply.queueDepth)};
    },
    async accept(value,base){const op=operationContext();const{reply}=await call(next(),{kind:'accept',candidateId:value.candidateId},base.versionId);op.check();if(reply.kind==='accepted'){if(!same(nativeRef(reply.receipt),value.native))refuse('Native repeated accept mismatch','protocol','unknown');return;}if(reply.kind!=='acceptQueued'||reply.durable!==false||reply.candidateId!==value.candidateId)refuse('Native pipeline accept admission mismatch','protocol','unknown');current={...value.native};},
    async stop(){const op=operationContext();const{reply}=await call(next(),{kind:'pipelineStop',pipelineId:pipelineReady?.pipelineId},pipelineBase());op.check();if(reply.kind!=='pipelineStopped'||reply.versionId!==current?.versionId)refuse('Native pipeline barrier mismatch','protocol','unknown');pipelineReady=undefined;}
  };
  let immutableJobToken:object|undefined;
  const inspectionCache=new Map<string,ImageEngineInspection>();
  const cacheInspection=(key:string,value:ImageEngineInspection)=>{inspectionCache.set(key,value);while(inspectionCache.size>16)inspectionCache.delete(inspectionCache.keys().next().value!);};
  const copyInspection=(v:ImageEngineInspection):ImageEngineInspection=>({...structuredClone({summary:v.summary,thumbnail:v.thumbnail}),bytes:new Uint8Array(v.bytes)});
  const immutableClaim=()=>{if(immutableJobToken)refuse('One immutable image job already in flight','backpressure');const token={};immutableJobToken=token;return()=>{if(immutableJobToken===token)immutableJobToken=undefined;};};
  const immutableCap=()=>{if(!requireCurrent().supports('detachedImageJobsV1'))refuse('Native binary lacks detachedImageJobsV1','unsupported');};
  const reservationLimit=(v:ImageEngineJobReservation)=>{if(!v||!Number.isSafeInteger(v.maxAdditionalBytes)||v.maxAdditionalBytes<16384||v.maxAdditionalBytes>8*1024**3)refuse('A Main recovery reservation of 16KiB..8GiB is required','invalid-input');return v.maxAdditionalBytes;};
  const versionIdentity=(v:NativeImageRef)=>({versionId:v.versionId,documentId:v.documentId,width:v.width,height:v.height});
  const waitImmutable=async(op:ReturnType<typeof operationContext>,jobId:string,started:{reply:Record<string,unknown>;frame:NativeFrame})=>{
    let value=started;
    while(true){op.check();const r=value.reply;
      if(r.kind==='detachedState'&&r.finished===true){if(!record(r.result))refuse('Immutable result missing','protocol','unknown');const result=r.result;
        if(result.kind==='failed'){const e=result.error;if(!record(e)||typeof e.message!=='string')refuse('Malformed immutable failure','protocol','unknown');if(result.globalFailure===true)fault();refuse(e.message,String(e.code??'native'),e.effect==='none'?'none':e.effect==='retained'?'retained':'unknown');}
        return{result,payload:value.frame.payload};
      }
      if(!['detachedQueued','detachedState'].includes(String(r.kind))||r.jobId!==jobId)refuse('Immutable job identity mismatch','protocol','unknown');
      await new Promise(resolve=>setTimeout(resolve,8));op.check();value=await call(next(),{kind:'detachedPoll',jobId},null);op.check();
    }
  };
  const detachedPrepared=(operationId:string,r:Record<string,unknown>,payload:Uint8Array):PreparedImage=>{
    if(!['prepared','accepted'].includes(String(r.kind))||r.detached!==true||r.candidateId!==operationId)refuse('Expected detached durable candidate','protocol','unknown');
    const native=nativeRef(r.receipt);if(record(r.summary)&&payload.length){const view=parseNativeInspection(r.summary,payload,native,sha(payload));cacheInspection(native.versionId,view);}
    return{candidateId:operationId,baseVersion:null,native};
  };
  const activate=async(ref:NativeImageRef)=>{
    ref=structuredClone(ref);
    const op=operationContext();immutableCap();const before=current?{...current}:null;
    await verifyNative(ref);op.check();if(!same(current,before))refuse('Active target changed while verifying navigation');
    const{reply}=await call(next(),{kind:'activate',versionId:ref.versionId},before?.versionId??null);op.check();
    if(reply.kind!=='activated'||reply.versionId!==ref.versionId||reply.documentId!==ref.documentId||!Number.isSafeInteger(reply.epoch))refuse('Native activation identity mismatch','protocol','unknown');current={...ref};candidate=undefined;previewOperation=undefined;
  };
  const contextSummary=async()=>{
    const op=operationContext();
    if(!op.connection.supports('toolContextSummaryV1')||!op.connection.supports('decimalLayerIdsV1')||!op.connection.supports('temporarySelectionContextV1')||!op.connection.supports('intrinsicSelectionPaintGuardV1'))refuse('Native binary lacks typed product context','unsupported');
    const{reply}=await call(next(),{kind:'summary',maxBytes:49152},pipelineReady?.anchorVersion??current?.versionId??null);op.check();
    if(!display)refuse('Native context has no display identity','protocol','unknown');return parseNativeProductContext(reply,display);
  };
  const layerContext=async(kind:'selectLayerContext'|'selectionContext',base:NativeImageRef,layerId:string,expectedContextGeneration:number,selection?:FlowSelection|null)=>{
    const op=operationContext();
    if(!op.connection.supports('temporarySelectionContextV1')||!op.connection.supports('decimalLayerIdsV1'))refuse('Native binary lacks temporarySelectionContextV1','unsupported');
    if(!current||!same(base,current))refuse('Context target is not the installed image');
    if(!/^(0|[1-9][0-9]{0,19})$/.test(layerId)||BigInt(layerId)>18446744073709551615n||!Number.isSafeInteger(expectedContextGeneration)||expectedContextGeneration<0||(kind==='selectionContext'&&selection!==null&&!validSelection(selection)))refuse('Invalid temporary context input','invalid-input');
    const{reply}=await call(next(),{kind,layerId,expectedContextGeneration,...(kind==='selectionContext'?{selection:structuredClone(selection)}:{})},base.versionId);op.check();
    if(reply.kind!==(kind==='selectionContext'?'selectionContextUpdated':'contextUpdated')||reply.imageVersionRef!==base.versionId)refuse('Native context identity mismatch','protocol','unknown');
    const summary=await contextSummary();op.check();return summary;
  };
  const driver:NativeSessionDriver & NativeProductDriver & {resume():Promise<void>}={
    async versionSourcePolicy(ref){return verifyNativeFile(structuredClone(ref));},
    ...(owner?{async restartForRecovery(){
      fenced=true;generation++; // Fence queued Adapter jobs before awaiting owned exit.
      const restarting=generation,handle=await owner.restart();if(restarting!==generation)refuse('Old worker replacement fenced','worker-unavailable','unknown');connection=handle.connection;generation=handle.generation;
      immutableJobToken=undefined;inspectionCache.clear();display=null;contextGeneration=null;current=null;candidate=undefined;previewOperation=undefined;pipelineReady=undefined;
      faultNotified=false;closing=false;fenced=false;armExit();
    }}:{}),
    onFault(listener){faultListeners.add(listener);return()=>faultListeners.delete(listener);},
    pipeline,
    summary:contextSummary,
    activate,
    async exportVersion(ref,format,metadata,maxBytes=64<<20){
      const op=operationContext();if(!op.connection.supports('readonlyExportMetadataV1'))refuse('Native binary lacks readonlyExportMetadataV1','unsupported');
      const pinned=structuredClone(ref),envelope=structuredClone(metadata);
      if(!['psd','tiff'].includes(format)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>(64<<20)||!validWorkspaceOutputMetadataEnvelope(envelope))refuse('Invalid readonly output metadata, format or budget','invalid-input');
      const payload=new TextEncoder().encode(JSON.stringify(envelope)),metadataSha256=sha(payload);await verifyNative(pinned);op.check();
      const {reply:r,frame}=await call(next(),{kind:'export',versionId:pinned.versionId,documentId:pinned.documentId,format,maxBytes,metadata:{sha256:metadataSha256,byteLength:payload.length}},current?.versionId??null,payload);op.check();
      const bytes=new Uint8Array(frame.payload),sha256=sha(bytes),signature=Buffer.from(bytes.subarray(0,4)).toString('hex');
      if(r.kind!=='exported'||r.exportedDocumentId!==pinned.documentId||r.versionId!==pinned.versionId||r.format!==format||r.width!==pinned.width||r.height!==pinned.height||r.byteLength!==bytes.length||!bytes.length||bytes.length>maxBytes||r.sha256!==sha256||r.metadataSha256!==metadataSha256||r.layered!==true||!Number.isSafeInteger(r.layerCount)||Number(r.layerCount)<1||Number(r.layerCount)>64||!Array.isArray(r.warnings)||r.warnings.length!==0||(format==='psd'?signature!=='38425053':!['49492a00','4d4d002a'].includes(signature)))refuse('Readonly output bytes do not match pinned metadata/version receipt','protocol','unknown');
      return{bytes,sha256,byteLength:bytes.length,width:pinned.width,height:pinned.height,layerCount:Number(r.layerCount),versionId:pinned.versionId,documentId:pinned.documentId,metadataSha256};
    },
    async prepareCreation(operationId,input,reservation){
      input=structuredClone(input);
      const op=operationContext();immutableCap();const release=immutableClaim();
      try{const maximum=reservationLimit(reservation);let nativeInput:Record<string,unknown>;
        if(input.kind==='new'){if(!Number.isSafeInteger(input.width)||!Number.isSafeInteger(input.height)||input.width<1||input.height<1||input.width>8192||input.height>8192||input.width*input.height>16*1024**2)refuse('Native creation dimensions exceed current bounds','limit');nativeInput={kind:'new',width:input.width,height:input.height};}
        else if(input.kind==='duplicate'){const source=structuredClone(input.source);await verifyNative(source);op.check();nativeInput={kind:'duplicate',source:versionIdentity(source)};}else refuse('Unknown creation input','invalid-input');
        const started=await call(operationId,{kind:'detachedPrepare',input:nativeInput,maxAdditionalBytes:maximum},null);op.check();const value=await waitImmutable(op,operationId,started);op.check();const result=detachedPrepared(operationId,value.result,value.payload);if(result.native.width!==(input.kind==='new'?input.width:input.source.width)||result.native.height!==(input.kind==='new'?input.height:input.source.height)||(input.kind==='duplicate'&&result.native.documentId===input.source.documentId))refuse('Creation geometry/document identity mismatch','protocol','unknown');return result;
      }finally{release();}
    },
    async prepareRetainedGuarded(operationId,source,formatHint,reservation,sourceOptions={}){
      const op=operationContext();immutableCap();if(!op.connection.supports('sourceDisplayGuardV1')||!op.connection.supports('protectedReferenceV1'))refuse('Native binary lacks sourceDisplayGuardV1/protectedReferenceV1','unsupported');
      const captured=structuredClone(source),options=structuredClone(sourceOptions),grant=structuredClone(reservation),maximum=reservationLimit(grant),displayTolerance=options.displayTolerance??2;if(!Number.isSafeInteger(displayTolerance)||displayTolerance<0||displayTolerance>16)refuse('Main display tolerance must be an integer 0..16','invalid-input');
      if(!['tiff','psd'].includes(formatHint)||captured.byteLength>(8<<20))refuse('Guarded retained source exceeds current format/8MiB admission; original retained','limit');
      const interpretationId=options.interpretationId;if(interpretationId!==undefined&&interpretationId!=='photocraft-v1'&&interpretationId!=='flow-v1-upgrade')refuse('Unknown source interpretation','unsupported');
      if(interpretationId==='flow-v1-upgrade'&&!op.connection.supports('flowV1UpgradeInterpretationV1'))refuse('Native binary lacks flowV1UpgradeInterpretationV1','unsupported');
      const release=immutableClaim();
      try{
       const original=await boundedFile(captured.path,8<<20,captured.identity);op.check();if(original.length!==captured.byteLength||sha(original)!==captured.digest)refuse('Retained source digest changed','corrupt','retained');
       let payload:Uint8Array=original,display:Record<string,unknown>|null=null;
       if(formatHint==='tiff'){
        // This bounded non-preemptible decoder phase begins only at a confirmed
        // native idle boundary. New input remains free to use the native actor.
        while(true){try{await call(next(),{kind:'admitSourceDisplay'},null);op.check();break;}catch(e){op.check();if((e as any)?.code!=='backpressure'||(e as any)?.effect!=='none')throw e;await new Promise(resolve=>setTimeout(resolve,8));op.check();}}
        const embedded=await sharp(original,{failOn:'error',limitInputPixels:16<<20}).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true}).catch(error=>{if(/pixel limit|memory limit/i.test(String(error)))refuse('Source retained but exceeds the current display resource capacity','limit');throw error;});op.check();
        const {width,height,channels}=embedded.info;if(channels!==4||width>8192||height>8192||width*height>(16<<20))refuse('Independent source display exceeds current canvas budget','limit');
        for(let i=0;i<embedded.data.length;i+=4)if(embedded.data[i+3]===0)embedded.data.fill(0,i,i+3);
        const png=await sharp(embedded.data,{raw:{width,height,channels:4}}).png().toBuffer();op.check();if(png.length>(32<<20))refuse('Independent source display exceeds 32MiB PNG budget; original retained without resizing','limit');
        display={sourceDigest:captured.digest,sha256:sha(png),byteLength:png.length,rgbaSha256:sha(embedded.data),width,height};payload=Buffer.concat([original,png]);
       }
       const identity={digest:captured.digest,byteLength:captured.byteLength,formatHint,...(interpretationId?{interpretationId}:{})};const started=await call(operationId,{kind:'detachedPrepare',input:{kind:'guardedSource',source:identity,display,displayTolerance},maxAdditionalBytes:maximum},null,payload);op.check();const done=await waitImmutable(op,operationId,started);op.check();
       const r=done.result;if(r.kind==='discarded')refuse('Guarded source operation was explicitly discarded','conflict');const p=r.sourceDisplayProof,hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
       if(!record(p)||p.schema!=='flow.source-display-proof'||p.version!==1||!same(p.source,identity)||!Number.isSafeInteger(p.width)||!Number.isSafeInteger(p.height)||Number(p.width)<1||Number(p.height)<1||Number(p.width)>8192||Number(p.height)>8192||Number(p.width)*Number(p.height)>(16<<20)||!hash(p.embeddedRgbaSha256)||p.nativeRgbaSha256!==null&&!hash(p.nativeRgbaSha256)||p.maxChannelDifference!==null&&(!Number.isSafeInteger(p.maxChannelDifference)||Number(p.maxChannelDifference)<0||Number(p.maxChannelDifference)>255)||p.tolerance!==displayTolerance||display&&p.embeddedRgbaSha256!==display.rgbaSha256)refuse('Malformed source display proof','protocol','unknown');
       const proof=structuredClone(p) as ImageEngineSourceDisplayProof,prepared=detachedPrepared(operationId,r,done.payload);if(prepared.native.width!==proof.width||prepared.native.height!==proof.height||!record(r.receipt)||!record(r.receipt.source))refuse('Guarded source receipt mismatch','protocol','unknown');
       const provenance=r.receipt.source;for(const k of ['digest','byteLength','formatHint','interpretationId'] as const)if(provenance[k]!==identity[k])refuse('Guarded source provenance mismatch','protocol','unknown');
       if(r.classification==='editable'){if(provenance.displayPolicy!==undefined||!hash(p.nativeRgbaSha256)||p.maxChannelDifference===null||Number(p.maxChannelDifference)>displayTolerance)refuse('Unproven editable source classification','protocol','unknown');return{kind:'editable',prepared,proof};}
       const policy=provenance.displayPolicy,reason=p.reason;if(r.classification!=='reference'||!validImageEngineProtectedSourcePolicy(policy)||policy.original.digest!==captured.digest||policy.original.byteLength!==captured.byteLength||policy.original.format!==formatHint||policy.referenceRgbaSha256!==proof.embeddedRgbaSha256||!record(reason)||typeof reason.code!=='string'||typeof reason.message!=='string'||reason.message.length>4096||!hash(provenance.protectedBaseManifestSha256))refuse('Unproven protected reference source classification','protocol','unknown');
       const summary=inspectionCache.get(prepared.native.versionId)?.summary;if(!summary||!same(summary.sourceDisplayPolicy,policy))refuse('Reference inspection/receipt policy mismatch','protocol','unknown');return{kind:'reference',prepared,proof,policy:structuredClone(policy),reason:{code:reason.code,message:reason.message}};
      }finally{release();}
    },
    async prepareRetained(operationId,source,formatHint,reservation,sourceOptions={}){
      const op=operationContext();immutableCap();const release=immutableClaim();
      try{const maximum=reservationLimit(reservation),interpretationId=sourceOptions.interpretationId;if(interpretationId!==undefined&&interpretationId!=='photocraft-v1'&&interpretationId!=='flow-v1-upgrade')refuse('Unknown native source interpretation','unsupported');if(interpretationId==='flow-v1-upgrade'&&!op.connection.supports('flowV1UpgradeInterpretationV1'))refuse('Native binary lacks flowV1UpgradeInterpretationV1','unsupported');if(source.byteLength>8<<20)refuse('Source retained but exceeds current 8MiB native hydration admission','unsupported');
        const captured=structuredClone(source),payload=await boundedFile(captured.path,8<<20,captured.identity);op.check();if(payload.length!==captured.byteLength||sha(payload)!==captured.digest)refuse('Retained source digest changed','corrupt','retained');
        if(!['png','tiff','psd'].includes(formatHint))refuse('Unsupported source format hint','unsupported');
        const sourceIdentity={digest:captured.digest,byteLength:captured.byteLength,formatHint,...(interpretationId?{interpretationId}:{})};const started=await call(operationId,{kind:'detachedPrepare',input:{kind:'source',source:sourceIdentity},maxAdditionalBytes:maximum},null,payload);op.check();const value=await waitImmutable(op,operationId,started);op.check();if(!record(value.result.receipt)||!same(value.result.receipt.source,sourceIdentity))refuse('Hydrated source provenance mismatch','protocol','unknown');return detachedPrepared(operationId,value.result,value.payload);
      }finally{release();}
    },
    async settleCreation(value){value=structuredClone(value);const op=operationContext();immutableCap();if(value.baseVersion!==null)refuse('Creation candidate has an ordinary image base');const started=await call(next(),{kind:'settleDetached',candidateId:value.candidateId,versionId:value.native.versionId},null);op.check();const done=await waitImmutable(op,value.candidateId,started);op.check();if(done.result.kind!=='accepted'||done.result.detached!==true||done.result.candidateId!==value.candidateId||!same(nativeRef(done.result.receipt),value.native))refuse('Detached settlement identity mismatch','protocol','unknown');return{...value.native};},
    async discardCreation(operationId){const op=operationContext();immutableCap();const started=await call(next(),{kind:'discardDetached',candidateId:operationId},null);op.check();const done=await waitImmutable(op,operationId,started);op.check();if(done.result.kind!=='discarded'||done.result.detached!==true||done.result.candidateId!==operationId)refuse('Detached discard unconfirmed','protocol','unknown');},
    async listCreations(options={}):Promise<NativeCreationPage>{
      const op=operationContext();immutableCap();const limit=options.limit??16;if(!Number.isSafeInteger(limit)||limit<1||limit>32)refuse('Invalid recovery page limit','invalid-input');
      const{reply}=await call(next(),{kind:'listDetached',cursor:options.cursor??null,snapshotToken:options.snapshotToken??null,limit},null);op.check();
      if(reply.kind!=='detachedOperations'||typeof reply.snapshotToken!=='string'||!Number.isSafeInteger(reply.totalUnsettled)||Number(reply.totalUnsettled)<0||!Array.isArray(reply.entries)||reply.entries.length>limit||(reply.nextCursor!==null&&typeof reply.nextCursor!=='string'))refuse('Malformed immutable recovery page','protocol','unknown');
      const entries=reply.entries.map(v=>{if(!record(v)||typeof v.operationId!=='string'||!['intent','prepared'].includes(String(v.state)))refuse('Malformed immutable recovery item','protocol','unknown');return{operationId:v.operationId,state:v.state as 'intent'|'prepared',...(v.state==='prepared'?(record(v.result)?{prepared:detachedPrepared(v.operationId,v.result,new Uint8Array())}:refuse('Missing immutable recovery receipt','protocol','unknown')):{})};});
      return{snapshotToken:reply.snapshotToken,totalUnsettled:Number(reply.totalUnsettled),entries,nextCursor:reply.nextCursor as string|null};
    },
    async creationStatus(operationId):Promise<NativeCreationStatus>{
      const op=operationContext();immutableCap();const{reply}=await call(next(),{kind:'detachedStatus',targetOperationId:operationId},null);op.check();
      if(reply.kind!=='detachedStatus')refuse('Malformed immutable status','protocol','unknown');
      if(reply.state==='pending'){if(typeof reply.phase!=='string')refuse('Immutable pending stage missing','protocol','unknown');return{state:'pending',phase:reply.phase};}
      if(reply.state==='prepared'){if(!record(reply.result))refuse('Immutable prepared result missing','protocol','unknown');return{state:'prepared',prepared:detachedPrepared(operationId,reply.result,new Uint8Array())};}
      if(reply.state==='accepted'){if(!record(reply.result)||reply.result.detached!==true||reply.result.candidateId!==operationId)refuse('Immutable accepted identity mismatch','protocol','unknown');return{state:'accepted',native:nativeRef(reply.result.receipt)};}
      if(!['absent','intent','discarded','failed'].includes(String(reply.state)))refuse('Unknown immutable status','protocol','unknown');return{state:reply.state as 'absent'|'intent'|'discarded'|'failed'};
    },
    async inspectVersion(ref,limits={maxEdge:256,maxBytes:1<<20}){
      ref=structuredClone(ref);limits={...limits};
      const op=operationContext();immutableCap();const release=immutableClaim();
      try{if(!validNativeImageRef(ref)||ref.storeId!==storeId||!Number.isSafeInteger(limits.maxEdge)||limits.maxEdge<1||limits.maxEdge>512||!Number.isSafeInteger(limits.maxBytes)||limits.maxBytes<1||limits.maxBytes>1<<20)refuse('Invalid immutable inspection bounds','invalid-input');
        const cached=inspectionCache.get(ref.versionId);if(cached&&cached.thumbnail.width<=limits.maxEdge&&cached.thumbnail.height<=limits.maxEdge&&cached.bytes.length<=limits.maxBytes)return copyInspection(cached);
        const captured=structuredClone(ref),requestId=next();await verifyNative(captured);op.check();const started=await call(requestId,{kind:'inspectVersion',source:versionIdentity(captured),thumbnail:{...limits}},null);op.check();const done=await waitImmutable(op,requestId,started);op.check();if(done.result.kind!=='inspected')refuse('Immutable inspection failed','protocol','unknown');const view=parseNativeInspection(done.result.summary,done.payload,captured,sha(done.payload));cacheInspection(captured.versionId,view);return copyInspection(view);
      }finally{release();}
    },
    async previewEdit(base,previewId,fromSeq,edit,expectedContextGeneration){
      const op=operationContext();if(!op.connection.supports('productEditPreviewV1'))refuse('Native binary lacks productEditPreviewV1','unsupported');
      if(!current||!same(base,current))refuse('Preview target is not installed');
      if(!validImageEngineEdit(edit)||!['setLayerOpacities','transform'].includes(edit.kind)||!Number.isSafeInteger(expectedContextGeneration)||expectedContextGeneration<0||!Number.isSafeInteger(fromSeq)||fromSeq<1||!/^[A-Za-z0-9_-]{1,80}$/.test(previewId))refuse('Invalid product preview input','invalid-input');
      const{reply}=await call(next(),{kind:'previewEdit',previewId,fromSeq,edit:structuredClone(edit),expectedContextGeneration},base.versionId);op.check();
      const stamp=reply.editPreview;
      if(reply.kind!=='frame'||!validImageEnginePreviewStamp(stamp)||stamp.documentId!==base.documentId||stamp.baseVersion!==base.versionId||stamp.previewId!==previewId||stamp.throughSeq!==fromSeq||stamp.sourceContextGeneration!==expectedContextGeneration||stamp.workerEpoch!==display?.workerEpoch||stamp.epoch!==display?.epoch)refuse('Native preview identity mismatch','protocol','unknown');
      return{stamp:structuredClone(stamp),displayIdentity:{...display!}};
    },
    async cancelEditPreview(base,stamp){
      const op=operationContext();if(!op.connection.supports('productEditPreviewV1'))refuse('Native binary lacks productEditPreviewV1','unsupported');
      if(!current||!same(base,current)||!validImageEnginePreviewStamp(stamp)||stamp.documentId!==base.documentId||stamp.baseVersion!==base.versionId)refuse('Invalid preview cancellation identity','invalid-input');
      const captured=structuredClone(stamp),{reply}=await call(next(),{kind:'cancelEditPreview',stamp:captured},base.versionId);op.check();
      if(reply.kind!=='editPreviewCancelled'||reply.previewId!==captured.previewId||reply.throughSeq!==captured.throughSeq||reply.versionId!==base.versionId||reply.durable!==false)refuse('Native preview cancellation unconfirmed','protocol','unknown');
      const summary=await contextSummary();op.check();return summary;
    },
    displayIdentity:()=>display?{...display}:null,
    contextGeneration:()=>contextGeneration,
    selectLayerContext:(base,layerId,generation)=>layerContext('selectLayerContext',base,layerId,generation),
    selectionContext:(base,layerId,selection,generation)=>layerContext('selectionContext',base,layerId,generation,selection),
    async prepareEdit(operationId,base,edit,context){
      const op=operationContext();
      if(!op.connection.supports('productImageEditsV1'))refuse('Native binary lacks productImageEditsV1','unsupported');
      if(!validImageEngineEdit(edit)||!context||!Number.isSafeInteger(context.expectedContextGeneration)||context.expectedContextGeneration<0||(context.preview!==undefined&&!validImageEnginePreviewStamp(context.preview)))refuse('Invalid product image edit/context','invalid-input');
      if(context.preview&&!op.connection.supports('productEditPreviewV1'))refuse('Native binary lacks productEditPreviewV1','unsupported');
      const captured=structuredClone(edit),generation=context.expectedContextGeneration,preview=context.preview?structuredClone(context.preview):undefined;
      if(!current||!same(current,base))refuse('Product edit target is not installed');
      await verifyNative(base);op.check();
      const{reply}=await call(operationId,{kind:'productEdit',edit:captured,expectedContextGeneration:generation,...(preview?{preview}:{})},base.versionId);op.check();
      if(preview&&!same(reply.editPreview,preview))refuse('Native preview adoption identity mismatch','protocol','unknown');
      const value=prepared(reply);if(value.baseVersion!==base.versionId||value.native.documentId!==base.documentId)refuse('Native product edit prepared wrong target','protocol','unknown');return value;
    },

    async preparePaint(operationId,base,stroke){
      const op=operationContext();
      const brush=brushFor(stroke);await install(base);op.check();
      const points=pointBatch(stroke.points,stroke.pressures);
      previewOperation=operationId;
      await call(`${operationId}-begin`,{kind:'strokeBegin',previewId:operationId,brush,points:points.slice(0,1)}).catch(e=>{if((e as {effect?:unknown}).effect==='none'&&previewOperation===operationId)previewOperation=undefined;throw e;});op.check();
      for(let offset=1;offset<points.length;offset+=256){await call(`${operationId}-points-${offset}`,{kind:'strokeAppend',previewId:operationId,fromSeq:offset+1,points:points.slice(offset,offset+256)});op.check();}
      const finished=await call(operationId,{kind:'strokeFinish',previewId:operationId,throughSeq:points.length});op.check();const value=prepared(finished.reply);previewOperation=undefined;return value;
    },
    async accept(value,base){
      const op=operationContext();
      const result=await call(next(),{kind:'accept',candidateId:value.candidateId},base.versionId);op.check();
      if(result.reply.kind!=='accepted'||result.reply.candidateId!==value.candidateId)refuse('Native acceptance mismatch','protocol','unknown');
      const ref=nativeRef(result.reply.receipt);if(!same(ref,value.native))refuse('Native accepted wrong content','protocol','unknown');current=ref;candidate=undefined;return ref;
    },
    async status(operationId):Promise<NativeOperationStatus>{
      const op=operationContext();
      const {reply}=await call(next(),{kind:'status',targetOperationId:operationId});op.check();
      if(reply.kind!=='status'||!['absent','intent','prepared','accepted','discarded','failed'].includes(String(reply.state)))refuse('Invalid native operation status','protocol','unknown');
      if(reply.state==='prepared'){
        if(!record(reply.result))refuse('Missing native prepared status','protocol','unknown');
        const r=reply.result;if(r.detached===true)refuse('Use creationStatus for detached candidates','unsupported');if(r.kind!=='prepared'||r.candidateId!==operationId||(r.baseVersion!==null&&typeof r.baseVersion!=='string'))refuse('Invalid native prepared status','protocol','unknown');
        return{state:'prepared',prepared:{candidateId:r.candidateId,baseVersion:r.baseVersion,native:nativeRef(r.receipt)}};
      }
      if(reply.state==='accepted'){if(record(reply.result)&&reply.result.detached===true)refuse('Use creationStatus for detached candidates','unsupported');if(!record(reply.result)||reply.result.kind!=='accepted'||reply.result.candidateId!==operationId)refuse('Missing or mismatched native accepted status','protocol','unknown');return{state:'accepted',native:nativeRef(reply.result.receipt)};}
      return{state:reply.state as 'absent'|'intent'|'discarded'|'failed'};
    },
    async recoverAccept(candidateId,base,ref){
      const op=operationContext();
      const status=await driver.status(candidateId);op.check();
      // Accepted is a historical fact, not permission to move a newer context
      // back to this prefix. Main installs its selected final target afterwards.
      if(status.state==='accepted'){if(!same(status.native,ref))refuse('Accepted native receipt disagrees with Main');return;}
      if(status.state!=='prepared'||status.prepared?.candidateId!==candidateId||status.prepared.baseVersion!==(base?.versionId??null)||!same(status.prepared.native,ref))refuse('Cannot settle unknown native candidate','conflict','unknown');
      if(!current){
        if(requireCurrent().supports('recoveredCandidateAcceptAtInstalledVersion')){await install(ref);op.check();}
        else if(base){await install(base);op.check();}
      }else if(!same(current,ref)&&!same(current,base))refuse('Recovery does not follow the installed native predecessor','conflict','retained');
      const {reply}=await call(next(),{kind:'accept',candidateId});op.check();
      if(reply.kind!=='accepted'||!same(nativeRef(reply.receipt),ref))refuse('Recovered accept receipt mismatch','protocol','unknown');candidate=undefined;await confirm(ref,base);op.check();
    },
    async cancelPreview(operationId){
      const op=operationContext();
      if(previewOperation===undefined)return;
      if(previewOperation!==operationId)refuse('Another native preview remains active','conflict','unknown');
      const {reply}=await call(next(),{kind:'strokeCancel',previewId:operationId});op.check();
      if(reply.kind!=='cancelled')refuse('Native preview cancellation not confirmed','protocol','unknown');previewOperation=undefined;
    },
    async discard(operationId){
      const op=operationContext();
      const {reply}=await call(next(),candidate===operationId?{kind:'discard',candidateId:operationId}:{kind:'abandon',targetOperationId:operationId});op.check();
      if(reply.kind!=='discarded'||reply.candidateId!==operationId)refuse('Native discard receipt mismatch','protocol','unknown');candidate=undefined;
    },
    install,
    async resume(){
      const op=operationContext();if(!op.connection.supports('settledResumeV1'))refuse('Native binary lacks settledResumeV1','unsupported');
      const expected=current?{...current}:null;
      const{reply}=await call(next(),{kind:'resume'},expected?.versionId??null);op.check();
      if(reply.kind!=='resumed'||reply.versionId!==(expected?.versionId??null)||reply.documentId!==(expected?.documentId??null)||!Number.isSafeInteger(reply.epoch)||Number(reply.epoch)<0)refuse('Native Resume identity/epoch mismatch','protocol','unknown');
    },
    async freeze(){const op=operationContext();const{reply}=await call(next(),{kind:'freeze'});op.check();if(reply.kind!=='frozen'||reply.versionId!==(current?.versionId??null))refuse('Native freeze identity failed','protocol','unknown');},
    async close(){const op=operationContext();closing=true;const{reply}=await call(next(),{kind:'close'});op.identity();if(reply.kind!=='closed')refuse('Native close failed','protocol','unknown');await op.connection.exited;op.identity();if(owner){await owner.dispose();op.identity();}}
  };
  return {
    driver,verifyNative,capture,
    /** Stage-A transport accepts at most 64 MiB. SourceStore may retain larger
     * files; those remain unhydrated instead of being read 128 times by readRange.
     * One bound handle streams into one bounded transport payload, identity is
     * checked before/after and native independently checks the declared SHA. */
    async openRetained(operationId:string,source:RetainedSourceObject,formatHint:string){
      const op=operationContext();
      const payload=await boundedFile(source.path,64<<20,source.identity);op.check();
      if(payload.length!==source.byteLength||sha(payload)!==source.digest)refuse('Retained source digest changed','corrupt','retained');
      const opened=await call(operationId,{kind:'open',source:{digest:source.digest,byteLength:source.byteLength,formatHint}},null,payload);op.check();return prepared(opened.reply);
    },
    async acceptOpened(value:PreparedImage){const op=operationContext();const{reply}=await call(next(),{kind:'accept',candidateId:value.candidateId},null);op.check();if(reply.kind!=='accepted')refuse('Source acceptance failed','protocol','unknown');const ref=nativeRef(reply.receipt);if(!same(ref,value.native))refuse('Source acceptance identity mismatch');current=ref;candidate=undefined;return ref;}
  };
}
