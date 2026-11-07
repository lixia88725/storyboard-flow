import type { FlowStroke } from '../../platform/contracts/flowWave2.js';
import type { ImageOperationIntent, ImageProjectEdit, ImageProjectOutcome, ImageProjectSnapshot, NativeDecision, NativeImageRef, ProjectCommitV2, ProjectV2 } from '../../platform/contracts/imageProject.js';
import type { ProjectCommitReceipt, ProjectStoreV2 } from '../../project-files/main/image-engine/projectStore.js';
import { applyImageProjectEdit, validImageProject, validNativeImageRef, validProjectStroke } from './imageProjectModel.js';
import { copy, same, shape } from './imageProjectValues.js';
import { createSnapshotHistory, type HistoryPlan } from './snapshotHistory.js';

export type PreparedImage={candidateId:string;baseVersion:string|null;native:NativeImageRef};
export type NativeOperationStatus={state:'absent'|'intent'|'prepared'|'accepted'|'discarded'|'failed';prepared?:PreparedImage;native?:NativeImageRef};
/** Typed Main port. No raw native command, user path, file publication or user history. */
export interface NativeSessionDriver {
  preparePaint(operationId:string,base:NativeImageRef,stroke:FlowStroke):Promise<PreparedImage>;
  accept(prepared:PreparedImage,base:NativeImageRef):Promise<NativeImageRef>;
  status(operationId:string):Promise<NativeOperationStatus>;
  recoverAccept(candidateId:string,base:NativeImageRef|null,prepared:NativeImageRef):Promise<void>;
  discard(operationId:string):Promise<void>;
  cancelPreview(operationId:string):Promise<void>;
  install(ref:NativeImageRef):Promise<void>;
  freeze():Promise<void>;
  close():Promise<void>;
}
export type NativeProjectRequest=
  | {kind:'paint';shotId:string;stroke:FlowStroke}
  | {kind:'board';edit:Exclude<ImageProjectEdit,{kind:'installNativeImage'}>;typing?:{group:string}}
  | {kind:'undo'|'redo'|'recover'|'freeze'};
export type NativeProjectSession={snapshot():ImageProjectSnapshot;subscribe(listener:()=>void):()=>void;request(request:NativeProjectRequest):Promise<ImageProjectOutcome>;close():Promise<void>};

/** Serial stage-A coordinator. One shared Flow history, one durable project CAS.
 * This does not claim the input/pipeline latency or full product migration is done.
 * Reopening deliberately starts an empty Undo stack, as the existing product does. */
