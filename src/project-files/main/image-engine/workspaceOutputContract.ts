import type {NativeImageRef, ProjectV2} from '../../../platform/contracts/imageProject.js';
import type {ImageWorkspaceOwner} from '../../../platform/contracts/imageWorkspace.js';

export type WorkspaceOutputLocation = 'active'|'parked';
export type WorkspaceOutputFrozen = {
 owner:ImageWorkspaceOwner;commitHash:string;project:ProjectV2;
 /** Main resolves settled hydration. Save needs every live image; append only its batch. */
 resolvedImages:Record<string,{native:NativeImageRef;format:'tiff'|'psd'}>;
};
export type WorkspaceOutputMetadata = {
 projectName:string;shotName:string;scriptText:string;
 dialogues:ProjectV2['dialogues'];presentation:ProjectV2['presentation']|null;
};
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
export type WorkspaceOutputObservation = {shotId:string;location:WorkspaceOutputLocation;name:string;expectedDigest:string;observedDigest:string|null};
/** Main calls only after retaining the original and deciding the Refresh CAS.
 * This acknowledges file baselines, never a saved ProjectV2 or a native edit. */
export type WorkspaceOutputRefreshReceipt={projectId:string;revision:number;commitHash:string;changes:(Omit<WorkspaceOutputObservation,'observedDigest'>&{observedDigest:string;imageId:string;native:NativeImageRef;format:'tiff'})[]};
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
 close():Promise<void>;
};
