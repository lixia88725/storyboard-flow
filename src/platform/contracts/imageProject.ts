import type { ImageEngineEdit } from './imageEngine.js';
import type { ChangeSetV1, ProjectV1 } from './refactorV1.js';
import type { FlowStroke } from './flowWave2.js';

/** These are content references, never native handles or user filesystem paths. */
export type NativeImageRef = {
  storeId: string; documentId: string; versionId: string; manifestSha256: string;
  width: number; height: number;
};
export type SourceImageRef = { importId: string; itemId: string; interpretationId: string };
export type ImageBindingV2 =
  | { kind: 'source'; source: SourceImageRef }
  | { kind: 'native'; native: NativeImageRef };
export type ProjectImageV2 = { id: string; content: ImageBindingV2 };
export type ProjectV2 = Omit<ProjectV1, 'version' | 'images'> & {
  version: 2; images: Record<string, ProjectImageV2>;
};

/** Main-private detached image creation, distinct from an edit to an existing document. */
export type NativeImageCreationInput={kind:'new';width:number;height:number}|{kind:'duplicate';source:NativeImageRef};
export type ImageCreationBatchIntent={
 schema:'flow.image-creation-batch';version:1;operationId:string;sessionId:string;incarnation:string;anchorCommitHash:string;
 items:readonly {candidateId:string;imageId:string;input:NativeImageCreationInput}[];
 placement:{shots:ProjectV2['shots'];dialogues:ProjectV2['dialogues'];destination:'active'|'pending';beforeId?:string};
};
export type ImageCreationBatchDecision={kind:'creation-batch';operationId:string;intentId:string;items:readonly{candidateId:string;imageId:string;native:NativeImageRef}[]};
export type NativeDecision = {
  kind: 'image'; operationId: string; candidateId: string; imageId: string;
  expected: ImageBindingV2; baseNative: NativeImageRef | null; prepared: NativeImageRef;
  pipeline?: {pipelineId:string;anchorCommitHash:string;predecessorOperationId:string|null};
};
export type ImageOperationDecision={commitHash:string;decision:NativeDecision;unchanged:boolean};
export type UnchangedImageDecision={schema:'flow.image-unchanged-decision';version:1;commitHash:string;decision:NativeDecision};
export type ProjectCommitV2 = {
  schema: 'flow.project-commit'; version: 1; commitId: string;
  previousCommitHash: string | null; beforeRevision: number | null;
  after: ProjectV2; nativeDecision?: NativeDecision;creationDecision?:ImageCreationBatchDecision;
};
export type ProjectHeadV2 = {
  schema: 'flow.project-head'; version: 1; projectId: string; commitHash: string;
};
export type HydrationRecord = {
  schema: 'flow.image-hydration'; version: 1;
  source: SourceImageRef & { digest: string; byteLength: number };
  hostBuildDigest: string; optionsHash: string; native: NativeImageRef; operationId: string;acceptance?:'detached';
};
export type NativeSettlement = {
  schema: 'flow.native-settlement'; version: 1; commitHash: string;
  operationId: string; candidateId: string; native: NativeImageRef;
};
export type SerialImageOperationIntent = {
  schema:'flow.image-edit-intent';version:1;operationId:string;
  sessionId:string;incarnation:string;imageId:string;expected:ImageBindingV2;
  baseNative:NativeImageRef;stroke:FlowStroke;
};
/** The pointer-down predecessor may not yet have a native version. Its immutable
 * anchor and original input survive independently of prepared/project settlement. */
export type PipelineImageOperationIntent = {
  schema:'flow.image-edit-intent';version:2;operationId:string;
  sessionId:string;incarnation:string;imageId:string;pipelineId:string;
  anchorCommitHash:string;anchor:NativeImageRef;expectedAtAnchor:ImageBindingV2;
  predecessorOperationId:string|null;inputThrough:number;stroke:FlowStroke;
};
export type ImageEditOperationIntent={
 schema:'flow.image-edit-intent';version:3;operationId:string;sessionId:string;incarnation:string;
 imageId:string;expected:ImageBindingV2;baseNative:NativeImageRef;contextGeneration:number;edit:ImageEngineEdit;
};
export type ImageOperationOrigin={
 workspaceEpoch:number;captureId:string;beginInputId:string;
 inputs:readonly {inputId:string;kind:'begin'|'append'|'end'|'cancel';fromSeq:number;throughSeq:number;sha256:string}[];
};
export type ImageOperationIntent = (SerialImageOperationIntent | PipelineImageOperationIntent | ImageEditOperationIntent)&{origin?:ImageOperationOrigin};
export type ImagePipelineInput =
  | {kind:'begin';shotId:string;stroke:FlowStroke}
  | {kind:'append';operationId:string;fromSeq:number;points:readonly number[];pressures?:readonly number[]}
  | {kind:'end';operationId:string;throughSeq:number}
  | {kind:'cancel';operationId:string};
