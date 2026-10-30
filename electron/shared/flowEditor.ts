import type { FlowAssetDepot } from './flowWave2.js';
import type { ProjectV1, ResultV1, CheckpointReceiptV1 } from './refactorV1.js';
/** Dedicated new-format editor capability. Root selection belongs to Main. */
export type FlowEditorBridge = FlowAssetDepot & {
  open(): Promise<{ project: ProjectV1; sessionId: string }>;
  checkpoint(project: ProjectV1): Promise<ResultV1<CheckpointReceiptV1>>;
  onClose(listener: (requestId: string) => void): () => void;
  finishClose(requestId: string, project: ProjectV1 | null): Promise<{ ok: boolean; message?: string }>;
};
