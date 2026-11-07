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
export type NativeDecision = {
  kind: 'image'; operationId: string; candidateId: string; imageId: string;
  expected: ImageBindingV2; baseNative: NativeImageRef | null; prepared: NativeImageRef;
};
export type ProjectCommitV2 = {
  schema: 'flow.project-commit'; version: 1; commitId: string;
  previousCommitHash: string | null; beforeRevision: number | null;
  after: ProjectV2; nativeDecision?: NativeDecision;
};
export type ProjectHeadV2 = {
  schema: 'flow.project-head'; version: 1; projectId: string; commitHash: string;
};
export type HydrationRecord = {
  schema: 'flow.image-hydration'; version: 1;
  source: SourceImageRef & { digest: string; byteLength: number };
  hostBuildDigest: string; optionsHash: string; native: NativeImageRef; operationId: string;
};
export type NativeSettlement = {
  schema: 'flow.native-settlement'; version: 1; commitHash: string;
  operationId: string; candidateId: string; native: NativeImageRef;
};
export type ImageOperationIntent = {
  schema:'flow.image-edit-intent';version:1;operationId:string;
  sessionId:string;incarnation:string;imageId:string;expected:ImageBindingV2;
  baseNative:NativeImageRef;stroke:FlowStroke;
};
export type ImageOperationResolution = {
  schema:'flow.image-edit-resolution';version:1;operationId:string;
  decision:'discarded'|'committed';commitHash:string|null;
};
export type ImageProjectEdit =
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
};
export type ImageProjectOutcome =
  | { kind: 'settled'; commitHash: string; snapshot: ImageProjectSnapshot }
  | { kind: 'settlementPending'; commitHash: string; operationId: string; snapshot: ImageProjectSnapshot }
  | { kind:'recoveryPending';operationId:string;snapshot:ImageProjectSnapshot }
  | { kind: 'rejected'; error: { code: string; message: string; effect: 'none' | 'retained' | 'unknown' } };