/** Local capture acknowledgement only; neither native display nor crash durability. */
export type ImagePipelineAdmission =
  | {kind:'admitted';operationId:string;inputThrough:number;durable:false}
  | {kind:'rejected';error:{code:string;message:string;effect:'none'|'retained'|'unknown'}};
export type ImagePipelineProgress = {
  operationId:string;stage:'admitted'|'preview'|'intentDurable'|'queued'|'prepared'|'projectCommitted'|'nativeAccepted'|'cancelled'|'blocked';
  inputThrough:number;durable:boolean;commitHash?:string;
};
export type RetainedImageInput={operationId:string;shotId:string;imageId:string;stroke:FlowStroke;ended:boolean;reason:'missing-pipeline-identity'|'incomplete-gesture'};
export type ImageRecoveryDisposition={operationId:string;imageId:string;inputThrough:number;original:'durable-intent'|'recovery-only-record';recordId?:string;decision:'committed'|'notCommitted';commitHash:string|null};
export type ImageOperationPage={afterOperationId?:string;maxRecords?:number};
export type ImageOperationRecord={intent:ImageOperationIntent;resolution:ImageOperationResolution|null};
export type ImageOperationResolution = {
  schema:'flow.image-edit-resolution';version:1;operationId:string;
  decision:'discarded'|'committed';commitHash:string|null;
};
export type ImageProjectEdit =
  | { kind:'setProjectNaming';name:string;naming:NonNullable<ProjectV2['naming']> }
  | { kind:'setPresentation';presentation:NonNullable<ProjectV2['presentation']>|null }
  | { kind:'removeShots';shotIds:string[] }
  | { kind:'moveDialogues';dialogueIds:string[];targetShotId:string;beforeId?:string }
  /** Main-private insertion of already retained/prepared references. The public
   * workspace command never accepts these references or whole project trees. */
  | { kind:'appendShots';shots:ProjectV2['shots'];images:ProjectV2['images'];dialogues?:ProjectV2['dialogues'];destination:'active'|'pending';beforeId?:string }
  | { kind: 'setDialogues'; shotId: string; dialogues: ProjectV2['dialogues'] }
  | { kind: 'setScriptText'; shotId: string; text: string }
  | { kind: 'moveShots'; shotIds: string[]; destination: 'active' | 'pending'; beforeId?: string }
  | { kind: 'installNativeImage'; imageId: string; expected: ImageBindingV2; next: NativeImageRef };
export type ImageProjectEditResult = { before: ProjectV2; after: ProjectV2; changed: boolean; changes: ChangeSetV1 };
export type ImageProjectSnapshot = {
  sessionId: string; incarnation: string; eventSeq: number; project: ProjectV2;
  phase: 'active' | 'recovering' | 'freezing' | 'frozen';
  pending: number; undoDepth: number; redoDepth: number;
  recovery?: { operationId: string; commitHash: string|null; target?:NativeImageRef };
  recoveryOutcomes?:ImageRecoveryDisposition[];
};
export type ImageProjectOutcome =
  | { kind: 'settled'; commitHash: string; snapshot: ImageProjectSnapshot }
  | { kind: 'settlementPending'; commitHash: string; operationId: string; snapshot: ImageProjectSnapshot }
  | { kind:'recoveryPending';operationId:string;snapshot:ImageProjectSnapshot;retainedInputs?:RetainedImageInput[];reconciled?:ImageRecoveryDisposition[] }
  | {kind:'recovered';commitHash:string;snapshot:ImageProjectSnapshot;operations:ImageRecoveryDisposition[]}
  | { kind: 'rejected'; error: { code: string; message: string; effect: 'none' | 'retained' | 'unknown' } };
