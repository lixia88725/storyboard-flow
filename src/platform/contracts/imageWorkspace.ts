import type { ImageEngineEdit, ImageEnginePreviewStamp } from './imageEngine.js';
import type { FrameIdentity, ImageFrameHeader, FrameFailureCode } from '../../drawing/renderer/image-engine/frames.js';
import type { DialogueV1, ProjectNamingV1 } from './refactorV1.js';
import type { FlowPresentation } from './flowPresentation.js';
import type { FlowSelection } from './flowSelection.js';
import type { FlowStroke } from './flowWave2.js';
import type { ImageBindingV2, ImagePipelineAdmission, ImagePipelineInput, ImagePipelineProgress, ImageProjectSnapshot, NativeImageRef, RetainedImageInput } from './imageProject.js';

/** Main mints all owner fields. A project ID is never a writable capability. */
export type ImageWorkspaceOwner = { sessionId:string;incarnation:string;workspaceEpoch:number };
export type ImageWorkspaceLayerId = string; // Opaque native ID, never a JS u64 number.
export type ImageWorkspaceAvailability = 'queued'|'retaining'|'retained'|'hydrating'|'editable'|'reference'|'unavailable'|'recoveryPending';
/** Read-only projection. No PNG assetId and no renderer-authored document tree. */
export type ImageWorkspaceLayerView = {
 readonly id:ImageWorkspaceLayerId;readonly parentId:ImageWorkspaceLayerId|null;
 readonly name:string;readonly kind:'raster'|'group'|'reference'|'unsupported';
 readonly visible:boolean;readonly locked:boolean;readonly opacity:number;
 readonly blendMode:string;
 /** Paint alias retained for UI adoption; never means property/structure access. */
 readonly editable:boolean;
 readonly capabilities:{readonly paint:boolean;readonly properties:boolean;readonly structure:boolean};
 readonly readOnlyReason?:string;
};
export type ImageWorkspaceImageView = {
 readonly imageId:string;readonly content:ImageBindingV2;
 readonly availability:ImageWorkspaceAvailability;
 /** Derived from the retained hydration/native view, including SourceRef content. */
 readonly displayDocumentId:string|null;
 readonly displayNative:NativeImageRef|null;
 /** Exact comparable display epoch; null during activation, never guessed. */
 readonly displayIdentity:FrameIdentity|null;
 readonly width?:number;readonly height?:number;
 /** Bottom to top; parentId expresses groups without a writable UI tree. */
 readonly layers:readonly ImageWorkspaceLayerView[];
 readonly activeLayerId:ImageWorkspaceLayerId|null;
 readonly contextGeneration:number|null;
 readonly thumbnailId?:string; // Session-bound read-only display capability.
 readonly issue?:{readonly code:string;readonly message:string};
};
export type ImageWorkspaceContext = {
 shotId:string|null;imageId:string|null;layerId:ImageWorkspaceLayerId|null;
 generation:number|null;selection:FlowSelection|null;
 floating:null|{previewId:string;inputThrough:number;offset:{x:number;y:number}};
};
export type ImageWorkspaceFolderStatus = 'current'|'pending'|'external'|'both'|'missing'|'unfinished'|'trash-recovery';
export type ImageWorkspaceFileState = {
 /** Display labels only. Main owns every writable root and bound output path. */
 projectRootLabel:string;folderName:string;status:ImageWorkspaceFolderStatus;
 savedRevision:number|null;outputPending:boolean;
 outputNames:readonly {shotId:string;name:string}[];
 recovery?:{id:string;name:string;state:'restore'|'retry'|'inspect'};
};
export type ImageWorkspaceSnapshot = {
 owner:ImageWorkspaceOwner;stateSeq:number;session:ImageProjectSnapshot;
 context:ImageWorkspaceContext;images:Readonly<Record<string,ImageWorkspaceImageView>>;
 files:ImageWorkspaceFileState;
};
export type ImageWorkspaceBoardCommand =
 | {kind:'newShot';width:number;height:number;afterId?:string}
 | {kind:'duplicateShots';shotIds:readonly string[];destination:'active'|'pending';beforeId?:string}
 | {kind:'removeShots';shotIds:readonly string[]}
 | {kind:'moveShots';shotIds:readonly string[];destination:'active'|'pending';beforeId?:string}
 | {kind:'setProjectNaming';name:string;naming:ProjectNamingV1}
 | {kind:'setPresentation';presentation:FlowPresentation|null}
 | {kind:'setScriptText';shotId:string;text:string;typingGroup?:string}
 | {kind:'setDialogues';shotId:string;dialogues:readonly DialogueV1[];typingGroup?:string}
 | {kind:'moveDialogues';dialogueIds:readonly string[];targetShotId:string;beforeId?:string};
