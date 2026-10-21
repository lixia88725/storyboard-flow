import {
  checkExternalChanges,
  type CheckExternalChangesOptions,
  type CheckExternalChangesProject
} from "./checkExternalChangesService.js";
import { collectImagePaths } from "./imageDiscoveryService.js";
import { previewRootForFolder } from "./previewPaths.js";
import type { WorkspaceExternalChangesIpcHandlers } from "./ipc/workspaceExternalChangesHandlers.js";
import {
  createWorkspaceTaskProgressReporter,
  type WorkspaceTaskProgressReporter,
  type WorkspaceTaskProgressSender
} from "./workspaceTaskProgress.js";

type CheckExternalChangesPayload<TProject extends CheckExternalChangesProject> = {
  project: TProject;
  folderPath: string;
  metadataPath: string;
  normalSave?: boolean;
};

export type WorkspaceExternalChangesAppRuntimeOptions<
  TProject extends CheckExternalChangesProject
> = {
  changedKnownImagePaths: CheckExternalChangesOptions<TProject>["changedKnownImagePaths"];
  collectImagePaths?: CheckExternalChangesOptions<TProject>["collectImagePaths"];
  createImageRecords: CheckExternalChangesOptions<TProject>["createImageRecords"];
  createProgressReporter?: (
    sender: WorkspaceTaskProgressSender,
    mode: "open"
  ) => WorkspaceTaskProgressReporter;
  ensureStoryboardScriptMarkdown: CheckExternalChangesOptions<TProject>["ensureStoryboardScriptMarkdown"];
  readStoryboardScriptImportState?: CheckExternalChangesOptions<TProject>["ensureStoryboardScriptMarkdown"];
  previewRootForFolder?: CheckExternalChangesOptions<TProject>["previewRootForFolder"];
};

export const createWorkspaceExternalChangesAppHandlers = <
  TProject extends CheckExternalChangesProject
>({
  changedKnownImagePaths,
  collectImagePaths: collectImagePathsDependency = collectImagePaths,
  createImageRecords,
  createProgressReporter = createWorkspaceTaskProgressReporter,
  ensureStoryboardScriptMarkdown,
  readStoryboardScriptImportState = async () => true,
  previewRootForFolder: previewRootForFolderDependency = previewRootForFolder
}: WorkspaceExternalChangesAppRuntimeOptions<TProject>): WorkspaceExternalChangesIpcHandlers<
  WorkspaceTaskProgressSender,
  WorkspaceTaskProgressReporter,
  CheckExternalChangesPayload<TProject>
> => ({
  createProgressReporter,
  checkExternalChanges: (payload, { reportProgress }) =>
    checkExternalChanges(payload, {
      changedKnownImagePaths,
      collectImagePaths: collectImagePathsDependency,
      createImageRecords,
      ensureStoryboardScriptMarkdown: payload.normalSave ? readStoryboardScriptImportState : ensureStoryboardScriptMarkdown,
      previewRootForFolder: previewRootForFolderDependency,
      reportProgress
    })
});
