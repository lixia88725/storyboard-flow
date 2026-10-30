/** Wave-1 coordinator-owned contracts. Candidate format; no production routing yet.
 * Both compiler targets can import this dependency-free file. See docs/refactor/CONTRACTS.md.
 */
export type BlendModeV1 = 'normal' | 'multiply' | 'screen';
export type AssetIdV1 = string;
export type LayerV1 = {
  id: string;
  name: string;
  kind: 'image' | 'paint';
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendModeV1;
  width: number;
  height: number;
  assetId: AssetIdV1;
};
export type ImageDocumentV1 = {
  id: string;
  revision: number;
  width: number;
  height: number;
  /** Bottom to top. Array order is authoritative. */
  layers: LayerV1[];
};
export type ShotV1 = {
  id: string;
  imageId: string;
  name: string;
  scriptText: string;
};
export type DialogueV1 = { id: string; shotId: string; text: string };
export type ProjectV1 = {
  schema: 'storyboard-flow.project';
  version: 1;
  id: string;
  revision: number;
  name: string;
  shots: ShotV1[];
  parkedShots: ShotV1[];
  dialogues: DialogueV1[];
  images: Record<string, ImageDocumentV1>;
};
export type ChangeSetV1 = {
  /** Includes layer compositing-property changes, not only pixel bytes. */
  imageIds: string[];
  shotIds: string[];
  text: boolean;
  order: boolean;
  membership: boolean;
};
export type ImageEditV1 =
  | { kind: 'insertLayer'; layer: LayerV1; index: number }
  | { kind: 'removeLayer'; layerId: string }
  | { kind: 'moveLayer'; layerId: string; index: number }
  | { kind: 'setLayer'; layerId: string; patch: Partial<Pick<LayerV1, 'name' | 'visible' | 'locked' | 'opacity' | 'blendMode'>> }
  | { kind: 'replacePixels'; layerId: string; assetId: AssetIdV1 };
export type ImageEditResultV1 = { before: ImageDocumentV1; after: ImageDocumentV1; changed: boolean; visualChanged: boolean };
export type StoryboardEditV1 =
  | { kind: 'insertShot'; shot: ShotV1; image: ImageDocumentV1; index: number }
  | { kind: 'moveShots'; shotIds: string[]; destination: 'active' | 'pending'; beforeId?: string }
  | { kind: 'removeShots'; shotIds: string[] }
  | { kind: 'setScriptText'; shotId: string; text: string }
  | { kind: 'setDialogues'; shotId: string; dialogues: DialogueV1[] }
  /** Move selected dialogues in their existing order to an active target, before an unselected target dialogue or at its end. */
  | { kind: 'moveDialogues'; dialogueIds: string[]; targetShotId: string; beforeId?: string }
  | { kind: 'applyImageEdit'; result: ImageEditResultV1 };
export type ProjectEditResultV1 = { before: ProjectV1; after: ProjectV1; changed: boolean; changes: ChangeSetV1 };
export type CoreErrorCodeV1 = 'invalid-input' | 'not-found' | 'locked' | 'conflict' | 'unsupported-version' | 'missing-asset' | 'io-failure';
export type CoreFailureV1 = { code: CoreErrorCodeV1; message: string };
export type ResultV1<T> = { ok: true; value: T } | { ok: false; error: CoreFailureV1 };
export type AssetReaderV1 = (id: AssetIdV1) => Promise<Uint8Array>;
export type CheckpointReceiptV1 = { projectId: string; revision: number; manifestPath: string };
export type LoadedCheckpointV1 = { project: ProjectV1; readAsset: AssetReaderV1 };
export type ProjectStoreV1 = {
  saveCheckpoint(root: string, project: ProjectV1, readAsset: AssetReaderV1): Promise<ResultV1<CheckpointReceiptV1>>;
  loadCheckpoint(root: string): Promise<ResultV1<LoadedCheckpointV1>>;
};
