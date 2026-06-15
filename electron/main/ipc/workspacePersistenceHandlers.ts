import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

type ProjectPayloadLike<Project> = {
  folderPath: string;
  metadataPath: string;
  project: Project;
};

export type WorkspacePersistenceIpcHandlers<ProjectPayload extends ProjectPayloadLike<unknown>> = {
  ensureProjectLayerAssets: (
    project: ProjectPayload["project"],
    folderPath: string,
    options?: { includeExternalShots?: boolean }
  ) => unknown;
  writeProjectFiles: (
    metadataPath: string,
    folderPath: string,
    project: ProjectPayload["project"]
  ) => unknown;
};

export const registerWorkspacePersistenceIpcHandlers = <
  ProjectPayload extends ProjectPayloadLike<unknown>
>(
  ipcMain: IpcMainLike,
  handlers: WorkspacePersistenceIpcHandlers<ProjectPayload>
): void => {
  ipcMain.handle("workspace:autosave", async (_event, payload: ProjectPayload) => {
    await handlers.ensureProjectLayerAssets(payload.project, payload.folderPath, {
      includeExternalShots: false
    });
    await handlers.writeProjectFiles(payload.metadataPath, payload.folderPath, payload.project);
    return payload;
  });

  ipcMain.handle("workspace:ensureLayerAssets", async (_event, payload: ProjectPayload) => {
    await handlers.ensureProjectLayerAssets(payload.project, payload.folderPath);
    return payload;
  });
};