/** Product intent. The native Adapter supplies operation IDs/base versions and
 * translates these into the typed host protocol; arbitrary host JSON is absent. */
export type ImageWorkspaceEdit = ImageEngineEdit;
export type ImageWorkspaceCommand =
 | {kind:'board';command:ImageWorkspaceBoardCommand}
 | {kind:'activateShot';shotId:string}
 | {kind:'demandShots';shotIds:readonly string[]}
 | {kind:'inspectCapture';captureId:string}
 | {kind:'resolveInput';captureId:string;action:'retainAndDiscard'|'exportAndDiscard';original:ImageWorkspaceCapturedInput}
 | {kind:'selectLayer';shotId:string;layerId:ImageWorkspaceLayerId;expectedContextGeneration:number}
 | {kind:'selection';shotId:string;expectedContextGeneration:number;selection:FlowSelection|null}
 | {kind:'imageEdit';shotId:string;expectedContextGeneration:number;expectedNative:NativeImageRef;edit:ImageWorkspaceEdit;preview?:ImageEnginePreviewStamp}
 | {kind:'floating';shotId:string;expectedContextGeneration:number;previewId:string;action:
     {kind:'begin';dx:number;dy:number}|{kind:'move';fromSeq:number;dx:number;dy:number}|{kind:'cancel'|'drop';throughSeq:number}}
 | {kind:'addImages';mode:'files'|'folder';destination:'pending'}
 | {kind:'resumeImport';importId:string}
 | {kind:'pauseImport';importId:string}
 | {kind:'undo'|'redo'|'recover'|'save'|'refresh'}
 | {kind:'export';shotId:string;format:'psd'|'tiff'}
 | {kind:'inspectFolder'}
 | {kind:'prepareClose'}
 | {kind:'certifyClose';ticket:string}
 | {kind:'resume';ticket:string};
export type ImageWorkspaceFailure = {code:string;message:string;effect:'none'|'retained'|'unknown'};
export type ImageWorkspaceOutcome =
 | {kind:'settled'|'recovered';snapshot:ImageWorkspaceSnapshot;operationId:string;createdShotIds?:readonly string[];outputs?:readonly ImageWorkspaceOutputReceipt[]}
 | {kind:'closePrepared';snapshot:ImageWorkspaceSnapshot;operationId:string;ticket:string}
 | {kind:'closed';operationId:string;ticket:string}
 | {kind:'canceled';operationId:string}
 | {kind:'captureStatus';operationId:string;captureId:string;state:'absent'|'admitted'|'recovering'|'resolved';mainOperationId:string|null;inputThrough:number}
 | {kind:'inputResolved';operationId:string;captureId:string;snapshot:ImageWorkspaceSnapshot;
     operation:{operationId:string;decision:'committed'|'notCommitted';inputThrough:number}|null;
     original:{recordId:string;capturedThrough:number}}
 | {kind:'settlementPending'|'recoveryPending';snapshot:ImageWorkspaceSnapshot;operationId:string;commitHash:string|null;retainedInputs?:readonly RetainedImageInput[]}
 | {kind:'rejected';operationId:string;error:ImageWorkspaceFailure};
export type ImageWorkspaceRequest = {owner:ImageWorkspaceOwner;requestId:string;command:ImageWorkspaceCommand};
/** captureId names the whole renderer gesture; inputId names one logical batch;
 * a known effect:none backpressure retry gets a new attemptId. Unknown delivery
 * is queried by captureId/inputId and is never blindly sent a second time. */
export type ImageWorkspaceClientInput={captureId:string;inputId:string;attemptId:string};
export type ImageWorkspaceCapturedInput={
 originOwner:ImageWorkspaceOwner;shotId:string;layerId:ImageWorkspaceLayerId|null;
 stroke:FlowStroke;ended:boolean;capturedThrough:number;
 /** Recovery-only original coordinates. Never execute this object directly. */
 coordinateSpace:'pixels'|'normalized';resolvedDimensions?:{width:number;height:number};
};
export type ImageWorkspaceInput =
 | {kind:'begin';shotId:string;layerId:ImageWorkspaceLayerId;expectedContextGeneration:number;stroke:FlowStroke}
 | Exclude<ImagePipelineInput,{kind:'begin'}>;
