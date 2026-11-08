import type { NativeFrame } from '../../../platform/main/imageEngineFraming.js';
import type { ImagePipelineAdmission } from '../../../platform/contracts/imageProject.js';
import type { ImageWorkspaceBootstrap, ImageWorkspaceClientInput, ImageWorkspaceEvent, ImageWorkspaceFrameIdentity, ImageWorkspaceFrameMessage, ImageWorkspaceFrameReply, ImageWorkspaceInput, ImageWorkspaceOutcome, ImageWorkspaceOwner, ImageWorkspaceRequest } from '../../../platform/contracts/imageWorkspace.js';

/** Adapter supplied by the platform entry. It wraps this window's owned
 * MessagePortMain; the runtime owns protocol sequencing and keyframe recovery. */
export type ImageWorkspaceFrameTransport = {
 send(message:ImageWorkspaceFrameMessage):void;
 subscribe(listener:(reply:ImageWorkspaceFrameReply)=>void):()=>void;
 onClose(listener:()=>void):()=>void;
 close():void;
};
export type ImageWorkspacePickedSources = {kind:'files';files:readonly string[]}|{kind:'folder';folder:string};
/** Main-only permissions. A Session never invokes Electron dialogs or receives
 * a renderer path. Export/trash paths are validated again by file transactions. */
export type ImageWorkspacePermissions = {
 chooseImages(mode:'files'|'folder'):Promise<ImageWorkspacePickedSources|null>;
 chooseExportTarget(input:{suggestedName:string;format:'psd'|'tiff'}):Promise<string|null>;
 trashItem(file:string):Promise<void>;
 chooseRecoveryInputTarget?(input:{suggestedName:string}):Promise<string|null>;
};
export type ImageWorkspaceRuntimeOptions = {
 root:string;binary:string;leaseBinary:string;workspaceEpoch:number;
 permissions:ImageWorkspacePermissions;
 projectRootLabel?:string;
 /** Synthetic failure injection, never renderer input. */
 fileFault?:(point:string)=>Promise<void>;outputFault?:(point:string)=>Promise<void>;
 /** nativeBytes funds the whole native Store; outputBytes bounds one export.
  * Sources/output/journal/lease use the shared maxRecoveryBytes actual+reserved
  * ledger. sourceBytes is retained for callers; it is not a cumulative quota. */
 limits?:{maxRecoveryBytes?:number;nativeBytes?:number;sourceBytes?:number;outputBytes?:number};
};
export type ImageWorkspaceRuntime = {
 open():ImageWorkspaceBootstrap;
 request(request:ImageWorkspaceRequest):Promise<ImageWorkspaceOutcome>;
 /** Main checks durable origin identity before a new begin. The receipt remains
  * bounded volatile admission; the preload/IPC Bridge preserves this Promise. */
 input(owner:ImageWorkspaceOwner,input:ImageWorkspaceInput,identity:ImageWorkspaceClientInput):Promise<ImagePipelineAdmission>;
 waitOperation(owner:ImageWorkspaceOwner,operationId:string):Promise<ImageWorkspaceOutcome>;
 subscribe(listener:(event:ImageWorkspaceEvent)=>void):()=>void;
 connectFrames(identity:ImageWorkspaceFrameIdentity,transport:ImageWorkspaceFrameTransport):Promise<void>;
 thumbnail(owner:ImageWorkspaceOwner,id:string):Promise<{width:number;height:number;rgba:Uint8Array}>;
 /** Read-only instrumentation, never a second transport or save authority. */
 onFrame(listener:(frame:NativeFrame)=>void):()=>void;
 /** Release only after a successful certifyClose; preparation failure leaves
  * the existing writable owner and its recovery obligations intact. */
 dispose():Promise<void>;
};
export type ImageWorkspaceTarget={kind:'native';root:string;runtime:ImageWorkspaceRuntime};

/** Read-only launcher probe. Acquiring the writable Runtime is a later step. */
export type ImageWorkspaceProjectPlan={kind:'native';root:string;identity:{id:string;name:string};format:'journal'};
