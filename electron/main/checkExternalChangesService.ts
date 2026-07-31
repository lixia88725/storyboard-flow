import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";

type CheckExternalChangesShot = {
  imagePath: string;
};

export type CheckExternalChangesProject = {
  shots: CheckExternalChangesShot[];
  parkedShots?: CheckExternalChangesShot[];
  pendingDeletedShots?: CheckExternalChangesShot[];
};

export type CheckExternalChangesPayload<TProject extends CheckExternalChangesProject> = {
  project: TProject;
  folderPath: string;
  metadataPath: string;
};

export type CheckExternalChangesImportedImage = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
  swbMetadata?: unknown;
};

export type CheckExternalChangesOptions<TProject extends CheckExternalChangesProject> = {
  changedKnownImagePaths: (
    project: TProject,
    imagePaths: string[],
    pendingDeletedPaths: Set<string>,
    onProgress?: WorkspaceTaskProgressReporter
  ) => Promise<string[]>;
  collectImagePaths: (folderPaths: string[]) => Promise<string[]>;
  createImageRecords: (
    imagePaths: string[],
    previewRoot: string,
    options?: {
      onProgress?: WorkspaceTaskProgressReporter;
      label?: string;
    }
  ) => Promise<CheckExternalChangesImportedImage[]>;
  ensureStoryboardScriptMarkdown: (
    folderPath: string,
    project: TProject
  ) => Promise<boolean>;
  previewRootForFolder: (folderPath: string) => string;
  reportProgress: WorkspaceTaskProgressReporter;
};

export const checkExternalChanges = async <TProject extends CheckExternalChangesProject>(
  payload: CheckExternalChangesPayload<TProject>,
  {
    changedKnownImagePaths,
    collectImagePaths,
    createImageRecords,
    ensureStoryboardScriptMarkdown,
    previewRootForFolder,
    reportProgress
  }: CheckExternalChangesOptions<TProject>
): Promise<{ images: CheckExternalChangesImportedImage[]; scriptImportNeeded: boolean }> => {
  const previewRoot = previewRootForFolder(payload.folderPath);
  reportProgress({ kind: "open", label: "Scanning folder...", current: 0, total: 0 });
  const imagePaths = await collectImagePaths([payload.folderPath]);
  reportProgress({
    kind: "open",
    label: "Checking external changes...",
    current: 0,
    total: imagePaths.length
  });
  const parkedShots =
    "parkedShots" in payload.project
      ? payload.project.parkedShots
      : undefined;
  const existingPaths = new Set([
    ...payload.project.shots.map((shot) => shot.imagePath),
    ...(parkedShots ?? []).map((shot) => shot.imagePath)
  ]);
  const pendingDeletedPaths = new Set(
    (payload.project.pendingDeletedShots ?? []).map((shot) => shot.imagePath)
  );
  const newImagePaths = imagePaths.filter(
    (imagePath) => !existingPaths.has(imagePath) && !pendingDeletedPaths.has(imagePath)
  );
  const knownChangedImagePaths = await changedKnownImagePaths(
    payload.project,
    [
      ...imagePaths,
      ...(parkedShots ?? [])
        .map((shot) => shot.imagePath)
        .filter((imagePath) => !imagePaths.includes(imagePath))
    ],
    pendingDeletedPaths,
    reportProgress
  );

  return {
    images: await createImageRecords([...newImagePaths, ...knownChangedImagePaths], previewRoot, {
      onProgress: reportProgress,
      label: "Preparing previews..."
    }),
    scriptImportNeeded: await ensureStoryboardScriptMarkdown(payload.folderPath, payload.project)
  };
};
