import type { IpcMain } from "electron";
import { ImportRecoveryIncompleteError } from "../importRecovery.js";
import { normalSaveImportFailure } from "../../shared/normalSaveImportIpc.js";

type IpcMainLike = Pick<IpcMain, "handle">;

type ProjectPayloadLike<Project> = {
  folderPath: string;
  project: Project;
};

type FolderScanLike = {
  folderPath: string;
};

export type WorkspaceScriptIpcHandlers<
  ProjectPayload extends ProjectPayloadLike<unknown>,
  CreatePayload,
  FolderScan extends FolderScanLike = FolderScanLike
> = {
  inspectStoryboardScript: (sourceMarkdownPath: string) => unknown;
  createFromStoryboardScript: (payload: CreatePayload) => Promise<FolderScan>;
  addRecentFolder: (folderPath: string) => unknown;
  ensureStoryboardScriptMarkdown: (
    folderPath: string,
    project: ProjectPayload["project"]
  ) => unknown;
};

export const registerWorkspaceScriptIpcHandlers = <
  ProjectPayload extends ProjectPayloadLike<unknown>,
  CreatePayload,
  FolderScan extends FolderScanLike = FolderScanLike
>(
  ipcMain: IpcMainLike,
  handlers: WorkspaceScriptIpcHandlers<ProjectPayload, CreatePayload, FolderScan>
): void => {
  ipcMain.handle("workspace:inspectStoryboardScript", async (_event, sourceMarkdownPath: string) =>
    handlers.inspectStoryboardScript(sourceMarkdownPath)
  );

  ipcMain.handle("workspace:createFromStoryboardScript", async (_event, payload: CreatePayload) => {
    try {
      const scan = await handlers.createFromStoryboardScript(payload);
      await handlers.addRecentFolder(scan.folderPath);
      return scan;
    } catch (error) {
      if (error instanceof ImportRecoveryIncompleteError) return normalSaveImportFailure(error);
      throw error;
    }
  });

  ipcMain.handle("workspace:checkStoryboardScript", async (_event, payload: ProjectPayload) => ({
    scriptImportNeeded: await handlers.ensureStoryboardScriptMarkdown(
      payload.folderPath,
      payload.project
    )
  }));
};
