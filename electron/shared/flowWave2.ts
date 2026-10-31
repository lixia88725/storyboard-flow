/** Coordinator-owned first wave-2 implementation contract. No production IPC or TIFF yet.
 * Semantics and exclusions: docs/refactor/wave2/IMPLEMENTATION-1.md. */
import type { AssetIdV1, AssetReaderV1, CheckpointReceiptV1, CoreErrorCodeV1,
  DialogueV1, ImageDocumentV1, ImageEditV1, ProjectV1, ResultV1, ShotV1 } from './refactorV1.js';

export type FlowFailure = {
  code: CoreErrorCodeV1 | 'resource-limit' | 'unavailable' | 'busy' | 'closed';
  message: string;
  effect: 'none' | 'retained' | 'unknown';
};
export type FlowResult<T> = { ok: true; value: T } | { ok: false; error: FlowFailure };
export type FlowStroke = {
  tool: 'brush' | 'eraser'; color: string; size: number; opacity: number;
  softness: number; points: readonly number[];
};
export type FlowPixelInput = { image: ImageDocumentV1; layerId: string; stroke: FlowStroke };
export type FlowPixelOutput = { png: Uint8Array; width: number; height: number };
export type FlowPixels = {
  blank?(width: number, height: number, background?: 'white' | 'transparent'): Promise<FlowResult<FlowPixelOutput>>;
  produce(input: FlowPixelInput, readAsset: AssetReaderV1): Promise<FlowResult<FlowPixelOutput>>;
};
export type FlowPixelTool =
  | { kind: 'fill'; layerId: string; x: number; y: number; color: readonly [number, number, number, number]; tolerance: number }
  | { kind: 'clear'; layerId: string }
  | { kind: 'merge'; layerIds: readonly string[] };
export type FlowPixelToolRequest = FlowPixelTool & { image: ImageDocumentV1 };
export type FlowPixelToolOutput = { png: Uint8Array; width: number; height: number; baseline: ImageDocumentV1;
  plan: { kind: 'replace'; layerId: string } | { kind: 'merge'; targetId: string; removeIds: string[]; targetProperties: { opacity: 1; blendMode: 'normal' } } };
export type FlowPixelTools = { produce(input: FlowPixelToolRequest, readAsset: AssetReaderV1): Promise<FlowResult<FlowPixelToolOutput>> };
export type FlowPixelLimits = { maxPixels: number; maxPngBytes: number; maxPoints: number };
export type FlowAssetReceipt = {
  sessionId: string; operationId: string; assetId: AssetIdV1;
  width: number; height: number; byteLength: number; directorySync: 'synced' | 'skipped';
};
export type FlowAssetDepot = {
  put(input: { operationId: string; png: Uint8Array; width: number; height: number }): Promise<FlowResult<FlowAssetReceipt>>;
  read(assetId: AssetIdV1): Promise<FlowResult<Uint8Array>>;
};
export type FlowAssetDepotOptions = {
  root: string; sessionId: string; maxPixels: number; maxPngBytes: number;
};
export type FlowBoardCommand =
  /** Insert into active board after Session revalidates each referenced depot asset. */
  | { kind: 'insertShot'; shot: ShotV1; image: ImageDocumentV1; index: number }
  | { kind: 'setProjectNaming'; name: string; naming: NonNullable<ProjectV1['naming']> }
  | { kind: 'setScriptText'; shotId: string; text: string }
  | { kind: 'setDialogues'; shotId: string; dialogues: DialogueV1[] }
  /** Preserve board order of selection; omit beforeId to append. */
  | { kind: 'moveShots'; shotIds: string[]; destination: 'active' | 'pending'; beforeId?: string }
  | { kind: 'removeShots'; shotIds: string[] }
  /** Preserve existing dialogue order; beforeId is an unselected dialogue on the active target, or omit to append. */
  | { kind: 'moveDialogues'; dialogueIds: string[]; targetShotId: string; beforeId?: string };
export type FlowLayerEdit = Exclude<ImageEditV1, { kind: 'replacePixels' }>;
export type FlowSessionRequest =
  | { kind: 'newLayer'; shotId: string; layerId: string; afterId?: string }
  | { kind: 'newShot'; shotId: string; imageId: string; width: number; height: number; afterId?: string }
  | { kind: 'board'; command: FlowBoardCommand }
  | { kind: 'layer'; shotId: string; edit: FlowLayerEdit }
  | { kind: 'pixelTool'; shotId: string; tool: FlowPixelTool }
  | { kind: 'paint'; shotId: string; layerId: string; stroke: FlowStroke }
  | { kind: 'undo' | 'redo' | 'checkpoint' | 'freeze' | 'resume' | 'refresh' };
export type FlowCheckpointState = {
  sessionId: string; incarnation: string; revision: number;
  receipt: CheckpointReceiptV1;
};
export type FlowSessionSnapshot = {
  sessionId: string; incarnation: string; project: ProjectV1;
  phase: 'active' | 'freezing' | 'frozen'; pending: number;
  checkpoint: FlowCheckpointState | null; lastError: FlowFailure | null;
};
export type FlowSessionOutcome = { snapshot: FlowSessionSnapshot; changed: boolean };
export type FlowSession = {
  snapshot(): FlowSessionSnapshot;
  subscribe(listener: () => void): () => void;
  request(request: FlowSessionRequest): Promise<FlowResult<FlowSessionOutcome>>;
};
export type FlowClock = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};
export type FlowSessionOptions = {
  sessionId: string; incarnation: string; project: ProjectV1; maxHistoryEntries: number;
  maxPendingRequests: number; assets: FlowAssetDepot; pixels: FlowPixels; tools?: FlowPixelTools; clock: FlowClock;
  refresh?(project: ProjectV1): Promise<FlowResult<ProjectV1>>;
  checkpoint(project: ProjectV1, readAsset: AssetReaderV1): Promise<ResultV1<CheckpointReceiptV1>>;
};
