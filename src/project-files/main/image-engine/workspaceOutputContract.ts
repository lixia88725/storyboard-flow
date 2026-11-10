import type {SourceInput}from'./sourceStore.js';
import type {WorkspaceSources}from'./workspaceSources.js';
import type {SourceImageRef}from'../../../platform/contracts/imageProject.js';
import type {WorkspaceColdCopyReceipt}from'./workspaceColdCopyContract.js';
import type {NativeImageRef, ProjectV2} from '../../../platform/contracts/imageProject.js';
import type {ImageWorkspaceOwner} from '../../../platform/contracts/imageWorkspace.js';
import {validNativeImageRef,validSourceImageRef}from'../../../session/core/imageProjectModel.js';
import {validPresentation} from '../../../platform/contracts/flowPresentation.js';

export type WorkspaceOutputLocation = 'active'|'parked';
export const WORKSPACE_OUTPUT_NAME_SEED='.storyboard-flow/native-output-name-seed.json';
/** Planned labels only: no output digest/inode, no saved revision or file claim. */
export type WorkspaceOutputNameSeed={schema:'flow.native-output-name-seed';version:1;projectId:string;genesisCommitHash:string;sourceProjectId:string;sourceDigest:string;legacyLedgerSha256:string;
 names:{shotId:string;imageId:string;name:string;location:'parked'}[]};
export const validWorkspaceOutputFileName=(v:unknown):v is string=>typeof v==='string'&&!v.startsWith('.')&&!/[\\/\0]/.test(v)&&/\.tiff?$/i.test(v)&&new TextEncoder().encode(v).byteLength<=255;
export function validWorkspaceOutputNameSeed(v:unknown):v is WorkspaceOutputNameSeed{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const s=v as WorkspaceOutputNameSeed;
 const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v),hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 return Object.keys(s).sort().join()==='genesisCommitHash,legacyLedgerSha256,names,projectId,schema,sourceDigest,sourceProjectId,version'&&s.schema==='flow.native-output-name-seed'&&s.version===1&&id(s.projectId)&&id(s.sourceProjectId)&&hash(s.genesisCommitHash)&&hash(s.sourceDigest)&&hash(s.legacyLedgerSha256)&&Array.isArray(s.names)&&s.names.length>0&&s.names.length<=10000&&Array.from(s.names).every(n=>n&&typeof n==='object'&&Object.keys(n).sort().join()==='imageId,location,name,shotId'&&id(n.shotId)&&id(n.imageId)&&n.location==='parked'&&validWorkspaceOutputFileName(n.name))&&new Set(s.names.map(n=>n.shotId)).size===s.names.length&&new Set(s.names.map(n=>n.imageId)).size===s.names.length&&new Set(s.names.map(n=>n.name.toLowerCase())).size===s.names.length;
}
/** Only untouched photocraft-v1 TIFF source interpretations qualify for metadata-only output. */
export type WorkspaceOutputResolved = {native:NativeImageRef;format:'tiff'|'psd';source?:never}|{native:null;source:SourceImageRef;format:'tiff'};
export const validWorkspaceOutputBinding=(v:{native?:unknown;source?:unknown})=>v.native===null?validSourceImageRef(v.source):v.source===undefined&&validNativeImageRef(v.native);
export type WorkspaceOutputFrozen = {
 owner:ImageWorkspaceOwner;commitHash:string;project:ProjectV2;
 /** Main pins settled native versions or unchanged retained sources. Save covers all live images; append only its batch. */
 resolvedImages:Record<string,WorkspaceOutputResolved>;
};
export type WorkspaceOutputMetadata = {
 projectName:string;shotName:string;scriptText:string;
 dialogues:ProjectV2['dialogues'];presentation:ProjectV2['presentation']|null;
};
/** Versioned Flow namespace payload. Native refs and V1 image/layer trees never
 * belong inside this metadata. Native COW export base64-encodes its UTF-8 JSON. */
