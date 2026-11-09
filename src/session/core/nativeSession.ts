import{validImageReplacementIntent,replacementProjectEdit}from'./imageReplacement.js';
import{hydrationProtection,assertVersionProtection}from'./sourceProtection.js';
import{validImageCreationIntent,validNativeCreationInput,creationProjectEdit}from'./imageCreation.js';
import type { ImageEngineEdit, ImageEnginePreviewStamp } from '../../platform/contracts/imageEngine.js';
import { validImageEngineEdit, validImageEnginePreviewStamp } from '../../platform/contracts/imageEngine.js';
import type { FlowStroke } from '../../platform/contracts/flowWave2.js';
import type { ImageCreationBatchIntent, ImageCreationBatchDecision, NativeImageCreationInput, ImageOperationIntent, ImageOperationOrigin, ImageOperationRecord, ImageOperationPage, ImageRecoveryDisposition, RetainedImageInput, ImagePipelineAdmission, ImagePipelineInput, ImagePipelineProgress, ImageProjectEdit, ImageProjectOutcome, ImageProjectSnapshot, ImageReplacementBatchIntent,ImageReplacementBatchDecision,NativeDecision, NativeImageRef, ProtectedSourceV2, ProjectCommitV2, ProjectV2 } from '../../platform/contracts/imageProject.js';
import type { ProjectCommitReceipt, ProjectConfirmation, ProjectStoreV2 } from '../../project-files/main/image-engine/projectStore.js';
import { applyImageProjectEdit, validImageProject, validNativeImageRef, validProjectStroke } from './imageProjectModel.js';
import { copy, same, shape } from './imageProjectValues.js';
import { createNativeSettlementQueue } from './nativeSettlementQueue.js';
import { createMainImagePipeline, type NativePipelineDriver, type PipelineEntry, type PipelineLimits } from './nativePipeline.js';
import { createSnapshotHistory, type HistoryPlan } from './snapshotHistory.js';

export type PreparedImage={candidateId:string;baseVersion:string|null;native:NativeImageRef};
export type NativeOperationStatus={state:'absent'|'intent'|'prepared'|'accepted'|'discarded'|'failed';prepared?:PreparedImage;native?:NativeImageRef};
/** Typed Main port. No raw native command, user path, file publication or user history. */
export interface NativeSessionDriver {
  pipeline?:NativePipelineDriver;
  restartForRecovery?():Promise<void>;
  onFault?(listener:(error?:unknown)=>void):()=>void;
  versionWorkingInput?(ref:NativeImageRef):Promise<{digest:string;byteLength:number;format:'tiff'}|null>;
  versionSourcePolicy?(ref:NativeImageRef):Promise<import('../../platform/contracts/imageEngine.js').ImageEngineProtectedSourcePolicy|null>;
  prepareCreation?(operationId:string,input:NativeImageCreationInput,reservation:{maxAdditionalBytes:number}):Promise<PreparedImage>;
  creationStatus?(operationId:string):Promise<NativeOperationStatus|{state:'pending';phase:string}>;
  settleCreation?(prepared:PreparedImage):Promise<NativeImageRef>;
  discardCreation?(operationId:string):Promise<void>;
  prepareEdit?(operationId:string,base:NativeImageRef,edit:ImageEngineEdit,context:{expectedContextGeneration:number;preview?:ImageEnginePreviewStamp}):Promise<PreparedImage>;
  preparePaint(operationId:string,base:NativeImageRef,stroke:FlowStroke):Promise<PreparedImage>;
  accept(prepared:PreparedImage,base:NativeImageRef):Promise<NativeImageRef>;
  status(operationId:string):Promise<NativeOperationStatus>;
  recoverAccept(candidateId:string,base:NativeImageRef|null,prepared:NativeImageRef):Promise<void>;
  discard(operationId:string):Promise<void>;
  cancelPreview(operationId:string):Promise<void>;
  install(ref:NativeImageRef):Promise<void>;
  freeze():Promise<void>;
  /** Only a capability-checked settled native Resume ACK may reopen admission. */
  resume?():Promise<void>;
  close():Promise<void>;
}
export type NativeProjectRequest=
  | {kind:'replaceBatch';intentId:string;prepared:readonly PreparedImage[]}
  | {kind:'createBatch';items:ImageCreationBatchIntent['items'];placement:ImageCreationBatchIntent['placement'];maxAdditionalBytes:number}
  | {kind:'paint';shotId:string;stroke:FlowStroke}
  | {kind:'imageEdit';shotId:string;expectedNative:NativeImageRef;expectedContextGeneration:number;edit:ImageEngineEdit;preview?:ImageEnginePreviewStamp}
  | {kind:'board';edit:Exclude<ImageProjectEdit,{kind:'installNativeImage'|'replaceNativeImages'}>;typing?:{group:string}}
  | {kind:'undo'|'redo'|'recover'|'freeze'|'resume'|'barrier'};
/** Pipeline input acknowledges bounded volatile capture synchronously. Preview
 * progress means a native frame acknowledgement, not a displayed screen. The
 * last 64 completed operations may be awaited; older identities require durable
 * store queries. Unknown work never returns a false settled acknowledgement. */
export type NativeProjectSession={snapshot():ImageProjectSnapshot;subscribe(listener:()=>void):()=>void;request(request:NativeProjectRequest,identity?:{operationId:string}):Promise<ImageProjectOutcome>;close():Promise<void>;operationRecords(page?:ImageOperationPage):Promise<ImageOperationRecord[]>;resolveRetainedInput(operationId:string,recordId:string):Promise<ImageProjectOutcome>;pipeline?:{recoveryInputs():RetainedImageInput[];input(value:ImagePipelineInput):ImagePipelineAdmission;waitOperation(operationId:string):Promise<ImageProjectOutcome>;subscribe(listener:(event:ImagePipelineProgress)=>void):()=>void}};

/** One Main Flow history and durable project authority. The pipeline is opt-in;
 * this module does not claim renderer/screen latency or full product migration.
 * Reopening deliberately starts an empty Undo stack, as the existing product does. */
