import{validHydrationDisplay}from'../../../session/core/sourceProtection.js';
import{validImageCreationDecision}from'../../../session/core/imageCreation.js';
import type {WorkspaceRecoveryRecord} from './workspaceRecords.js';
import { validImageEngineEdit } from '../../../platform/contracts/imageEngine.js';
import { createHash } from 'node:crypto';
import type { HydrationRecord, ImageOperationDecision, NativeDecision, ImageOperationPage, ImageOperationRecord, ImageOperationIntent, NativeImageRef, ProjectCommitV2, ProjectHeadV2, SourceImageRef } from '../../../platform/contracts/imageProject.js';
import { imageHash, snapshotImageProject, validNativeDecision, validNativeImageRef, validSourceImageRef, validImageBinding, validProjectStroke } from '../../../session/core/imageProjectModel.js';
import { shape } from '../../../session/core/imageProjectValues.js';
import { canonicalJson } from '../persistence/canonicalJson.js';

export class ImageProjectStoreError extends Error {
  constructor(readonly code:'invalid-input'|'conflict'|'busy'|'closed'|'resource-limit'|'io-failure',message:string,readonly effect:'none'|'retained'|'unknown'='none'){super(message);}
}
export type ProjectConfirmation={commitHash:string;operationId:string;native:NativeImageRef};
export type ProjectCommitReceipt={commitHash:string;commit:ProjectCommitV2;head:ProjectHeadV2};
export type ProjectStoreV2={
  load():Promise<ProjectCommitReceipt|null>;
  recordWorkspace?(record:WorkspaceRecoveryRecord):Promise<void>;
  workspaceRecord?(id:string):Promise<WorkspaceRecoveryRecord|null>;
  workspaceRecordPage?(page:{afterId?:string;maxRecords?:number;kinds:readonly WorkspaceRecoveryRecord['kind'][]}):Promise<{records:WorkspaceRecoveryRecord[];nextAfterId:string|null}>;
  workspaceRecords?(page?:{afterId?:string;maxRecords?:number}):Promise<WorkspaceRecoveryRecord[]>;
  /** Explicit checkpoint/close audit; normal commits reuse the verified leased prefix. */
  validateRecovery():Promise<void>;
  commit(expectedHead:string|null,record:ProjectCommitV2):Promise<ProjectCommitReceipt>;
  committed():Promise<ProjectCommitReceipt[]>;
  unsettled():Promise<ProjectCommitReceipt[]>;
  decideUnchanged(commitHash:string,decision:NativeDecision):Promise<void>;
  operationDecision(operationId:string):Promise<ImageOperationDecision|null>;
  unsettledDecisions():Promise<ImageOperationDecision[]>;
  confirmOperations(records:readonly ProjectConfirmation[]):Promise<void>;
  settle(commitHash:string,operationId:string,native:NativeImageRef):Promise<void>;
  hydration(source:SourceImageRef):Promise<HydrationRecord|null>;
  publishHydration(record:HydrationRecord):Promise<string>;
  settleHydration(source:SourceImageRef,operationId:string,native:NativeImageRef):Promise<void>;
  pendingHydrations():Promise<HydrationRecord[]>;
  beginOperation(intent:ImageOperationIntent):Promise<void>;
  pendingOperations():Promise<ImageOperationIntent[]>;
  operationRecord?(operationId:string):Promise<ImageOperationRecord|null>;
  captureRecord(owner:{sessionId:string;incarnation:string;workspaceEpoch:number},captureId:string):Promise<ImageOperationRecord|null>;
  /** At most 16 full inputs per page; continue after the last operationId. */
  operationRecords(page?:ImageOperationPage):Promise<ImageOperationRecord[]>;
  resolveOperation(operationId:string,decision:'discarded'|'committed',commitHash:string|null):Promise<void>;
  close():Promise<void>;
};
export type ImageProjectStoreOptions={
  root:string;maxRecoveryBytes?:number;
  /** Required external project lease. A process-local test authority is not a production lock. */
  writerAuthority:{assertHeld(root:{path:string;dev:string;ino:string}):Promise<void>};
  /** Main reserves the full fixed quotas of concurrent native/source/output
   * writers (or equivalent shared actual+reserved accounting), including bytes
   * they may create after this store's inventory. Never pass only their current
   * pending writes: their durable growth is outside this journal's ledger. */
  reservedRecoveryBytes?:()=>Promise<number>;
  /** Same Root broker as source/output/lease. Journal reserves exact new bytes
   * before IO and keeps unknown grants until a strict drained scope audit. */
  recoveryBudget?:import('./workspaceOutputContract.js').WorkspaceOutputBudget;
  /** Prepared native versions are valid references before native acceptance. */
  verifyNative(ref:NativeImageRef):Promise<void>;
  verifyNativeProvenance?(ref:NativeImageRef,origin:import('../../../platform/contracts/imageProject.js').ProtectedSourceV2|undefined):Promise<void>;
  verifySource(ref:SourceImageRef,retained?:{digest:string;byteLength:number}):Promise<void>;
};
const TOKEN=/^[A-Za-z0-9_-]{1,128}$/;
const clone=<T>(v:T):T=>structuredClone(v);
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const bytes=(v:unknown)=>Buffer.from(canonicalJson(v)+'\n');
const token=(v:unknown):v is string=>typeof v==='string'&&TOKEN.test(v);
function bad(message:string):never{throw new ImageProjectStoreError('conflict',message);}
export function commitRecord(v:unknown):ProjectCommitV2{
  if(!shape(v,['schema','version','commitId','previousCommitHash','beforeRevision','after'],['nativeDecision','creationDecision'])||v.schema!=='flow.project-commit'||v.version!==1||!token(v.commitId)||(v.previousCommitHash!==null&&!imageHash(v.previousCommitHash))||(v.beforeRevision!==null&&(!Number.isSafeInteger(v.beforeRevision)||Number(v.beforeRevision)<0)))bad('Invalid project commit');
  const after=snapshotImageProject(v.after);
  if(v.creationDecision!==undefined&&(!validImageCreationDecision(v.creationDecision)||v.nativeDecision!==undefined))bad('Invalid creation decision');
  if(v.nativeDecision!==undefined&&!validNativeDecision(v.nativeDecision))bad('Invalid native decision');
  return {...clone(v as unknown as ProjectCommitV2),after};
}
export function hydrationRecord(v:unknown):HydrationRecord{
  if(!shape(v,['schema','version','source','hostBuildDigest','optionsHash','native','operationId'],['acceptance','sourceDisplay'])||v.acceptance!==undefined&&v.acceptance!=='detached'||v.schema!=='flow.image-hydration'||v.version!==1||!shape(v.source,['importId','itemId','interpretationId','digest','byteLength'])||!validSourceImageRef({importId:v.source.importId,itemId:v.source.itemId,interpretationId:v.source.interpretationId})||!imageHash(v.source.digest)||!Number.isSafeInteger(v.source.byteLength)||Number(v.source.byteLength)<0||!imageHash(v.hostBuildDigest)||!imageHash(v.optionsHash)||!validNativeImageRef(v.native)||!token(v.operationId))bad('Invalid hydration record');
  if(v.sourceDisplay!==undefined&&!validHydrationDisplay(v.sourceDisplay,(v as unknown as HydrationRecord).source,(v as unknown as HydrationRecord).native))bad('Invalid hydration display proof/policy');
  return clone(v as unknown as HydrationRecord);
}
export function operationIntent(v:unknown):ImageOperationIntent{
 if(!shape(v,['schema','version','operationId','sessionId','incarnation','imageId'],['expected','baseNative','stroke','pipelineId','anchorCommitHash','anchor','expectedAtAnchor','predecessorOperationId','inputThrough','contextGeneration','edit','origin'])||v.schema!=='flow.image-edit-intent'||![v.operationId,v.sessionId,v.incarnation,v.imageId].every(token))bad('Invalid image operation intent');
 const optional=v.origin===undefined?[]:['origin'];
 if(v.origin!==undefined){const o=v.origin;if(!shape(o,['workspaceEpoch','captureId','beginInputId','inputs'])||!Number.isSafeInteger(o.workspaceEpoch)||Number(o.workspaceEpoch)<0||!token(o.captureId)||!token(o.beginInputId)||!Array.isArray(o.inputs)||o.inputs.length<1||o.inputs.length>4096||new Set(o.inputs.map(b=>b?.inputId)).size!==o.inputs.length||o.inputs.some(b=>!shape(b,['inputId','kind','fromSeq','throughSeq','sha256'])||!token(b.inputId)||!['begin','append','end','cancel'].includes(String(b.kind))||!Number.isSafeInteger(b.fromSeq)||Number(b.fromSeq)<1||!Number.isSafeInteger(b.throughSeq)||Number(b.throughSeq)<Number(b.fromSeq)||!imageHash(b.sha256))||o.inputs[0].kind!=='begin'||o.inputs[0].inputId!==o.beginInputId)bad('Invalid input origin');}
 if(v.version===1){if(!shape(v,['schema','version','operationId','sessionId','incarnation','imageId','expected','baseNative','stroke'],optional)||!validImageBinding(v.expected)||!validNativeImageRef(v.baseNative)||!validProjectStroke(v.stroke))bad('Invalid serial input');}
 else if(v.version===2){if(!shape(v,['schema','version','operationId','sessionId','incarnation','imageId','pipelineId','anchorCommitHash','anchor','expectedAtAnchor','predecessorOperationId','inputThrough','stroke'],optional)||!token(v.pipelineId)||!imageHash(v.anchorCommitHash)||!validNativeImageRef(v.anchor)||!validImageBinding(v.expectedAtAnchor)||(v.predecessorOperationId!==null&&(!token(v.predecessorOperationId)||v.predecessorOperationId===v.operationId))||!validProjectStroke(v.stroke)||v.inputThrough!==v.stroke.points.length/2)bad('Invalid pipeline input');}
 else if(v.version===3){if(!shape(v,['schema','version','operationId','sessionId','incarnation','imageId','expected','baseNative','contextGeneration','edit'],optional)||!validImageBinding(v.expected)||!validNativeImageRef(v.baseNative)||!Number.isSafeInteger(v.contextGeneration)||Number(v.contextGeneration)<0||!validImageEngineEdit(v.edit))bad('Invalid image edit input');}
 else bad('Unknown image operation version');
 return clone(v as unknown as ImageOperationIntent);
}
export const hydrationKey=(s:SourceImageRef)=>sha(bytes({importId:s.importId,itemId:s.itemId,interpretationId:s.interpretationId}));