export async function openNativeProjectSession(options:{sessionId:string;incarnation:string;store:ProjectStoreV2;native:NativeSessionDriver;mintId():string;now():number}):Promise<NativeProjectSession>{
  const sessionId=options.sessionId,incarnation=options.incarnation;
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)||!/^[A-Za-z0-9_-]{1,128}$/.test(incarnation))throw Error('Invalid Main Session identity');
  const store=options.store,native=options.native,mint=options.mintId.bind(options),now=options.now.bind(options);
  let head=await store.load();if(!head)throw Error('Initialize an image-project v2 head before opening its Session');
  const historyResult=createSnapshotHistory<ProjectV2,ImageProjectEdit>(head.commit.after,{maxEntries:60,group:{now,windowMs:800}},{valid:validImageProject,reduce:applyImageProjectEdit});
  if(!historyResult.ok)throw Error(historyResult.error.message);const history=historyResult.value;
  let phase:ImageProjectSnapshot['phase']='active',pending=0,eventSeq=0,closed=false,tail=Promise.resolve();
  let nativeMayBeFrozen=false,pendingInstall:NativeImageRef|undefined;
  const pendingPlans=new Map<string,HistoryPlan<ProjectV2>>();
  let recovery:ImageProjectSnapshot['recovery'];const listeners=new Set<()=>void>();
  const current=()=>{const result=history.current();if(!result.ok)throw Error(result.error.message);return result.value;};
  const snapshot=():ImageProjectSnapshot=>({sessionId,incarnation,eventSeq,project:current(),phase,pending,undoDepth:history.undoDepth(),redoDepth:history.redoDepth(),...(recovery?{recovery:copy(recovery)}:{})});
  const notify=()=>{eventSeq++;for(const f of listeners)try{void Promise.resolve(f()).catch(()=>{});}catch{/* observers own no authority */}};
  const settled=():ImageProjectOutcome=>({kind:'settled',commitHash:head!.commitHash,snapshot:snapshot()});
  const fail=(e:unknown):ImageProjectOutcome=>({kind:'rejected',error:{code:typeof(e as {code?:unknown})?.code==='string'?(e as {code:string}).code:'io-failure',message:typeof(e as {message?:unknown})?.message==='string'?(e as {message:string}).message:String(e),effect:((e as {effect?:unknown})?.effect==='none'?'none':(e as {effect?:unknown})?.effect==='retained'?'retained':'unknown')}});
  const resolve=async(imageId:string):Promise<NativeImageRef>=>{
    const image=current().images[imageId];if(!image)throw Error('Unknown image');
    if(image.content.kind==='native')return copy(image.content.native);
    const hydration=await store.hydration(image.content.source);if(!hydration)throw Object.assign(Error('Source retained or queued; image is not hydrated'),{code:'unavailable',effect:'none'});
    return hydration.native;
  };
  const installSelected=async()=>{
    if(pendingInstall){await native.install(copy(pendingInstall));pendingInstall=undefined;return;}
    const install=async(ref:NativeImageRef)=>{pendingInstall=copy(ref);await native.install(ref);pendingInstall=undefined;};
    // Stage A has one native editing target. Source-only/Pending entries are valid
    // project members without opening every document. Prefer the last native edit.
    const p=current(),image=head!.commit.nativeDecision?.imageId;
    const target=image&&p.images[image]?image:[...p.shots,...p.parkedShots].find(s=>p.images[s.imageId].content.kind==='native')?.imageId;
    if(target)await install(await resolve(target));
    else for(const shot of p.shots){const binding=p.images[shot.imageId].content;if(binding.kind==='source'){const h=await store.hydration(binding.source);if(h){await install(h.native);break;}}}
  };
  const reconcile=async()=>{
    phase='recovering';notify();
    if(nativeMayBeFrozen){
      // This host has no Resume. A lost Freeze reply or failed store audit cannot
      // authorize painting again; only complete certification and remain frozen.
      await native.freeze();await store.validateRecovery();
      if((await store.pendingOperations()).length||(await store.unsettled()).length||(await store.pendingHydrations()).length)throw Error('Frozen native host still has project obligations');
      recovery=undefined;phase='frozen';notify();return;
    }
    // Pending hydration is a derived-index decision, never a user history edit.
    for(const h of await store.pendingHydrations()){
      const status=await native.status(h.operationId);
      if(status.state!=='prepared'&&status.state!=='accepted')throw Error('Hydration has no matching durable native candidate');
      if(status.state==='prepared')await native.recoverAccept(h.operationId,null,h.native);
      else if(!same(status.native,h.native))throw Error('Hydration native acceptance mismatch');
      await store.settleHydration(h.source,h.operationId,h.native);
    }
    const committed=await store.committed();
    for(const intent of await store.pendingOperations()){
      recovery={operationId:intent.operationId,commitHash:null};
      const c=committed.find(c=>c.commit.nativeDecision?.operationId===intent.operationId),status=await native.status(intent.operationId);
      if(c){
        const d=c.commit.nativeDecision!;recovery={operationId:intent.operationId,commitHash:c.commitHash};
        if(status.state==='prepared')await native.recoverAccept(d.candidateId,intent.baseNative,d.prepared);
        else if(status.state!=='accepted'||!same(status.native,d.prepared))throw Error('Committed project image has no matching native prepared/accepted record');
        await store.settle(c.commitHash,d.operationId,d.prepared);await store.resolveOperation(d.operationId,'committed',c.commitHash);
      }else{
        if(status.state==='accepted')throw Error('Native accepted without a reachable project decision; evidence preserved');
        await native.cancelPreview(intent.operationId);
        if(status.state==='prepared'||status.state==='intent')await native.discard(intent.operationId);
        await store.resolveOperation(intent.operationId,'discarded',null);
      }
    }
    // Also settle a committed receipt whose intent resolution was already durable.
    for(const c of await store.unsettled()){
      const d=c.commit.nativeDecision!;if(!d.baseNative)throw Error('Missing native base');
      const status=await native.status(d.operationId);
      if(status.state==='prepared')await native.recoverAccept(d.candidateId,d.baseNative,d.prepared);
      else if(status.state!=='accepted'||!same(status.native,d.prepared))throw Error('Native settlement contradicts project decision');
      await store.settle(c.commitHash,d.operationId,d.prepared);
    }
    const latest=await store.load();if(!latest)throw Error('Project head disappeared during recovery');
    if(!same(current(),latest.commit.after)){const plan=pendingPlans.get(latest.commit.commitId);if(!plan)throw Error('Durable project/history reconciliation requires reopening this Session');const result=history.commit(plan);if(!result.ok||!same(result.value.after,latest.commit.after))throw Error('Pending history plan differs from committed project');pendingPlans.delete(latest.commit.commitId);}
    head=latest;await installSelected();recovery=undefined;phase='active';notify();
  };
  const commitPlan=async(plan:HistoryPlan<ProjectV2>,operationId:string,decision?:NativeDecision)=>{
    const record:ProjectCommitV2={schema:'flow.project-commit',version:1,commitId:operationId,previousCommitHash:head!.commitHash,beforeRevision:current().revision,after:copy(plan.result.after),...(decision?{nativeDecision:decision}:{})};
    pendingPlans.set(operationId,plan);
    let receipt:ProjectCommitReceipt;
    try{receipt=await store.commit(head!.commitHash,record);}
    catch(e){
      // An unknown head publication must be read back, never converted to rollback.
      const found=(await store.committed()).find(c=>c.commit.commitId===operationId);
      if(!found||!same(found.commit,record))throw e;
      // Retry the same CAS to complete any unconfirmed directory synchronization.
      receipt=await store.commit(record.previousCommitHash,record);
    }
    const installed=history.commit(plan);if(!installed.ok)throw Error(`Durable project committed but history plan refused: ${installed.error.message}`);
    if(!same(installed.value.after,receipt.commit.after))throw Error('Project CAS/history installation mismatch');
    head=receipt;pendingPlans.delete(operationId);notify();return receipt;
  };
  const paint=async(shotId:string,stroke:FlowStroke):Promise<ImageProjectOutcome>=>{
    if(!validProjectStroke(stroke))throw Object.assign(Error('Invalid native stroke'),{code:'invalid-input',effect:'none'});
    const p=current(),shot=p.shots.find(s=>s.id===shotId);if(!shot)throw Object.assign(Error('Only active shots can be painted'),{code:'not-found',effect:'none'});
    const base=await resolve(shot.imageId),operationId=mint(),expected=copy(p.images[shot.imageId].content);
    const intent:ImageOperationIntent={schema:'flow.image-edit-intent',version:1,operationId,sessionId,incarnation,imageId:shot.imageId,expected,baseNative:base,stroke:copy(stroke)};
    await store.beginOperation(intent);
    try{
      const prepared=await native.preparePaint(operationId,base,stroke);
      if(prepared.candidateId!==operationId||prepared.baseVersion!==base.versionId||!validNativeImageRef(prepared.native))throw Error('Native prepared receipt mismatch');
      if(same(prepared.native,base)){await native.discard(operationId);await store.resolveOperation(operationId,'discarded',null);return settled();}
      const plan=history.prepare({kind:'installNativeImage',imageId:shot.imageId,expected,next:prepared.native});if(!plan.ok)throw Error(plan.error.message);
      const decision:NativeDecision={kind:'image',operationId,candidateId:prepared.candidateId,imageId:shot.imageId,expected,baseNative:base,prepared:prepared.native};
      const c=await commitPlan(plan.value,operationId,decision);
      try{
        const accepted=await native.accept(prepared,base);if(!same(accepted,prepared.native))throw Error('Native accepted receipt mismatch');
        await store.settle(c.commitHash,operationId,accepted);await store.resolveOperation(operationId,'committed',c.commitHash);
        return settled();
      }catch{phase='recovering';recovery={operationId,commitHash:c.commitHash};notify();return{kind:'settlementPending',commitHash:c.commitHash,operationId,snapshot:snapshot()};}
    }catch(e){
      if((e as {effect?:unknown})?.effect==='none')try{await native.cancelPreview(operationId);const status=await native.status(operationId);if(['absent','failed','discarded'].includes(status.state)){await store.resolveOperation(operationId,'discarded',null);pendingPlans.delete(operationId);return fail(Object.assign(Error(typeof(e as {message?:unknown}).message==='string'?(e as {message:string}).message:String(e)),{code:(e as {code?:unknown}).code??'native',effect:'retained'}));}}catch{/* unknown settlement stays blocked */}
      phase='recovering';recovery={operationId,commitHash:null};notify();return{kind:'recoveryPending',operationId,snapshot:snapshot()};}
  };
  await reconcile();
  return {
    snapshot,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},
    request(input){
      if(pending>=32)return Promise.resolve(fail(Object.assign(Error('Main request queue is full'),{code:'resource-limit',effect:'none'})));
      let request:NativeProjectRequest;
      try{request=copy(input);const valid=request?.kind==='paint'?shape(request,['kind','shotId','stroke']):request?.kind==='board'?shape(request,['kind','edit'],['typing']):shape(request,['kind'])&&['undo','redo','recover','freeze'].includes(String(request.kind));if(!valid)throw Error('Invalid Main Session request');}catch{return Promise.resolve(fail(Object.assign(Error('Invalid Main Session request'),{code:'invalid-input',effect:'none'})));}
      pending++;notify();
      const work=tail.then(async():Promise<ImageProjectOutcome>=>{
        if(closed)return fail(Object.assign(Error('Session closed'),{code:'closed',effect:'none'}));
        if(phase==='recovering'&&request.kind!=='recover')return fail(Object.assign(Error('Reconcile the pending operation first'),{code:'busy',effect:'retained'}));
        try{
          if(phase==='frozen'&&request.kind!=='freeze')throw Object.assign(Error('Frozen Session can only close'),{code:'busy',effect:'none'});
          if(request.kind==='recover'){await reconcile();return settled();}
          if(request.kind==='freeze'){phase='freezing';nativeMayBeFrozen=true;await native.freeze();await store.validateRecovery();if((await store.pendingOperations()).length||(await store.unsettled()).length||(await store.pendingHydrations()).length)throw Error('Unsettled project obligations');phase='frozen';notify();return settled();}
          if(phase!=='active')throw Object.assign(Error('Session admission is frozen'),{code:'busy',effect:'none'});
          if(request.kind==='paint')return await paint(request.shotId,request.stroke);
          const prepared=request.kind==='board'?history.prepare(request.edit,request.typing):request.kind==='undo'?history.prepareUndo():history.prepareRedo();
          if(!prepared.ok)return fail({...prepared.error,effect:'none'});
          if(!prepared.value.result.changed)return settled();
          const committed=await commitPlan(prepared.value,mint());
          if(request.kind==='undo'||request.kind==='redo')try{await installSelected();}catch{
            phase='recovering';recovery={operationId:committed.commit.commitId,commitHash:committed.commitHash,...(pendingInstall?{target:copy(pendingInstall)}:{})};notify();
            return{kind:'settlementPending',operationId:committed.commit.commitId,commitHash:committed.commitHash,snapshot:snapshot()};
          }
          return settled();
        }catch(e){if(phase==='freezing'||pendingPlans.size)phase='recovering';return fail(e);}
      }).finally(()=>{pending--;notify();});tail=work.then(()=>undefined,()=>undefined);return work.then(result=>'snapshot'in result?{...result,snapshot:snapshot()}:result);
    },
    close:async()=>{await tail;if(phase!=='frozen')throw Error('Freeze and settle before close');await native.close();await store.close();closed=true;}
  };
}
