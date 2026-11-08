import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { startImageEngine } from '../../../platform/main/imageEngineConnection.js';
import type { createImageEngineWorkerOwner } from '../../../platform/main/imageEngineWorkerOwner.js';
import type { NativeFrame } from '../../../platform/main/imageEngineFraming.js';
import type { NativeImageRef } from '../../../platform/contracts/imageProject.js';
import { validImageEngineEdit, validImageEnginePreviewStamp } from '../../../platform/contracts/imageEngine.js';
import type { ImageEngineEdit, ImageEngineEditContext, ImageEngineContextSummary, ImageEngineDisplayIdentity } from '../../../platform/contracts/imageEngine.js';
import { validSelection } from '../../../platform/contracts/flowSelection.js';
import type { FlowSelection } from '../../../platform/contracts/flowSelection.js';
import { parseNativeProductContext } from './nativeProductContext.js';
import type { FlowStroke } from '../../../platform/contracts/flowWave2.js';
import type { NativeOperationStatus, NativeSessionDriver, PreparedImage } from '../../../session/core/nativeSession.js';
import { validNativeImageRef, validProjectStroke } from '../../../session/core/imageProjectModel.js';
import { record, same } from '../../../session/core/imageProjectValues.js';
import type { NativePipelineDriver, PipelineLimits, PipelineReady, PipelineQueued, PipelinePrepared, PipelineState, PipelineEvent } from '../../../session/core/nativePipeline.js';
import type { RetainedSourceObject } from './sourceStore.js';

export type NativeProductDriver = {
  prepareEdit(operationId:string,base:NativeImageRef,edit:ImageEngineEdit,context:ImageEngineEditContext):Promise<PreparedImage>;
  summary():Promise<ImageEngineContextSummary>;
  selectLayerContext(base:NativeImageRef,layerId:string,expectedContextGeneration:number):Promise<ImageEngineContextSummary>;
  selectionContext(base:NativeImageRef,layerId:string,selection:FlowSelection|null,expectedContextGeneration:number):Promise<ImageEngineContextSummary>;
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
  const verifyNative=async(ref:NativeImageRef)=>{
    if(!validNativeImageRef(ref)||ref.storeId!==storeId)refuse('Unknown native store/ref');
    const raw=await boundedFile(path.join(storeRoot,'versions',ref.versionId+'.json'),16<<20);
    if(sha(raw)!==ref.versionId||ref.versionId!==ref.manifestSha256)refuse('Native manifest hash changed','corrupt','retained');
    const parsed:unknown=JSON.parse(raw.toString('utf8'));
    if(!record(parsed)||parsed.schema!=='flow.image-native-snapshot'||parsed.version!==1||parsed.documentId!==ref.documentId||!record(parsed.nativeManifest)||!record(parsed.nativeManifest.document)||!record(parsed.nativeManifest.document.size)||parsed.nativeManifest.document.size.width!==ref.width||parsed.nativeManifest.document.size.height!==ref.height)refuse('Native manifest geometry/identity mismatch','corrupt','retained');
    // Full compressed object verification occurs inside native load/install;
    // a live prepared receipt already follows native durable object publication.
  };
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
    ...(owner?{async restartForRecovery(){
      fenced=true;generation++; // Fence queued Adapter jobs before awaiting owned exit.
      const restarting=generation,handle=await owner.restart();if(restarting!==generation)refuse('Old worker replacement fenced','worker-unavailable','unknown');connection=handle.connection;generation=handle.generation;
      display=null;contextGeneration=null;current=null;candidate=undefined;previewOperation=undefined;pipelineReady=undefined;
      faultNotified=false;closing=false;fenced=false;armExit();
    }}:{}),
    onFault(listener){faultListeners.add(listener);return()=>faultListeners.delete(listener);},
    pipeline,
    summary:contextSummary,
    displayIdentity:()=>display?{...display}:null,
    contextGeneration:()=>contextGeneration,
    selectLayerContext:(base,layerId,generation)=>layerContext('selectLayerContext',base,layerId,generation),
    selectionContext:(base,layerId,selection,generation)=>layerContext('selectionContext',base,layerId,generation,selection),
    async prepareEdit(operationId,base,edit,context){
      const op=operationContext();
      if(!op.connection.supports('productImageEditsV1'))refuse('Native binary lacks productImageEditsV1','unsupported');
      if(!validImageEngineEdit(edit)||!context||!Number.isSafeInteger(context.expectedContextGeneration)||context.expectedContextGeneration<0||(context.preview!==undefined&&!validImageEnginePreviewStamp(context.preview)))refuse('Invalid product image edit/context','invalid-input');
      if(context.preview)refuse('Native product preview adoption is not yet supported','unsupported');
      const captured=structuredClone(edit),generation=context.expectedContextGeneration;
      if(!current||!same(current,base))refuse('Product edit target is not installed');
      await verifyNative(base);op.check();
      const{reply}=await call(operationId,{kind:'productEdit',edit:captured,expectedContextGeneration:generation},base.versionId);op.check();
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
        const r=reply.result;if(r.kind!=='prepared'||r.candidateId!==operationId||(r.baseVersion!==null&&typeof r.baseVersion!=='string'))refuse('Invalid native prepared status','protocol','unknown');
        return{state:'prepared',prepared:{candidateId:r.candidateId,baseVersion:r.baseVersion,native:nativeRef(r.receipt)}};
      }
      if(reply.state==='accepted'){if(!record(reply.result)||reply.result.kind!=='accepted'||reply.result.candidateId!==operationId)refuse('Missing or mismatched native accepted status','protocol','unknown');return{state:'accepted',native:nativeRef(reply.result.receipt)};}
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
