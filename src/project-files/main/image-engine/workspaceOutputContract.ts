import type {NativeImageRef, ProjectV2} from '../../../platform/contracts/imageProject.js';
import type {ImageWorkspaceOwner} from '../../../platform/contracts/imageWorkspace.js';
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
export type WorkspaceOutputFrozen = {
 owner:ImageWorkspaceOwner;commitHash:string;project:ProjectV2;
 /** Main resolves settled hydration. Save needs every live image; append only its batch. */
 resolvedImages:Record<string,{native:NativeImageRef;format:'tiff'|'psd'}>;
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
export type WorkspaceOutputFile = {shotId:string;imageId:string;name:string;location:WorkspaceOutputLocation;digest:string;native:NativeImageRef;format:'tiff'|'psd'};
export type WorkspaceOutputReceipt = {operationId:string;projectId:string;revision:number;commitHash:string;files:WorkspaceOutputFile[]};
export type WorkspaceOutputPhysicalIdentity={dev:string;ino:string};
export type WorkspaceOutputObservation = {shotId:string;location:WorkspaceOutputLocation;name:string;expectedDigest:string;observedDigest:string|null;observedIdentity:WorkspaceOutputPhysicalIdentity|null};
/** Main calls only after retaining the original and deciding the Refresh CAS.
 * observedIdentity must travel with the inspected/retained bytes, never be
 * replaced by a fresh stat merely to acknowledge a different same-byte file.
 * This acknowledges file baselines, never a saved ProjectV2 or a native edit. */
export type WorkspaceOutputRefreshReceipt={projectId:string;revision:number;commitHash:string;changes:(Omit<WorkspaceOutputObservation,'observedDigest'|'observedIdentity'>&{observedDigest:string;observedIdentity:WorkspaceOutputPhysicalIdentity;imageId:string;native:NativeImageRef;format:'tiff'})[]};
export type WorkspaceOutputOptions = {
 root:string;projectId:string;
 writerAuthority:{assertHeld(root:{path:string;dev:string;ino:string}):Promise<void>};
 budget:WorkspaceOutputBudget;captureImage:WorkspaceOutputCapture;trashItem?:(file:string)=>Promise<void>;
 /** Fault injection receives named transaction boundaries; production leaves it absent. */
 fault?:(point:string)=>Promise<void>;
};
export type WorkspaceOutput = {
 names(project:ProjectV2):Promise<{shotId:string;name:string;location:WorkspaceOutputLocation}[]>;
 inspect(project:ProjectV2):Promise<WorkspaceOutputObservation[]>;
 save(frozen:WorkspaceOutputFrozen):Promise<WorkspaceOutputReceipt>;
 appendPendingBatch(frozen:WorkspaceOutputFrozen,batch:{shotIds:readonly string[];sourceNames?:Readonly<Record<string,string>>}):Promise<WorkspaceOutputReceipt>;
 acceptRefresh(receipt:WorkspaceOutputRefreshReceipt):Promise<void>;
 recover():Promise<void>;
 hasObligations():boolean;
 /** Successful closure is idempotent; a refused closure retains the same owner. */
 close():Promise<void>;
};
