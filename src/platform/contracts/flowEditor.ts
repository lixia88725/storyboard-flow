import type { FlowAssetDepot, FlowResult } from './flowWave2.js';
import type { ProjectV1, ResultV1, CheckpointReceiptV1 } from './refactorV1.js';
/** Dedicated new-format editor capability. Root selection belongs to Main. */
export type FlowEditorBootstrap = { project: ProjectV1; sessionId: string };
export type FolderStatus = 'current' | 'pending' | 'external' | 'both' | 'missing' | 'unfinished' | TrashRecovery;
export type TrashRecovery = { kind: 'trash-recovery'; name: string; directory: string; state: 'restore' | 'retry' | 'inspect' };
export type FolderStatusRequest = { project: ProjectV1; inspectDisk: boolean };
export type FlowEditorBridge = {
  read(sessionId: string, id: string): ReturnType<FlowAssetDepot['read']>;
  put(sessionId: string, input: Parameters<FlowAssetDepot['put']>[0]): ReturnType<FlowAssetDepot['put']>;
  switchProject(sessionId: string, project: ProjectV1): Promise<FlowEditorBootstrap | null>;
  open(): Promise<{ project: ProjectV1; sessionId: string }>;
  refresh(sessionId:string,project:ProjectV1):Promise<FlowResult<ProjectV1>>;
  folderStatus(sessionId: string, request: FolderStatusRequest): Promise<FolderStatus>;
  /** Read-only bound filenames; the naming sheet uses them once so its sample equals Save. */
  outputNames(sessionId: string, project: ProjectV1): Promise<{ shotId: string; name: string }[]>;
  saveTiff(sessionId: string, project: ProjectV1): Promise<{ ok: true; value: { projectId: string; revision: number; projectHash: string } } | { ok: false; error: { message: string } }>;
  checkpoint(sessionId: string, project: ProjectV1): Promise<ResultV1<CheckpointReceiptV1>>;
  onClose(listener: (requestId: string) => void): () => void;
  finishClose(sessionId: string, requestId: string, project: ProjectV1 | null): Promise<{ ok: boolean; message?: string }>;
};