export type ImageWorkspaceCapabilities = {
 commands:readonly ImageWorkspaceCommand['kind'][];
 imageEdits:readonly ImageWorkspaceEdit['kind'][];
 brushTips:readonly ('hard'|'soft'|'pencil'|'charcoal')[];
};
export type ImageWorkspaceFrameIdentity = {owner:ImageWorkspaceOwner;nonce:string;streamGeneration:number};
export type ImageWorkspaceBootstrap = {snapshot:ImageWorkspaceSnapshot;capabilities:ImageWorkspaceCapabilities;frames:ImageWorkspaceFrameIdentity};
export type ImageWorkspaceEvent =
 | {kind:'snapshot';snapshot:ImageWorkspaceSnapshot}
 | {kind:'pipeline';owner:ImageWorkspaceOwner;progress:ImagePipelineProgress}
 | {kind:'import';owner:ImageWorkspaceOwner;importId:string;done:number;total:number;phase:'queued'|'retaining'|'hydrating'|'paused'|'complete'|'failed'}
 | {kind:'frameStream';identity:ImageWorkspaceFrameIdentity}
 | {kind:'fault';owner:ImageWorkspaceOwner;error:ImageWorkspaceFailure};
/** Every port message is bound to one owner, nonce and delivery generation.
 * Replacing a port increments streamGeneration and changes nonce; old messages
 * cannot acknowledge the new stream. Native identity changes on a live port use
 * reset -> successful ack -> full keyframe. Never drop a patch and continue its
 * dependent patch chain: a gap requires an explicit new keyframe.
 */
export type ImageWorkspaceFrameEnvelope=ImageWorkspaceFrameIdentity & {id:string};
export type ImageWorkspaceFrameMessage=ImageWorkspaceFrameEnvelope & (
 | {kind:'initialize'|'reset';identity:FrameIdentity}
 | {kind:'frame';header:ImageFrameHeader;pixels:Uint8Array}
);
export type ImageWorkspaceFrameReply=ImageWorkspaceFrameIdentity & (
 | {kind:'ready'}
 | {kind:'ack';id:string;result:{ok:true}|{ok:false;code:FrameFailureCode;message:string};installed?:{frameSeq:number;inputThrough:number}}
);
/** A read-only pixel/display port, bound to this exact owner+nonce. The existing
 * frame protocol still validates session/document/worker/epoch/frame sequence.
 * Port receipt is not a durable edit or a physical-screen acknowledgement. */
export type ImageWorkspaceFramePort = ImageWorkspaceFrameIdentity & {port:MessagePort};
export type ImageWorkspaceBridge = {
 bootstrap():Promise<ImageWorkspaceBootstrap>;
 request(request:ImageWorkspaceRequest):Promise<ImageWorkspaceOutcome>;
 /** This crosses Electron. Renderer capture before this Promise resolves is
  * separately volatile and is never called a synchronous Main admission. */
 input(owner:ImageWorkspaceOwner,input:ImageWorkspaceInput,identity:ImageWorkspaceClientInput):Promise<ImagePipelineAdmission>;
 waitOperation(owner:ImageWorkspaceOwner,operationId:string):Promise<ImageWorkspaceOutcome>;
 subscribe(listener:(event:ImageWorkspaceEvent)=>void):()=>void;
 connectFrames(identity:ImageWorkspaceFrameIdentity):Promise<void>;
 onFramePort(listener:(attachment:ImageWorkspaceFramePort)=>void):()=>void;
 /** At most 512x512 straight RGBA8; no decoding of the whole project on request. */
 thumbnail(owner:ImageWorkspaceOwner,id:string):Promise<{width:number;height:number;rgba:Uint8Array}>;
};
/** Immutable receipt for a particular content version; no renderer path. */
export type ImageWorkspaceOutputReceipt={operationId:string;projectId:string;revision:number;imageId:string;native:NativeImageRef;format:'psd'|'tiff';sha256:string;name:string};

/** Launcher result is explicitly native; never substitute this for the old V1 bootstrap. */
export type ImageWorkspaceLaunchResult={canceled:true}|{canceled:false;kind:'native';bootstrap:ImageWorkspaceBootstrap};
export type ImageWorkspaceUpgradeDraft={
 id:string;kind:'copy-upgrade';sourceLabel:string;destinationLabel:string|null;folderName:string;
 state:'chooseDestination'|'ready'|'running'|'retained';
 projectName:string;activeBoards:number;pendingBoards:number;originalPreserved:true;
 issues:readonly {code:string;message:string}[];
};

export type ImageWorkspaceProjectTarget={kind:'pending'}|{kind:'recent';id:string}|{kind:'create'|'upgrade';draftId:string};
export type ImageWorkspaceUpgradePatch={projectName?:string;folderName?:string};
export type ImageWorkspaceOpenChoice=
 | {canceled:true}
 | {kind:'project'}
 | {kind:'import';draft:import('./flowEditor.js').FlowCreateDraftView}
 | {kind:'copy-upgrade';draft:ImageWorkspaceUpgradeDraft};
