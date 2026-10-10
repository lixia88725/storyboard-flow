import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

type ProjectPayloadLike<Project> = {
  folderPath: string;
  metadataPath: string;
  project: Project;
  normalSaveScriptInput?: string;
  normalSaveScriptExpectedInput?: string | null;

};

export type WorkspacePersistenceIpcHandlers<ProjectPayload extends ProjectPayloadLike<unknown>> = {
  assertAdmission?: (payload: ProjectPayload) => unknown;

  assertEnsureAdmission?: (payload: ProjectPayload) => unknown;
  ensureProjectLayerAssets: (
    project: ProjectPayload["project"],
    folderPath: string,
    options?: { includeExternalShots?: boolean }
  ) => unknown;
  writeProjectFiles: (
    metadataPath: string,
    folderPath: string,
    project: ProjectPayload["project"],
    normalSaveScriptInput?: string,
    normalSaveScriptExpectedInput?: string | null
  ) => unknown;
};

export const registerWorkspacePersistenceIpcHandlers = <
  ProjectPayload extends ProjectPayloadLike<unknown>
>(
  ipcMain: IpcMainLike,
  handlers: WorkspacePersistenceIpcHandlers<ProjectPayload>
): void => {
  ipcMain.handle("workspace:autosave", async (_event, payload: ProjectPayload) => {
    if ("normalSaveAiPromotion" in payload) throw new Error("AI generation is no longer supported");
    if (handlers.assertAdmission) await handlers.assertAdmission(payload);
    await handlers.ensureProjectLayerAssets(payload.project, payload.folderPath, {
      includeExternalShots: false
    });
    if (payload.normalSaveScriptInput !== undefined || payload.normalSaveScriptExpectedInput !== undefined) {
      await handlers.writeProjectFiles(payload.metadataPath, payload.folderPath, payload.project, payload.normalSaveScriptInput, payload.normalSaveScriptExpectedInput);
    } else await handlers.writeProjectFiles(payload.metadataPath, payload.folderPath, payload.project);
    return payload;
  });

  ipcMain.handle("workspace:ensureLayerAssets", async (_event, payload: ProjectPayload) => {
    if ("normalSaveAiPromotion" in payload) throw new Error("AI generation is no longer supported");
    if (handlers.assertEnsureAdmission) await handlers.assertEnsureAdmission(payload);
    if (handlers.assertAdmission) await handlers.assertAdmission(payload);
    await handlers.ensureProjectLayerAssets(payload.project, payload.folderPath);
    return payload;
  });
};
