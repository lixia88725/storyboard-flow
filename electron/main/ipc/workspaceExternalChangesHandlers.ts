import type { IpcMain, IpcMainInvokeEvent } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type WorkspaceExternalChangesIpcHandlers<Sender, Progress, ProjectPayload> = {
  createProgressReporter: (sender: Sender, mode: "open") => Progress;
  checkExternalChanges: (
    payload: ProjectPayload,
    options: { reportProgress: Progress }
  ) => unknown;
};

export const registerWorkspaceExternalChangesIpcHandlers = <
  Sender,
  Progress,
  ProjectPayload
>(
  ipcMain: IpcMainLike,
  handlers: WorkspaceExternalChangesIpcHandlers<Sender, Progress, ProjectPayload>
): void => {
  ipcMain.handle("workspace:checkExternalChanges", async (event: IpcMainInvokeEvent, payload: ProjectPayload) =>
    handlers.checkExternalChanges(payload, {
      reportProgress: handlers.createProgressReporter(event.sender as Sender, "open")
    })
  );
};