export async function openNativeProjectSession(options:{sessionId:string;incarnation:string;store:ProjectStoreV2;native:NativeSessionDriver;mintId():string;now():number;pipeline?:PipelineLimits;workspaceEpoch?:number;activeImageId?:()=>string|null;originForOperation?:(operationId:string)=>ImageOperationOrigin|undefined}):Promise<NativeProjectSession>{
  const sessionId=options.sessionId,incarnation=options.incarnation;
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)||!/^[A-Za-z0-9_-]{1,128}$/.test(incarnation))throw Error('Invalid Main Session identity');
  const store=options.store,native=options.native,mint=options.mintId.bind(options),now=options.now.bind(options);
  let head=await store.load();if(!head)throw Error('Initialize an image-project v2 head before opening its Session');
  const historyResult=createSnapshotHistory<ProjectV2,ImageProjectEdit>(head.commit.after,{maxEntries:60,group:{now,windowMs:800}},{valid:validImageProject,reduce:applyImageProjectEdit});
  if(!historyResult.ok)throw Error(historyResult.error.message);const history=historyResult.value;
  let phase:ImageProjectSnapshot['phase']='active',pending=0,eventSeq=0,closed=false,tail=Promise.resolve();
  let pipeline:ReturnType<typeof createMainImagePipeline>|undefined,settlement:ReturnType<typeof createNativeSettlementQueue>;
  const confirmationObligations=new Map<string,{record:ProjectConfirmation;imageId:string;inputThrough:number}>();
  let barriers=0;
  let nativeMayBeFrozen=false,pendingInstall:NativeImageRef|undefined,pendingInstallProtection:ProtectedSourceV2|undefined;
  const pendingPlans=new Map<string,HistoryPlan<ProjectV2>>();
  let retainedRecoveryInputs:RetainedImageInput[]=[];const recoveryReports=new Map<string,ImageRecoveryDisposition>(),recoveredWait=new Map<string,ImageProjectOutcome>();
  const progressListeners=new Set<(event:ImagePipelineProgress)=>void>();
  let recovery:ImageProjectSnapshot['recovery'];const listeners=new Set<()=>void>();
  const current=()=>{const result=history.current();if(!result.ok)throw Error(result.error.message);return result.value;};
  const snapshot=():ImageProjectSnapshot=>({sessionId,incarnation,eventSeq,project:current(),phase,pending,undoDepth:history.undoDepth(),redoDepth:history.redoDepth(),...(recovery?{recovery:copy(recovery)}:{}),...(recoveryReports.size?{recoveryOutcomes:copy([...recoveryReports.values()])}:{})});
  const notify=()=>{eventSeq++;for(const f of listeners)try{void Promise.resolve(f()).catch(()=>{});}catch{/* observers own no authority */}};
  const settled=():ImageProjectOutcome=>({kind:'settled',commitHash:head!.commitHash,snapshot:snapshot()});
  const fail=(e:unknown):ImageProjectOutcome=>({kind:'rejected',error:{code:typeof(e as {code?:unknown})?.code==='string'?(e as {code:string}).code:'io-failure',message:typeof(e as {message?:unknown})?.message==='string'?(e as {message:string}).message:String(e),effect:((e as {effect?:unknown})?.effect==='none'?'none':(e as {effect?:unknown})?.effect==='retained'?'retained':'unknown')}});
  const resolve=async(imageId:string):Promise<NativeImageRef>=>{
    const image=current().images[imageId];if(!image)throw Error('Unknown image');
    if(image.content.kind==='native')return copy(image.content.native);
    const hydration=await store.hydration(image.content.source);if(!hydration)throw Object.assign(Error('Source retained or queued; image is not hydrated'),{code:'unavailable',effect:'none'});
    return hydration.native;
  };
  const protectionFor=async(imageId:string):Promise<ProtectedSourceV2|undefined>=>{const image=current().images[imageId];return image?.protectedSource??(image?.content.kind==='source'?hydrationProtection(await store.hydration(image.content.source)):undefined);};
  const checkProtection=async(ref:NativeImageRef,origin:ProtectedSourceV2|undefined)=>{if(native.versionSourcePolicy)assertVersionProtection(origin,await native.versionSourcePolicy(ref));else if(origin)throw Error('Native component cannot verify protected source provenance');};
  const installedEdit=async(imageId:string,expected:import('../../platform/contracts/imageProject.js').ImageBindingV2,next:NativeImageRef)=>{const protectedSource=await protectionFor(imageId);return{kind:'installNativeImage' as const,imageId,expected,next,...(protectedSource?{protectedSource}:{})};};
  const installSelected=async()=>{
    if(pendingInstall){await checkProtection(pendingInstall,pendingInstallProtection);await native.install(copy(pendingInstall));pendingInstall=undefined;pendingInstallProtection=undefined;return;}
    const install=async(ref:NativeImageRef,imageId:string)=>{const origin=await protectionFor(imageId);await checkProtection(ref,origin);pendingInstall=copy(ref);pendingInstallProtection=copy(origin);await native.install(ref);pendingInstall=undefined;pendingInstallProtection=undefined;};
    // Stage A has one native editing target. Source-only/Pending entries are valid
    // project members without opening every document. Prefer the last native edit.
    const p=current(),image=options.activeImageId?.()??head!.commit.nativeDecision?.imageId;
    const target=image&&p.images[image]?image:[...p.shots,...p.parkedShots].find(s=>p.images[s.imageId].content.kind==='native')?.imageId;
    if(target){const binding=p.images[target].content;if(binding.kind==='native')await install(binding.native,target);else{const hydrated=await store.hydration(binding.source);if(hydrated)await install(hydrated.native,target);}}
    else for(const shot of p.shots){const binding=p.images[shot.imageId].content;if(binding.kind==='source'){const h=await store.hydration(binding.source);if(h){await install(h.native,shot.imageId);break;}}}
  };
  const reconcile=async(replaceWorker=false)=>{
    phase='recovering';notify();const freezeAfterRecovery=nativeMayBeFrozen;
    if(replaceWorker){
      if(!native.restartForRecovery)throw Error('This native driver has no owned worker replacement');
      pipeline?.fence(Error('Main is replacing its native worker for reconciliation'));settlement.fence(Error('Main recovery fence'));
      await native.restartForRecovery(); // Old worker is confirmed exited, lease still held.
      await pipeline?.drainInput();await settlement.quiesce(); // Main writes are separate obligations.
      await store.validateRecovery();
      retainedRecoveryInputs=await pipeline?.retainForRecovery()??[];
      nativeMayBeFrozen=false;
    }else pipeline?.assertRecoverable();
    if(nativeMayBeFrozen){
      // This host has no Resume. A lost Freeze reply or failed store audit cannot
      // authorize painting again; only complete certification and remain frozen.
      await native.freeze();await store.validateRecovery();
      if((await store.pendingOperations()).length||(await store.unsettledDecisions()).length||(await store.pendingHydrations()).length)throw Error('Frozen native host still has project obligations');
      recovery=undefined;phase='frozen';notify();return;
    }
    await store.validateRecovery();
    // Detached candidates are facts, not a second project history. Only a
    // reachable Main creation vector decides which ones may be accepted.
    if(store.workspaceRecords&&store.workspaceRecord){const creationCommits=new Map((await store.committed()).map(c=>[c.commit.commitId,c]));let afterId:string|undefined;for(;;){const page=await store.workspaceRecords({...(afterId?{afterId}:{}),maxRecords:16});for(const record of page){if(record.kind!=='creationBatch')continue;const intent=record.intent,resolutionId=`creation-resolution-${intent.operationId}`;if(await store.workspaceRecord(resolutionId))continue;
      if(!native.creationStatus||!native.settleCreation||!native.discardCreation)throw Error('Native component cannot reconcile detached creation');const committed=creationCommits.get(intent.operationId),decision=committed?.commit.creationDecision;
      if(committed&&(!decision||decision.intentId!==record.id))throw Error('Creation commit has no exact original vector');
      for(const [index,item]of intent.items.entries()){const status=await native.creationStatus(item.candidateId),prepared=decision?.items[index];if(decision){if(!prepared||prepared.candidateId!==item.candidateId||prepared.imageId!==item.imageId)throw Error('Creation recovery order/identity changed');if(status.state==='prepared'){if(!status.prepared||status.prepared.baseVersion!==null||status.prepared.candidateId!==item.candidateId||!same(status.prepared.native,prepared.native))throw Error('Committed creation prepared receipt changed');const accepted=await native.settleCreation(status.prepared);if(!same(accepted,prepared.native))throw Error('Creation recovery acceptance changed');}else if(status.state!=='accepted'||!same(status.native,prepared.native))throw Error('Committed creation has no durable native candidate');}
       else{if(status.state==='accepted')throw Error('Native creation accepted without Main project decision');if(status.state==='pending')throw Error('Creation job is still pending; no cancellation has been proved');if(status.state==='intent'||status.state==='prepared')await native.discardCreation(item.candidateId);}}
      await store.recordWorkspace!({kind:'requestResolution',id:resolutionId,owner:record.owner,requestId:intent.operationId,operationId:intent.operationId,decision:committed?'committed':'notCommitted',commitHash:committed?.commitHash??null});recoveryReports.set(intent.operationId,{operationId:intent.operationId,imageId:intent.items[0].imageId,inputThrough:0,original:'durable-intent',decision:committed?'committed':'notCommitted',commitHash:committed?.commitHash??null});
    }if(page.length<16)break;afterId=page.at(-1)!.id;}}
    if(store.workspaceRecordPage&&store.workspaceRecord&&store.recordWorkspace){let after:string|undefined;const commits=new Map((await store.committed()).map(c=>[c.commit.commitId,c]));for(;;){const page=await store.workspaceRecordPage({kinds:['replacementBatch'],maxRecords:16,...(after?{afterId:after}:{})});for(const record of page.records){if(record.kind!=='replacementBatch')continue;const input=record.intent,resolutionId=`replacement-resolution-${input.operationId}`;if(await store.workspaceRecord(resolutionId))continue;const committed=commits.get(input.operationId),decision=committed?.commit.replacementDecision;if(committed&&(!decision||decision.intentId!==record.id))throw Error('Replacement commit lacks its original vector');if(!native.creationStatus||!native.settleCreation||!native.discardCreation||!native.versionWorkingInput)throw Error('Working refresh recovery is unavailable');for(let n=0;n<input.items.length;n++){const item=input.items[n],status=await native.creationStatus(item.candidateId),d=decision?.items[n];if(decision){if(!d||d.candidateId!==item.candidateId||d.imageId!==item.imageId||!same(await native.versionWorkingInput(d.native),{digest:item.working.digest,byteLength:item.working.byteLength,format:'tiff'}))throw Error('Replacement recovery input identity changed');await checkProtection(d.native,d.protectedSource);if(status.state==='prepared'){if(!status.prepared||status.prepared.baseVersion!==null||!same(status.prepared.native,d.native))throw Error('Replacement prepared receipt changed');if(!same(await native.settleCreation(status.prepared),d.native))throw Error('Replacement acceptance changed');}else if(status.state!=='accepted'||!same(status.native,d.native))throw Error('Replacement lacks exact native candidate');}else{if(status.state==='accepted')throw Error('Native replacement accepted without Main CAS');if(status.state==='pending')throw Error('Working refresh still has an in-flight native job');if(status.state==='prepared'||status.state==='intent')await native.discardCreation(item.candidateId);}}await store.recordWorkspace({kind:'requestResolution',id:resolutionId,owner:record.owner,requestId:input.operationId,operationId:input.operationId,decision:committed?'committed':'notCommitted',commitHash:committed?.commitHash??null});recoveryReports.set(input.operationId,{operationId:input.operationId,imageId:input.items[0].imageId,inputThrough:0,original:'durable-intent',decision:committed?'committed':'notCommitted',commitHash:committed?.commitHash??null});}if(!page.nextAfterId)break;after=page.nextAfterId;}}
    if(store.workspaceRecordPage&&store.workspaceRecord&&store.recordWorkspace){let cursor:string|undefined;for(;;){const page=await store.workspaceRecordPage({kinds:['sourceHydration'],maxRecords:16,...(cursor?{afterId:cursor}:{})});for(const record of page.records){if(record.kind!=='sourceHydration'||await store.workspaceRecord(`hydration-resolution-${record.operationId}`))continue;
      if(!native.creationStatus||!native.settleCreation||!native.discardCreation)throw Error('Detached source recovery is unavailable');const source={importId:record.source.importId,itemId:record.source.itemId,interpretationId:record.source.interpretationId},h=await store.hydration(source),status=await native.creationStatus(record.operationId);
      if(h){if(h.operationId!==record.operationId||h.acceptance!=='detached'||h.source.digest!==record.source.digest||h.source.byteLength!==record.source.byteLength||h.hostBuildDigest!==record.hostBuildDigest||h.optionsHash!==record.optionsHash)throw Error('Source derived decision differs from original hydration input');if(status.state==='prepared'){if(!status.prepared||status.prepared.baseVersion!==null||status.prepared.candidateId!==record.operationId||!same(status.prepared.native,h.native))throw Error('Hydration prepared identity changed');if(!same(await native.settleCreation(status.prepared),h.native))throw Error('Hydration settlement identity changed');}else if(status.state!=='accepted'||!same(status.native,h.native))throw Error('Hydration lacks an exact native candidate');await store.settleHydration(source,record.operationId,h.native);}
      else{if(status.state==='accepted')throw Error('Native hydration accepted without a Main derived-index decision');if(status.state==='pending')throw Error('Hydration is still pending, not canceled');if(status.state==='prepared'||status.state==='intent')await native.discardCreation(record.operationId);}
      await store.recordWorkspace({kind:'sourceHydrationResolution',id:`hydration-resolution-${record.operationId}`,owner:record.owner,operationId:record.operationId,source,decision:h?'hydrated':'notHydrated',...(h?{native:h.native}:{})});
    }if(!page.nextAfterId)break;cursor=page.nextAfterId;}}
    // Pending hydration is a derived-index decision, never a user history edit.
    for(const h of await store.pendingHydrations()){
      const status=h.acceptance==='detached'?await native.creationStatus?.(h.operationId):await native.status(h.operationId);if(!status)throw Error('Detached hydration recovery unavailable');
      if(status.state!=='prepared'&&status.state!=='accepted')throw Error('Hydration has no matching durable native candidate');
      if(status.state==='prepared'){if(h.acceptance==='detached'){if(!native.settleCreation||!status.prepared||status.prepared.baseVersion!==null||!same(status.prepared.native,h.native))throw Error('Detached hydration receipt mismatch');await native.settleCreation(status.prepared);}else await native.recoverAccept(h.operationId,null,h.native);}
      else if(!same(status.native,h.native))throw Error('Hydration native acceptance mismatch');
      await store.settleHydration(h.source,h.operationId,h.native);
    }
    type RecoveryItem={operationId:string;imageId:string;inputThrough:number;predecessor:string|null;decision:Awaited<ReturnType<ProjectStoreV2['operationDecision']>>;status:NativeOperationStatus};
    const items=new Map<string,RecoveryItem>();
    for(const intent of await store.pendingOperations())items.set(intent.operationId,{operationId:intent.operationId,imageId:intent.imageId,inputThrough:'stroke'in intent?intent.stroke.points.length/2:0,predecessor:intent.version===2?intent.predecessorOperationId:null,decision:await store.operationDecision(intent.operationId),status:await native.status(intent.operationId)});
    for(const obligation of confirmationObligations.values())if(!items.has(obligation.record.operationId)){
      const decision=await store.operationDecision(obligation.record.operationId);if(!decision)throw Error('Confirmation obligation has no project decision');
      items.set(obligation.record.operationId,{operationId:obligation.record.operationId,imageId:obligation.imageId,inputThrough:obligation.inputThrough,predecessor:decision.decision.pipeline?.predecessorOperationId??null,decision,status:await native.status(obligation.record.operationId)});
    }
    const ordered:RecoveryItem[]=[],visiting=new Set<string>(),visited=new Set<string>();
    const visit=async(item:RecoveryItem):Promise<void>=>{
      if(visited.has(item.operationId))return;if(visiting.has(item.operationId))throw Error('Cyclic recovery predecessor');visiting.add(item.operationId);
      if(!item.decision&&item.status.state==='accepted')throw Error('Native accepted without a reachable project decision; evidence preserved');
      if(item.predecessor){
        const parent=items.get(item.predecessor),parentDecision=parent?.decision??await store.operationDecision(item.predecessor),parentStatus=parent?.status??await native.status(item.predecessor);
        if(item.decision&&!parentDecision)throw Error('Recovery predecessor has no reachable project decision');
        if(item.status.state==='accepted'&&parentStatus.state!=='accepted')throw Error('Native accepted descendant has an unaccepted predecessor');
        if(parentStatus.state==='accepted'&&(!parentDecision||!same(parentStatus.native,parentDecision.decision.prepared)))throw Error('Accepted predecessor receipt differs from project');
        if(parent)await visit(parent);else if(parentStatus.state!=='accepted')throw Error('Retired predecessor lacks durable native acceptance');
      }
      visiting.delete(item.operationId);visited.add(item.operationId);ordered.push(item);
    };
    for(const item of items.values())await visit(item);
    for(const item of ordered){
      recovery={operationId:item.operationId,commitHash:item.decision?.commitHash??null};
      if(item.decision){
        const c=item.decision,d=c.decision;
        if(item.status.state==='prepared')await native.recoverAccept(d.candidateId,d.baseNative,d.prepared);
        else if(item.status.state!=='accepted'||!same(item.status.native,d.prepared))throw Error('Committed image has no matching native prepared/accepted record');
        await store.confirmOperations([{commitHash:c.commitHash,operationId:d.operationId,native:d.prepared}]);
        recoveryReports.set(item.operationId,{operationId:item.operationId,imageId:item.imageId,inputThrough:item.inputThrough,original:'durable-intent',decision:'committed',commitHash:c.commitHash});
      }else{
        await native.cancelPreview(item.operationId);if(item.status.state==='prepared'||item.status.state==='intent')await native.discard(item.operationId);
        await store.resolveOperation(item.operationId,'discarded',null);pendingPlans.delete(item.operationId);
        recoveryReports.set(item.operationId,{operationId:item.operationId,imageId:item.imageId,inputThrough:item.inputThrough,original:'durable-intent',decision:'notCommitted',commitHash:null});
      }
    }
    confirmationObligations.clear();
    // Also settle a committed receipt whose intent resolution was already durable.
    for(const c of await store.unsettledDecisions()){
      const d=c.decision;if(!d.baseNative)throw Error('Missing native base');
      const status=await native.status(d.operationId);
      if(status.state==='prepared')await native.recoverAccept(d.candidateId,d.baseNative,d.prepared);
      else if(status.state!=='accepted'||!same(status.native,d.prepared))throw Error('Native settlement contradicts project decision');
      await store.settle(c.commitHash,d.operationId,d.prepared);
    }
    const latest=await store.load();if(!latest)throw Error('Project head disappeared during recovery');
    if(!same(current(),latest.commit.after)){const plan=pendingPlans.get(latest.commit.commitId);if(!plan)throw Error('Durable project/history reconciliation requires reopening this Session');const result=history.commit(plan);if(!result.ok||!same(result.value.after,latest.commit.after))throw Error('Pending history plan differs from committed project');pendingPlans.delete(latest.commit.commitId);}
    // Auditing drained the old Main writer. A metadata plan absent from the
    // verified reachable prefix is not committed, and must not hold history/UI
    // hostage. Its exact accepted request body remains recovery evidence.
    const reachable=new Set((await store.committed()).map(c=>c.commit.commitId));
    for(const operationId of [...pendingPlans.keys()])if(!reachable.has(operationId)){
      if(await store.operationDecision(operationId)||(await store.operationRecord?.(operationId))?.resolution?.decision==='committed')throw Error('Pending plan contradicts a committed image decision');
      if(store.workspaceRecordPage&&store.recordWorkspace){let cursor:string|undefined;for(;;){const page=await store.workspaceRecordPage({kinds:['request'],maxRecords:16,...(cursor?{afterId:cursor}:{})});const request=page.records.find(r=>r.kind==='request'&&r.operationId===operationId);if(request?.kind==='request'&&request.command.kind==='board'){await store.recordWorkspace({kind:'requestResolution',id:`metadata-resolution-${operationId}`,owner:request.owner,requestId:request.requestId,operationId,decision:'notCommitted',commitHash:null});break;}if(!page.nextAfterId)break;cursor=page.nextAfterId;}}
      pendingPlans.delete(operationId);
    }
    head=latest;await installSelected();
    while(recoveryReports.size>64)recoveryReports.delete(recoveryReports.keys().next().value!);
    if(retainedRecoveryInputs.length){recovery={operationId:retainedRecoveryInputs[0].operationId,commitHash:null};phase='recovering';notify();return;}
    if(replaceWorker){initializeSettlement();initializePipeline();}
    recovery=undefined;
    if(freezeAfterRecovery){nativeMayBeFrozen=true;await native.freeze();await store.validateRecovery();phase='frozen';}else phase='active';notify();
  };
  const commitPlan=async(plan:HistoryPlan<ProjectV2>,operationId:string,decision?:NativeDecision,creationDecision?:ImageCreationBatchDecision,replacementDecision?:ImageReplacementBatchDecision)=>{
    const record:ProjectCommitV2={schema:'flow.project-commit',version:1,commitId:operationId,previousCommitHash:head!.commitHash,beforeRevision:current().revision,after:copy(plan.result.after),...(decision?{nativeDecision:decision}:{}),...(creationDecision?{creationDecision}:{}),...(replacementDecision?{replacementDecision}:{})};
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
    const origin=options.originForOperation?.(operationId);await store.beginOperation({...intent,...(origin?{origin:copy(origin)}:{})});
    try{
      const prepared=await native.preparePaint(operationId,base,stroke);
      if(prepared.candidateId!==operationId||prepared.baseVersion!==base.versionId||!validNativeImageRef(prepared.native))throw Error('Native prepared receipt mismatch');
      await checkProtection(prepared.native,await protectionFor(shot.imageId));
      if(same(prepared.native,base)){await native.discard(operationId);await store.resolveOperation(operationId,'discarded',null);return settled();}
      const plan=history.prepare(await installedEdit(shot.imageId,expected,prepared.native));if(!plan.ok)throw Error(plan.error.message);
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
  const imageEdit=async(request:Extract<NativeProjectRequest,{kind:'imageEdit'}>,fixedOperationId?:string):Promise<ImageProjectOutcome>=>{
    if(!native.prepareEdit)throw Object.assign(Error('Native component does not support product image edits'),{code:'unsupported',effect:'none'});
    const p=current(),shot=p.shots.find(s=>s.id===request.shotId);if(!shot)throw Object.assign(Error('Only an active shot can be edited'),{code:'not-found',effect:'none'});
    const base=await resolve(shot.imageId);if(!same(base,request.expectedNative))throw Object.assign(Error('Displayed image version changed; keep the original tool input'),{code:'conflict',effect:'none'});
    const operationId=fixedOperationId??mint(),expected=copy(p.images[shot.imageId].content),intent:ImageOperationIntent={schema:'flow.image-edit-intent',version:3,operationId,sessionId,incarnation,imageId:shot.imageId,expected,baseNative:base,contextGeneration:request.expectedContextGeneration,edit:copy(request.edit)};
    await store.beginOperation(intent);let decided:string|null=null;
    try{
      const prepared=await native.prepareEdit(operationId,base,copy(request.edit),{expectedContextGeneration:request.expectedContextGeneration,...(request.preview?{preview:copy(request.preview)}:{})});
      if(prepared.candidateId!==operationId||prepared.baseVersion!==base.versionId||!validNativeImageRef(prepared.native))throw Error('Native image edit prepared receipt mismatch');
      const decision:NativeDecision={kind:'image',operationId,candidateId:prepared.candidateId,imageId:shot.imageId,expected,baseNative:base,prepared:prepared.native};
      await checkProtection(prepared.native,await protectionFor(shot.imageId));
      if(same(prepared.native,base)){await store.decideUnchanged(head!.commitHash,decision);decided=head!.commitHash;}
      else{const plan=history.prepare(await installedEdit(shot.imageId,expected,prepared.native));if(!plan.ok)throw Error(plan.error.message);decided=(await commitPlan(plan.value,operationId,decision)).commitHash;}
      const accepted=await native.accept(prepared,base);if(!same(accepted,prepared.native))throw Error('Native image edit acceptance mismatch');
      await store.confirmOperations([{commitHash:decided,operationId,native:accepted}]);return settled();
    }catch(e){
      if(!decided&&(e as {effect?:unknown})?.effect==='none')try{const status=await native.status(operationId);if(['absent','failed','discarded'].includes(status.state)){await store.resolveOperation(operationId,'discarded',null);return fail(e);}}catch{/* Original edit stays durable and protected. */}
      phase='recovering';recovery={operationId,commitHash:decided};notify();return decided?{kind:'settlementPending',operationId,commitHash:decided,snapshot:snapshot()}:{kind:'recoveryPending',operationId,snapshot:snapshot()};
    }
  };
  const createBatch=async(request:Extract<NativeProjectRequest,{kind:'createBatch'}>,operationId:string):Promise<ImageProjectOutcome>=>{
    if(!native.prepareCreation||!native.creationStatus||!native.settleCreation||!native.discardCreation||!store.recordWorkspace)throw Object.assign(Error('Detached image creation is unavailable'),{code:'unsupported',effect:'none'});
    const intent:ImageCreationBatchIntent={schema:'flow.image-creation-batch',version:1,operationId,sessionId,incarnation,anchorCommitHash:head!.commitHash,items:copy(request.items),placement:copy(request.placement)};
    for(const item of intent.items){if(item.input.kind==='duplicate'&&item.originImageId){if(!same(await resolve(item.originImageId),item.input.source))throw Error('Duplicate origin image changed');const origin=await protectionFor(item.originImageId);if(item.protectedSource&&!same(item.protectedSource,origin))throw Error('Duplicate protected origin changed');if(origin)item.protectedSource=copy(origin);await checkProtection(item.input.source,origin);}else if(item.input.kind==='duplicate')await checkProtection(item.input.source,undefined);}
    if(!validImageCreationIntent(intent))throw Object.assign(Error('Invalid detached creation batch'),{code:'invalid-input',effect:'none'});
    const provisional:ImageCreationBatchDecision={kind:'creation-batch',operationId,intentId:`creation-${operationId}`,items:intent.items.map((item,index)=>({candidateId:item.candidateId,imageId:item.imageId,native:{storeId:item.input.kind==='duplicate'?item.input.source.storeId:'preflight',documentId:`preflight-${index}`,versionId:'a'.repeat(64),manifestSha256:'a'.repeat(64),width:item.input.kind==='new'?item.input.width:item.input.source.width,height:item.input.kind==='new'?item.input.height:item.input.source.height}}))};
    const preflight=applyImageProjectEdit(current(),creationProjectEdit(intent,provisional));if(!preflight.ok)throw Object.assign(Error(preflight.error.message),{code:'invalid-input',effect:'none'});
    const intentId=`creation-${operationId}`;await store.recordWorkspace({kind:'creationBatch',id:intentId,owner:{sessionId,incarnation,workspaceEpoch:options.workspaceEpoch??0},intent});let committed:string|null=null;
    try{
      const prepared:PreparedImage[]=[];for(const item of intent.items){const p=await native.prepareCreation(item.candidateId,copy(item.input),{maxAdditionalBytes:request.maxAdditionalBytes});if(p.candidateId!==item.candidateId||p.baseVersion!==null||!validNativeImageRef(p.native))throw Error('Detached creation receipt changed');await checkProtection(p.native,item.protectedSource);prepared.push(p);}
      const decision:ImageCreationBatchDecision={kind:'creation-batch',operationId,intentId,items:prepared.map((p,n)=>({candidateId:p.candidateId,imageId:intent.items[n].imageId,native:p.native}))},plan=history.prepare(creationProjectEdit(intent,decision));if(!plan.ok)throw Error(plan.error.message);
      const receipt=await commitPlan(plan.value,operationId,undefined,decision);committed=receipt.commitHash;
      for(const p of prepared){const accepted=await native.settleCreation(p);if(!same(accepted,p.native))throw Error('Detached acceptance receipt changed');}
      await store.recordWorkspace({kind:'requestResolution',id:`creation-resolution-${operationId}`,owner:{sessionId,incarnation,workspaceEpoch:options.workspaceEpoch??0},requestId:operationId,operationId,decision:'committed',commitHash:committed});return settled();
    }catch{phase='recovering';recovery={operationId,commitHash:committed};notify();return committed?{kind:'settlementPending',operationId,commitHash:committed,snapshot:snapshot()}:{kind:'recoveryPending',operationId,snapshot:snapshot()};}
  };
  const replaceBatch=async(request:Extract<NativeProjectRequest,{kind:'replaceBatch'}>,operationId:string):Promise<ImageProjectOutcome>=>{
    const record=await store.workspaceRecord?.(request.intentId);if(record?.kind!=='replacementBatch'||!validImageReplacementIntent(record.intent)||record.intent.operationId!==operationId||record.intent.anchorCommitHash!==head!.commitHash||record.intent.items.length!==request.prepared.length)throw Object.assign(Error('Replacement plan is stale or incomplete'),{code:'stale-refresh',effect:'none'});
    const intent=record.intent;if(!native.versionWorkingInput||!native.versionSourcePolicy||!native.settleCreation)throw Object.assign(Error('Native working refresh is unavailable'),{code:'unsupported',effect:'none'});let committed:string|null=null;
    try{const items:ImageReplacementBatchDecision['items'][number][]=[];for(let n=0;n<intent.items.length;n++){const input=intent.items[n],p=request.prepared[n];if(p.baseVersion!==null||p.candidateId!==input.candidateId||!validNativeImageRef(p.native)||!same(await native.versionWorkingInput(p.native),{digest:input.working.digest,byteLength:input.working.byteLength,format:'tiff'}))throw Error('Replacement candidate input identity changed');const policy=await native.versionSourcePolicy(p.native),origin=input.protectedSource??(policy?{source:{importId:input.working.importId,itemId:input.working.itemId,interpretationId:input.working.interpretationId},original:policy.original,referenceRgbaSha256:policy.referenceRgbaSha256}:undefined);assertVersionProtection(origin,policy);items.push({imageId:input.imageId,candidateId:input.candidateId,native:p.native,...(origin?{protectedSource:origin}:{})});}
     const decision:ImageReplacementBatchDecision={kind:'replacement-batch',operationId,intentId:record.id,items},plan=history.prepare(replacementProjectEdit(intent,decision));if(!plan.ok)throw Error(plan.error.message);committed=(await commitPlan(plan.value,operationId,undefined,undefined,decision)).commitHash;for(const p of request.prepared){const accepted=await native.settleCreation(p);if(!same(accepted,p.native))throw Error('Replacement acceptance identity changed');}await store.recordWorkspace!({kind:'requestResolution',id:`replacement-resolution-${operationId}`,owner:record.owner,requestId:operationId,operationId,decision:'committed',commitHash:committed});await installSelected();notify();return settled();
    }catch{phase='recovering';recovery={operationId,commitHash:committed};notify();return committed?{kind:'settlementPending',operationId,commitHash:committed,snapshot:snapshot()}:{kind:'recoveryPending',operationId,snapshot:snapshot()};}
  };
  const initializePipeline=()=>{if(options.pipeline){
    if(!native.pipeline)throw Error('Opt-in Main pipeline requires a typed native pipeline driver');
    pipeline=createMainImagePipeline({sessionId,incarnation,driver:native.pipeline,limits:copy(options.pipeline),mintId:mint,canAdmit:()=>!closed&&phase==='active'&&barriers===0,canBegin:()=>settlement.capacityAvailable,
      anchor(shotId){const p=current(),shot=p.shots.find(s=>s.id===shotId);if(!shot)throw Error('Only active shots can start painting');return{imageId:shot.imageId,expected:copy(p.images[shot.imageId].content),commitHash:head!.commitHash,native:()=>resolve(shot.imageId)};},
      persist:intent=>{const origin=options.originForOperation?.(intent.operationId);return store.beginOperation({...intent,...(origin?{origin:copy(origin)}:{})});},
      blocked(operationId,error){const detail=error as {code?:unknown;message?:unknown;effect?:unknown;operationId?:unknown;command?:unknown};console.warn('[Flow pipeline fault]',JSON.stringify({operationId,sourceOperationId:String(detail?.operationId??'').slice(0,128),command:String(detail?.command??'').slice(0,64),code:String(detail?.code??'pipeline-failed').slice(0,128),message:String(detail?.message??error).slice(0,2048),effect:String(detail?.effect??'unknown').slice(0,32)}));phase='recovering';if(!recovery?.commitHash)recovery={operationId,commitHash:null};settlement.fence(error);notify();},
      decide(entry:PipelineEntry){
        pending++;notify();let finish!:(outcome:ImageProjectOutcome)=>void;const completed=new Promise<ImageProjectOutcome>(resolve=>finish=resolve);let commitHash:string|null=null;
        let stage='waiting-prepared';
        const failed=(error:unknown)=>{
          const detail=error as {code?:unknown;message?:unknown;effect?:unknown};
          console.warn('[Flow paint recovery]',JSON.stringify({operationId:entry.operationId,stage,commitHash,code:String(detail?.code??'pipeline-decision-failed').slice(0,128),message:String(detail?.message??error).slice(0,2048),effect:String(detail?.effect??'unknown').slice(0,32)}));
          phase='recovering';recovery={operationId:entry.operationId,commitHash};notify();finish(commitHash?{kind:'settlementPending',commitHash,operationId:entry.operationId,snapshot:snapshot()}:{kind:'recoveryPending',operationId:entry.operationId,snapshot:snapshot()});};
        const work=tail.then(async()=>{
          if(phase!=='active')throw Error('Main pipeline decision admission blocked');
          const prepared=await entry.preparedWait.promise;if(phase!=='active'||!entry.intent)throw Error('Native prepared without active durable Main intent');
          const p=current(),image=p.images[entry.imageId];if(!image)throw Error('Pipeline target disappeared');
          const base=await resolve(entry.imageId);if(phase!=='active'||prepared.baseVersion!==base.versionId)throw Error('FIFO decision base differs from current project');
          const decision:NativeDecision={kind:'image',operationId:entry.operationId,candidateId:prepared.candidateId,imageId:entry.imageId,expected:copy(image.content),baseNative:base,prepared:prepared.native,pipeline:{pipelineId:entry.intent.pipelineId,anchorCommitHash:entry.intent.anchorCommitHash,predecessorOperationId:entry.predecessorOperationId}};
          stage='checking-protection';await checkProtection(prepared.native,await protectionFor(entry.imageId));
          stage='committing-project';
          if(same(base,prepared.native)){const unchangedHead=head!.commitHash;await store.decideUnchanged(unchangedHead,decision);commitHash=unchangedHead;}
          else{const plan=history.prepare(await installedEdit(entry.imageId,decision.expected,prepared.native));if(!plan.ok)throw Error(plan.error.message);commitHash=(await commitPlan(plan.value,entry.operationId,decision)).commitHash;}
          const record:ProjectConfirmation={commitHash,operationId:entry.operationId,native:prepared.native};confirmationObligations.set(entry.operationId,{record,imageId:entry.imageId,inputThrough:entry.through});
          pipeline!.projectCommitted(entry,commitHash);
          if(phase!=='active')throw Error('Project decided while native reconciliation became necessary');
          stage='confirming-native';void settlement.enqueue(record,async()=>{
            const accepted=await pipeline!.accept(entry,prepared,base);if(!same(accepted,prepared.native))throw Error('Pipeline accepted receipt mismatch');pipeline!.releaseInput(entry);
          }).then(()=>{confirmationObligations.delete(entry.operationId);pipeline!.release(entry);finish(settled());},failed);
        }).catch(failed);tail=work.then(()=>undefined,()=>undefined);
        return completed.finally(()=>{pending--;notify();});
      }
    });
    pipeline.subscribe(event=>{for(const f of progressListeners)try{void Promise.resolve(f(copy(event))).catch(()=>{});}catch{/* presentation only */}});
  }};
  const initializeSettlement=()=>{settlement=createNativeSettlementQueue({confirm:records=>store.confirmOperations(records),onFault:error=>{phase='recovering';pipeline?.fence(error);notify();}});};initializeSettlement();
  const detachFault=native.onFault?.(error=>{if(closed)return;const reason=error??Error('Owned native worker fault');phase='recovering';pipeline?.fence(reason);settlement.fence(reason);notify();});
  try{await reconcile();}catch(e){detachFault?.();throw e;}initializePipeline();
  return {
    ...(pipeline?{pipeline:{input:(value:ImagePipelineInput)=>pipeline!.input(value),waitOperation:(operationId:string)=>{const recovered=recoveredWait.get(operationId);return recovered?Promise.resolve(copy(recovered)):pipeline!.waitOperation(operationId);},subscribe:(f:(event:ImagePipelineProgress)=>void)=>{progressListeners.add(f);return()=>progressListeners.delete(f);},recoveryInputs:()=>phase==='recovering'?copy(retainedRecoveryInputs.length?retainedRecoveryInputs:pipeline!.retainedInputs()):[]}}:{}),
    resolveRetainedInput(operationId,recordId){
      const work=tail.then(async():Promise<ImageProjectOutcome>=>{try{
        if(phase!=='recovering')throw Error('Resolve recovery-only input only while recovering');const input=retainedRecoveryInputs.find(i=>i.operationId===operationId);if(!input)throw Error('No retained input identity');
        const evidence=await store.workspaceRecord?.(recordId);if(evidence?.kind!=='capturedInput'||evidence.original.shotId!==input.shotId||evidence.original.capturedThrough<input.stroke.points.length/2)throw Error('Missing durable original input evidence');
        const {points:originalPoints,pressures:originalPressures,...originalStyle}=evidence.original.stroke,{points,pressures,...style}=input.stroke;
        if(!same(originalStyle,style)||!same(originalPoints.slice(0,points.length),points)||(pressures&&!same((originalPressures??Array(pressures.length).fill(1)).slice(0,pressures.length),pressures)))throw Error('Durable original does not contain the retained input');
        if(await store.operationDecision(operationId)||(await store.pendingOperations()).some(i=>i.operationId===operationId))throw Error('Retained input acquired a durable native intent; reconcile it first');
        const status=await native.status(operationId);if(!['absent','discarded','failed'].includes(status.state))throw Error('Native input cannot yet be proven uncommitted');
        retainedRecoveryInputs=retainedRecoveryInputs.filter(i=>i.operationId!==operationId);const report:ImageRecoveryDisposition={operationId,imageId:input.imageId,inputThrough:0,original:'recovery-only-record',recordId,decision:'notCommitted',commitHash:null};recoveryReports.set(operationId,report);
        if(!retainedRecoveryInputs.length){await installSelected();initializeSettlement();initializePipeline();recovery=undefined;phase='active';}notify();return{kind:'recovered',commitHash:head!.commitHash,snapshot:snapshot(),operations:[report]};
      }catch(e){return fail(e);}});tail=work.then(()=>undefined,()=>undefined);return work;
    },
    operationRecords:page=>store.operationRecords(page),
    snapshot,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},
    request(input,identity){
      const fixedOperationId=identity?.operationId;if(fixedOperationId!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(fixedOperationId))return Promise.resolve(fail(Object.assign(Error('Invalid Main operation identity'),{effect:'none'})));
      if(pending>=32)return Promise.resolve(fail(Object.assign(Error('Main request queue is full'),{code:'resource-limit',effect:'none'})));
      let request:NativeProjectRequest;
      try{request=copy(input);const valid=request?.kind==='replaceBatch'?shape(request,['kind','intentId','prepared'])&&typeof request.intentId==='string'&&Array.isArray(request.prepared)&&request.prepared.length>0&&request.prepared.length<=64:request?.kind==='createBatch'?shape(request,['kind','items','placement','maxAdditionalBytes'])&&Array.isArray(request.items)&&request.items.every(i=>shape(i,['candidateId','imageId','input'],['originImageId','protectedSource'])&&validNativeCreationInput(i.input))&&Number.isSafeInteger(request.maxAdditionalBytes)&&request.maxAdditionalBytes>0:request?.kind==='paint'?shape(request,['kind','shotId','stroke']):request?.kind==='imageEdit'?shape(request,['kind','shotId','expectedNative','expectedContextGeneration','edit'],['preview'])&&validNativeImageRef(request.expectedNative)&&Number.isSafeInteger(request.expectedContextGeneration)&&request.expectedContextGeneration>=0&&validImageEngineEdit(request.edit)&&(request.preview===undefined||validImageEnginePreviewStamp(request.preview)):request?.kind==='board'?shape(request,['kind','edit'],['typing']):shape(request,['kind'])&&['undo','redo','recover','freeze','resume','barrier'].includes(String(request.kind));if(!valid)throw Error('Invalid Main Session request');}catch{return Promise.resolve(fail(Object.assign(Error('Invalid Main Session request'),{code:'invalid-input',effect:'none'})));}
      const isBarrier=request.kind==='undo'||request.kind==='redo'||request.kind==='freeze'||request.kind==='imageEdit'||request.kind==='barrier'||request.kind==='createBatch'||request.kind==='replaceBatch';
      // Admission-time context matters: an active gesture can end before this
      // request reaches tail, putting its decision behind the barrier itself.
      // Refuse now without owning a seal. Its later up remains ordinary FIFO work.
      if(isBarrier&&phase==='active'&&pipeline?.hasActive){
        if(request.kind==='undo'||request.kind==='redo'){
          const context=tail.then(()=>{history.endTyping();notify();});tail=context.then(()=>undefined,()=>undefined);
        }
        return Promise.resolve(fail(Object.assign(Error('Finish or cancel the active gesture before retrying this barrier'),{code:'busy',effect:'none'})));
      }
      if(isBarrier){barriers++;pipeline?.seal();}
      pending++;notify();
      const work=tail.then(async():Promise<ImageProjectOutcome>=>{
        if(closed)return fail(Object.assign(Error('Session closed'),{code:'closed',effect:'none'}));
        if(phase==='recovering'&&request.kind!=='recover')return fail(Object.assign(Error('Reconcile the pending operation first'),{code:'busy',effect:'retained'}));
        try{
          if(phase==='frozen'&&request.kind!=='freeze'&&request.kind!=='resume')throw Object.assign(Error('Frozen Session can only close'),{code:'busy',effect:'none'});
          if(request.kind==='recover'){
            const replacing=phase==='recovering'&&Boolean(native.restartForRecovery);await reconcile(replacing);
            if(retainedRecoveryInputs.length)return{kind:'recoveryPending',operationId:retainedRecoveryInputs[0].operationId,snapshot:snapshot(),retainedInputs:copy(retainedRecoveryInputs),reconciled:copy([...recoveryReports.values()])};
            if(replacing||recoveryReports.size){const outcome:ImageProjectOutcome={kind:'recovered',commitHash:head!.commitHash,snapshot:snapshot(),operations:copy([...recoveryReports.values()])};for(const report of recoveryReports.values())recoveredWait.set(report.operationId,outcome);while(recoveredWait.size>64)recoveredWait.delete(recoveredWait.keys().next().value!);return outcome;}
            return settled();
          }
          if(request.kind==='resume'){
            if(phase!=='frozen')throw Object.assign(Error('Only a settled frozen Session can resume'),{code:'busy',effect:'none'});
            if(!native.resume)throw Object.assign(Error('Native driver does not support settled resume'),{code:'unsupported',effect:'none'});
            try{await native.resume();}catch(e){phase='recovering';notify();throw e;}
            nativeMayBeFrozen=false;phase='active';notify();return settled();
          }
          if(request.kind==='replaceBatch'){await settlement.drain();await pipeline?.barrier();history.endTyping();const result=await replaceBatch(request,fixedOperationId??mint());return result;}
          if(request.kind==='freeze'){await settlement.drain();await pipeline?.barrier();phase='freezing';nativeMayBeFrozen=true;await native.freeze();await store.validateRecovery();if((await store.pendingOperations()).length||(await store.unsettledDecisions()).length||(await store.pendingHydrations()).length)throw Error('Unsettled project obligations');phase='frozen';notify();return settled();}
          if(phase!=='active')throw Object.assign(Error('Session admission is frozen'),{code:'busy',effect:'none'});
          if(request.kind==='barrier'){await settlement.drain();await pipeline?.barrier();history.endTyping();return settled();}
          if(request.kind==='createBatch'){await settlement.drain();await pipeline?.barrier();history.endTyping();const result=await createBatch(request,fixedOperationId??mint());return result;}
          if(request.kind==='imageEdit'){
            await settlement.drain();await pipeline?.barrier();history.endTyping();const result=await imageEdit(request,fixedOperationId);return result;
          }
          if(request.kind==='paint'){if(pipeline)throw Object.assign(Error('Use bounded pipeline input in this opt-in Session'),{code:'invalid-input',effect:'none'});return await paint(request.shotId,request.stroke);}
          if(request.kind==='undo'||request.kind==='redo'){history.endTyping();await settlement.drain();await pipeline?.barrier();}
          const prepared=request.kind==='board'?history.prepare(request.edit,request.typing):request.kind==='undo'?history.prepareUndo():history.prepareRedo();
          if(!prepared.ok){return fail({...prepared.error,effect:'none'});}
          if(!prepared.value.result.changed){return settled();}
          const committed=await commitPlan(prepared.value,fixedOperationId??mint());
          if(request.kind==='undo'||request.kind==='redo')try{await installSelected();}catch{
            phase='recovering';recovery={operationId:committed.commit.commitId,commitHash:committed.commitHash,...(pendingInstall?{target:copy(pendingInstall)}:{})};notify();
            return{kind:'settlementPending',operationId:committed.commit.commitId,commitHash:committed.commitHash,snapshot:snapshot()};
          }

          return settled();
        }catch(e){if(phase==='freezing'||pendingPlans.size)phase='recovering';return fail(e);}
      }).finally(()=>{
        // One owner releases admission after every success, refusal or exception.
        // Other queued barriers, frozen Sessions and faulted pipelines stay closed.
        if(isBarrier)barriers--;pending--;
        if(!closed&&phase==='active'&&barriers===0)pipeline?.resumeAdmission();
        notify();
      });tail=work.then(()=>undefined,()=>undefined);return work.then(result=>'snapshot'in result?{...result,snapshot:snapshot()}:result);
    },
    close:async()=>{await tail;await settlement.drain();if(phase!=='frozen')throw Error('Freeze and settle before close');await native.close();await store.close();closed=true;detachFault?.();}
  };
}
