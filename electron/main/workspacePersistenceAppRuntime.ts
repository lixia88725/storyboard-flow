import type { WorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers.js";

type ProjectPayloadLike<Project> = {
  folderPath: string;
  metadataPath: string;
  project: Project;
};

export type WorkspacePersistenceAppRuntimeOptions<
  ProjectPayload extends ProjectPayloadLike<unknown>
> = {
  ensureProjectLayerAssets: WorkspacePersistenceIpcHandlers<ProjectPayload>["ensureProjectLayerAssets"];
  writeProjectFiles: WorkspacePersistenceIpcHandlers<ProjectPayload>["writeProjectFiles"];
};

export const createWorkspacePersistenceAppHandlers = <
  ProjectPayload extends ProjectPayloadLike<unknown>
>({
  ensureProjectLayerAssets,
  writeProjectFiles
}: WorkspacePersistenceAppRuntimeOptions<ProjectPayload>): WorkspacePersistenceIpcHandlers<ProjectPayload> => ({
  ensureProjectLayerAssets,
  writeProjectFiles
});
