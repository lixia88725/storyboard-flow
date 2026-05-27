export type SketchTool = "brush" | "eraser";

export type SketchStroke = {
  id: string;
  tool: SketchTool;
  color: string;
  opacity?: number;
  size: number;
  points: number[];
};

export type Shot = {
  id: string;
  imagePath: string;
  previewPath?: string;
  fileName: string;
  sourceFileName?: string;
  order: number;
  sketchData: SketchStroke[];
};

export type Dialogue = {
  id: string;
  shotId: string;
  text: string;
  order: number;
};

export type Project = {
  id: string;
  name: string;
  shots: Shot[];
  dialogues: Dialogue[];
  createdAt: string;
  updatedAt: string;
};

export type ImportedImage = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
};

export type WorkspacePayload = {
  project: Project;
  folderPath: string;
  metadataPath: string;
};

export type FolderScanPayload = {
  folderPath: string;
  folderName: string;
  metadataPath: string;
  project?: Project;
  images: ImportedImage[];
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