export type WorkspaceOutputMetadataEnvelope={
 schema:'flow.native-output-metadata';version:2;projectId:string;revision:number;
 shotId:string;imageId:string;metadata:WorkspaceOutputMetadata;
};
export const WORKSPACE_OUTPUT_METADATA_LIMIT=1024*1024;
export function validWorkspaceOutputMetadataEnvelope(value:unknown):value is WorkspaceOutputMetadataEnvelope{
 const shape=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
 if(!shape(value,['schema','version','projectId','revision','shotId','imageId','metadata'])||value.schema!=='flow.native-output-metadata'||value.version!==2||!id(value.projectId)||!id(value.shotId)||!id(value.imageId)||!Number.isSafeInteger(value.revision)||Number(value.revision)<0)return false;
 const m=value.metadata;
 if(!shape(m,['projectName','shotName','scriptText','dialogues','presentation'])||![m.projectName,m.shotName,m.scriptText].every(v=>typeof v==='string'&&v.length<=WORKSPACE_OUTPUT_METADATA_LIMIT)||!Array.isArray(m.dialogues)||m.presentation!==null&&!validPresentation(m.presentation))return false;
 const ids=new Set<string>();
 for(const row of m.dialogues){if(!shape(row,['id','shotId','text'])||!id(row.id)||ids.has(row.id)||row.shotId!==value.shotId||typeof row.text!=='string'||row.text.length>WORKSPACE_OUTPUT_METADATA_LIMIT)return false;ids.add(row.id);}
 return new TextEncoder().encode(JSON.stringify(value)).byteLength<=WORKSPACE_OUTPUT_METADATA_LIMIT;
}
/** Main-only capture: readonly native COW export must preserve unknown XMP and layers.
 * Unsupported metadata/format, warnings and unknown results must reject. */
export type WorkspaceOutputCapture = (input:{
 owner:ImageWorkspaceOwner;commitHash:string;projectId:string;revision:number;
 shotId:string;imageId:string;native:NativeImageRef;format:'tiff'|'psd';metadata:WorkspaceOutputMetadata;
})=>Promise<{bytes:Uint8Array;sha256:string;layerCount:number}>;
export type WorkspaceOutputBudget = {
 /** One shared atomic broker for the whole workspace, never a local remaining snapshot. */
 reserve(input:{operationId:string;bytes:number;purpose:string}):Promise<{
  /** Final newly retained recovery bytes, not total workspace usage. Published files contribute zero.
   * May resolve a prior retainUnknown after physical audit; repeat same value is idempotent. */
  settleActual(bytes:number):Promise<void>|void;
  /** Preserve the entire grant until an explicit physical audit resolves the result. */
  retainUnknown():Promise<void>|void;
 }>;
};
export type WorkspaceOutputFile = {shotId:string;imageId:string;name:string;location:WorkspaceOutputLocation;digest:string;native:NativeImageRef|null;source?:SourceImageRef;format:'tiff'|'psd'};
export type WorkspaceOutputReceipt = {operationId:string;projectId:string;revision:number;commitHash:string;files:WorkspaceOutputFile[]};
export type WorkspaceOutputOperationOptions={operationId?:string};
export type WorkspaceOutputOperation={state:'absent'}|{state:'pending'|'retained';receipt?:never}|{state:'completed';receipt:WorkspaceOutputReceipt};
export type WorkspaceOutputPhysicalIdentity={dev:string;ino:string};
export type WorkspaceOutputObservation = {shotId:string;imageId:string;location:WorkspaceOutputLocation;name:string;baselineNative:NativeImageRef|null;expectedDigest:string|null;observedDigest:string|null;observedIdentity:WorkspaceOutputPhysicalIdentity|null};
/** Main calls only after retaining the original and deciding the Refresh CAS.
 * observedIdentity must travel with the inspected/retained bytes, never be
 * replaced by a fresh stat merely to acknowledge a different same-byte file.
 * This acknowledges file baselines, never a saved ProjectV2 or a native edit. */
