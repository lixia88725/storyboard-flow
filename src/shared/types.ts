export type SketchTool = "brush" | "eraser" | "select" | "eyedropper";
export type StrokeTool = "brush" | "eraser";
export type BitmapSelectionMode = "lasso";
export type SketchBlendMode = "normal" | "multiply" | "screen";
export type BitmapBlendMode = "normal" | "multiply" | "screen";

export type SketchStroke = {
  id: string;
  tool: StrokeTool;
  color: string;
  opacity?: number;
  size: number;
  softness?: number;
  points: number[];
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

export type ShotSwbStatus =
  | "owned"
  | "non-swb"
  | "compatible-external-edit"
  | "incompatible-external-edit";

export type ShotSwbState = {
  version: number;
  status: ShotSwbStatus;
  canvasWidth: number;
  canvasHeight: number;
  baseFingerprint?: string;
  sourcePath?: string;
  archivePath?: string;
  statusMessage?: string;
  acceptedExternalEditAt?: string;
  sourceKind?: "photoshop-layered-tiff";
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
  swb?: ShotSwbState;
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

export type Project = {
  id: string;
  name: string;
  naming?: ProjectNaming;
  ai?: ProjectAiState;
  shots: Shot[];
  parkedShots?: Shot[];
  dialogues: Dialogue[];
  pendingDeletedShots?: PendingDeletedShot[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectAiState = {
  projectContext?: string;
  shotResourceExclusions?: Record<string, string[]>;
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
  swbMetadata?: SwbImageMetadata;
};

export type BlankShotPreset = "16:9" | "9:16" | "2.39:1" | "1.43:1";

export type BlankShotOptions = {
  preset: BlankShotPreset;
};

export type SwbImageMetadata = {
  app: "Storyboard Flow" | "Storyboard Workbench";
  format: "swb-tiff";
  version: number;
  projectId?: string;
  shotId: string;
  canvasWidth: number;
  canvasHeight: number;
  baseFingerprint: string;
  updatedAt: string;
  sourcePath?: string;
  archivePath?: string;
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

export type WorkspacePayload = {
  project: Project;
  folderPath: string;
  metadataPath: string;
  blankShotPreset?: BlankShotPreset;
  dirtyShotIds?: string[];
  preserveDirtyShotLayers?: boolean;
};

export type ImportSwbFormatPayload = WorkspacePayload;

export type FolderScanPayload = {
  folderPath: string;
  folderName: string;
  metadataPath: string;
  project?: Project;
  images: ImportedImage[];
  importWarnings?: string[];
  scriptImportNeeded?: boolean;
  preserveProjectWithoutImageMerge?: boolean;
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
