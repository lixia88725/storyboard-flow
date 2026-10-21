import path from "node:path";
import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";

export type FolderScanResult<Project, ImportedImage> = {
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

export type FolderScanServiceOptions<Project, ImportedImage> = {
  collectImagePaths: (folderPaths: string[]) => Promise<string[]>;
  createImageRecords: (
    imagePaths: string[],
    previewRoot: string,
    options?: {
      onProgress?: WorkspaceTaskProgressReporter;
      label?: string;
      readOnly?: boolean;
      deferMissingPreviews?: boolean;
    }
  ) => Promise<ImportedImage[]>;
  ensureStoryboardScriptMarkdown: (
    folderPath: string,
    project: Project | undefined,
    readOnly?: boolean
  ) => Promise<boolean>;
  metadataPathForFolder: (folderPath: string) => string;
  previewRootForFolder: (folderPath: string) => string;
  readProject: (metadataPath: string) => Promise<Project | undefined>;
};

export const scanWorkspaceFolder = async <Project, ImportedImage>(
  folderPath: string,
  onProgress: WorkspaceTaskProgressReporter | undefined,
  {
    collectImagePaths,
    createImageRecords,
    ensureStoryboardScriptMarkdown,
    metadataPathForFolder,
    previewRootForFolder,
    readProject
  }: FolderScanServiceOptions<Project, ImportedImage>,
  readOnly = false,
  deferMissingPreviews = false
): Promise<FolderScanResult<Project, ImportedImage>> => {
  const metadataPath = metadataPathForFolder(folderPath);
  const previewRoot = previewRootForFolder(folderPath);
  const project = await readProject(metadataPath);

  if (project) {
    onProgress?.({ kind: "open", label: "Loading storyboard...", current: 0, total: 0 });
    return {
      folderPath,
      folderName: path.basename(folderPath),
      metadataPath,
      project,
      images: [],
      scriptImportNeeded: await (readOnly ? ensureStoryboardScriptMarkdown(folderPath, project, true) : ensureStoryboardScriptMarkdown(folderPath, project)),
      preserveProjectWithoutImageMerge: true
    };
  }

  onProgress?.({ kind: "open", label: "Scanning folder...", current: 0, total: 0 });
  const imagePaths = await collectImagePaths([folderPath]);
  onProgress?.({
    kind: "open",
    label: "Preparing previews...",
    current: 0,
    total: imagePaths.length
  });

  return {
    folderPath,
    folderName: path.basename(folderPath),
    metadataPath,
    project,
    images: await createImageRecords(imagePaths, previewRoot, {
      onProgress,
      label: "Preparing previews...",
      ...(readOnly ? { readOnly: true } : {}),
      ...(deferMissingPreviews ? { deferMissingPreviews: true } : {})
    }),
    scriptImportNeeded: await (readOnly ? ensureStoryboardScriptMarkdown(folderPath, project, true) : ensureStoryboardScriptMarkdown(folderPath, project))
  };
};
