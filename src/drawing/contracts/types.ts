export type SketchTool = "brush" | "eraser" | "select" | "blur" | "eyedropper";
export type StrokeTool = "brush" | "eraser";
export type BitmapSelectionMode = "lasso";
export type SketchBlendMode = "normal" | "multiply" | "screen";
export type BitmapBlendMode = "normal" | "multiply" | "screen";

/** Brush tip plus dynamics carried by one stroke. Contracts own the shape; the renderer owns the pixels. */
export type StrokeBrush = {
  tip: "hard" | "soft" | "pencil" | "charcoal";
  /** Dab spacing as a fraction of the dab size. */
  spacing: number;
  hardness: number;
  grain: number;
  seed: number;
  pressureSize: number;
  pressureOpacity: number;
};

export type SketchStroke = {
  id: string;
  tool: StrokeTool;
  color: string;
  opacity?: number;
  size: number;
  softness?: number;
  points: number[];
  /** Present when the stroke was drawn with a preset tip; absent strokes keep the legacy path. */
  brush?: StrokeBrush;
  /** One sample per point pair. Missing entries mean full pressure (mouse). */
  pressures?: number[];
};

export type SketchLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: SketchBlendMode;
  order: number;
  strokes: SketchStroke[];
};

export type BitmapLayer = {
  sourceReference?: import('../../platform/contracts/flowSourceReference').FlowSourceReference;
  id: string;
  kind: "image" | "paint";
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BitmapBlendMode;
  order: number;
  bitmapPath: string;
  width: number;
  height: number;
  cleared?: boolean;
};

export type ShotFlowStatus =
  | "owned"
  | "non-flow"
  | "compatible-external-edit"
  | "incompatible-external-edit";

export type ShotFlowState = {
  version: number;
  status: ShotFlowStatus;
  canvasWidth: number;
  canvasHeight: number;
  baseFingerprint?: string;
  sourcePath?: string;
  archivePath?: string;
  statusMessage?: string;
  acceptedExternalEditAt?: string;
  sourceKind?: "photoshop-layered-tiff";
};

export type ShotMatte = {
  mode: "expanded" | "embedded";
  top: number;
  bottom: number;
  sourceHeight?: number;
};

export type ShotPresentation = {
  matte?: ShotMatte;
};

export type Shot = {
  id: string;
  imagePath: string;
  previewPath?: string;
  fileName: string;
  sourceFileName?: string;
  order: number;
  scriptText?: string;
  layers?: BitmapLayer[];
  activeLayerId?: string;
  sketchLayers?: SketchLayer[];
  activeSketchLayerId?: string;
  activeLayerTarget?: "image" | "sketch";
  imageLayerEdits?: SketchStroke[];
  baseVisible?: boolean;
  flow?: ShotFlowState;
  presentation?: ShotPresentation;
};

export type Dialogue = {
  id: string;
  shotId: string;
  text: string;
  order: number;
};

export type PendingDeletedShot = {
  id: string;
  imagePath: string;
  fileName: string;
};

export type PendingBakeShot = {
  state: "pending" | "synced" | "unknown";
  editToken?: string;
  acceptedOutputIdentity?: string;
};

export type PendingBake = { version: 1; shots: Record<string, PendingBakeShot> };

export type Project = {
  pendingBake?: PendingBake;
  id: string;
  name: string;
  naming?: ProjectNaming;
  shots: Shot[];
  parkedShots?: Shot[];
  dialogues: Dialogue[];
  pendingDeletedShots?: PendingDeletedShot[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectNaming = {
  sceneCode: string;
  artistName: string;
  version: string;
};

export type ImportedImage = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
  flowMetadata?: FlowImageMetadata;
};

export type BlankShotPreset = "16:9" | "1.85:1" | "9:16" | "2.39:1" | "1.43:1";

export type BlankShotOptions = {
  preset: BlankShotPreset;
};

export type FlowImageMetadata = {
  app: "Storyboard Flow";
  format: "flow-tiff";
  version: number;
  projectId?: string;
  shotId: string;
  canvasWidth: number;
  canvasHeight: number;
  baseFingerprint: string;
  updatedAt: string;
  sourcePath?: string;
  archivePath?: string;
  presentation?: ShotPresentation;
  imageLayerEdits?: SketchStroke[];
  sketchLayers?: SketchLayer[];
  layers: Array<{
    id: string;
    kind?: "image" | "paint";
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    blendMode?: SketchBlendMode;
    order: number;
    bitmapPath?: string;
    width?: number;
    height?: number;
    strokeCount: number;
  }>;
};

export type { NormalSaveOutputAck } from "../../project-files/contracts/normalSaveTransport";
export type SaveWorkspacePayload = WorkspacePayload & import("../../project-files/contracts/normalSaveTransport").NormalSaveTransport & { renamePlan?: RenamePlanItem[] };

export type WorkspacePayload = {
  recoveryContent?: unknown;
  ordinaryPersistenceNonce?: string;
  recoverySaveNonce?: string;
  normalSaveScriptInput?: string;
  normalSaveScriptExpectedInput?: string | null;
  normalSave?: boolean;
  project: Project;
  folderPath: string;
  metadataPath: string;
  blankShotPreset?: BlankShotPreset;
  dirtyShotIds?: string[];
  preserveDirtyShotLayers?: boolean;
};

export type ImportFlowFormatPayload = WorkspacePayload & import("../../project-files/contracts/normalSaveTransport").NormalSaveTransport;

export type RecoveryHistoryEntry = { project: Project; selectedShotIds: string[]; fileNameSyncState: 'synced' | 'unsynced'; layerAssets?: { bitmapPath: string; dataUrl?: string }[] };
export type FolderScanPayload = import("../../project-files/contracts/normalSaveTransport").NormalSaveTransport & {
  // Inert private stacks returned only by Main's native-certified cold reader.
  recoveryHistory?: { undo: RecoveryHistoryEntry[]; redo: RecoveryHistoryEntry[] };
  folderPath: string;
  folderName: string;
  metadataPath: string;
  project?: Project;
  images: ImportedImage[];
  importWarnings?: string[];
  scriptImportNeeded?: boolean;
  preserveProjectWithoutImageMerge?: boolean;
  normalSaveOpenRecoveryRequired?: string;
};

export type RenamePlanItem = {
  shotId: string;
  fromPath: string;
  temporaryPath: string;
  finalPath: string;
  finalFileName: string;
};

export type RenamePreflightIssue = {
  path: string;
  reason: "final-exists" | "temporary-exists";
  message: string;
};

export type RenamePreflightResult = {
  ok: boolean;
  issues: RenamePreflightIssue[];
};
