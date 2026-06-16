import type { WorkspaceWatchIpcHandlers } from "./ipc/workspaceWatchHandlers.js";

type SenderLike = {
  send: (channel: string, payload: unknown) => void;
};

type WorkspaceFolderWatchService = {
  start: (folderPath: string, sender: SenderLike) => number;
  stop: (watcherId: number) => void;
};

export type WorkspaceWatchAppRuntimeOptions = {
  workspaceFolderWatchService: WorkspaceFolderWatchService;
};

export const createWorkspaceWatchAppHandlers = ({
  workspaceFolderWatchService
}: WorkspaceWatchAppRuntimeOptions): WorkspaceWatchIpcHandlers => ({
  startFolderWatch: (event, folderPath) =>
    workspaceFolderWatchService.start(folderPath, event.sender),
  stopFolderWatch: (watcherId) => {
    workspaceFolderWatchService.stop(watcherId);
  }
});
