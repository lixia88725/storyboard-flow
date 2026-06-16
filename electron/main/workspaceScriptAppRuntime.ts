import type { WorkspaceScriptIpcHandlers } from "./ipc/workspaceScriptHandlers.js";

type ProjectPayloadLike<Project> = {
  folderPath: string;
  project: Project;
};

type FolderScanLike = {
  folderPath: string;
};

export type WorkspaceScriptAppRuntimeOptions<
  ProjectPayload extends ProjectPayloadLike<unknown>,
  CreatePayload,
  FolderScan extends FolderScanLike
> = {
  addRecentFolder: (folderPath: string) => unknown;
  createFromStoryboardScript: (payload: CreatePayload) => Promise<FolderScan>;
  ensureStoryboardScriptMarkdown: (
    folderPath: string,
    project: ProjectPayload["project"]
  ) => unknown;
  inspectStoryboardScript: (sourceMarkdownPath: string) => unknown;
};

export const createWorkspaceScriptAppHandlers = <
  ProjectPayload extends ProjectPayloadLike<unknown>,
  CreatePayload,
  FolderScan extends FolderScanLike
>({
  addRecentFolder,
  createFromStoryboardScript,
  ensureStoryboardScriptMarkdown,
  inspectStoryboardScript
}: WorkspaceScriptAppRuntimeOptions<
  ProjectPayload,
  CreatePayload,
  FolderScan
>): WorkspaceScriptIpcHandlers<ProjectPayload, CreatePayload, FolderScan> => ({
  addRecentFolder,
  createFromStoryboardScript,
  ensureStoryboardScriptMarkdown,
  inspectStoryboardScript
});