export type WorkspaceOutputRefreshReceipt={projectId:string;revision:number;commitHash:string;changes:(Omit<WorkspaceOutputObservation,'observedDigest'|'observedIdentity'|'baselineNative'>&{baselineNative?:NativeImageRef|null;observedDigest:string;observedIdentity:WorkspaceOutputPhysicalIdentity;native:NativeImageRef;format:'tiff'})[]};
/** Main has durably chosen local Flow pixels. Modified external bytes must be
 * in the one Sources store first; a SourceRef alone is never custody proof. */
export type WorkspaceOutputKeepFlowReceipt={projectId:string;revision:number;commitHash:string;operationId:string;changes:(WorkspaceOutputObservation&{retainedSource?:{source:SourceImageRef;digest:string;byteLength:number}})[]};
export type WorkspaceOutputCustody=Pick<WorkspaceSources,'object'>;
export type WorkspaceOutputOptions = {
 root:string;projectId:string;
 writerAuthority:{assertHeld(root:{path:string;dev:string;ino:string}):Promise<void>;copyReceipt?:WorkspaceColdCopyReceipt};
 budget:WorkspaceOutputBudget;captureImage:WorkspaceOutputCapture;
 /** Sources is the sole custody authority. Source output never creates a native version. */
 sourceCustody?:WorkspaceOutputCustody;
 captureSource?:(input:Omit<Parameters<WorkspaceOutputCapture>[0],'native'|'format'>&{source:SourceImageRef;object:Awaited<ReturnType<WorkspaceSources['object']>>})=>Promise<{bytes:Uint8Array;sha256:string;layerCount:null}>;trashItem?:(file:string)=>Promise<void>;
 /** Fault injection receives named transaction boundaries; production leaves it absent. */
 fault?:(point:string)=>Promise<void>;
};
export type WorkspaceOutput = {
 names(project:ProjectV2):Promise<{shotId:string;name:string;location:WorkspaceOutputLocation}[]>;
 /** Forced live managed IDs expose a stable current observation even when bytes
  * equal the physical baseline, e.g. after a superseded Main Refresh decision. */
 inspect(project:ProjectV2,options?:{includeShotIds?:readonly string[]}):Promise<WorkspaceOutputObservation[]>;
 /** Rechecks exact observation and returns a Main-private, settled-identity input.
  * Main retains it through Sources and compares actual object SHA/length. */
 observeSource(observation:WorkspaceOutputObservation,options?:{itemId?:string}):Promise<SourceInput>;
 save(frozen:WorkspaceOutputFrozen,options?:WorkspaceOutputOperationOptions):Promise<WorkspaceOutputReceipt>;
 appendPendingBatch(frozen:WorkspaceOutputFrozen,batch:{shotIds:readonly string[];sourceNames?:Readonly<Record<string,string>>},options?:WorkspaceOutputOperationOptions):Promise<WorkspaceOutputReceipt>;
 /** Main must drain/reap the old readonly job first. Same frozen/scope/UUID only;
  * retained private captures are verified, never evidence of published files. */
 retryRetainedCapture(frozen:WorkspaceOutputFrozen,batch:{shotIds:readonly string[];sourceNames?:Readonly<Record<string,string>>}|undefined,options:{operationId:string;readonlyCaptureSettled:true}):Promise<WorkspaceOutputReceipt>;
 /** Read-only side-effect status, never a Main project commit decision. */
 queryOperation(operationId:string):Promise<WorkspaceOutputOperation>;
 /** Historical durable ACK; current disk changes never erase this fact. */
 queryRefreshReceipt(receiptHash:string):Promise<'accepted'|'absent'>;
 acceptRefresh(receipt:WorkspaceOutputRefreshReceipt):Promise<void>;
 acceptKeepFlow(receipt:WorkspaceOutputKeepFlowReceipt,custody?:WorkspaceOutputCustody):Promise<void>;
 recover():Promise<void>;
 hasObligations():boolean;
 /** Successful closure is idempotent; a refused closure retains the same owner. */
 close():Promise<void>;
};
