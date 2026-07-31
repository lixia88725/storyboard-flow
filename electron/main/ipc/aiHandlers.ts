import type { IpcMain } from "electron";

type IpcMainLike = Pick<IpcMain, "handle">;

export type AiIpcHandlers = {
  getSettings: () => unknown;
  saveOpenAiApiKey: (apiKey: string) => unknown;
  clearOpenAiApiKey: () => unknown;
  saveSeedreamApiKey: (apiKey: string) => unknown;
  clearSeedreamApiKey: () => unknown;
  saveComfyUiSettings: (settings: unknown) => unknown;
  testComfyUiConnection: (serverUrl: string) => unknown;
  listResources: (folderPath: string) => unknown;
  importResources: (folderPath: string, sourceFilePaths: string[]) => unknown;
  deleteResource: (folderPath: string, fileName: string) => unknown;
  updateResourceMetadata: (folderPath: string, metadata: unknown) => unknown;
  generateCandidate: (payload: unknown) => unknown;
  generateBatchCandidates: (payload: unknown) => unknown;
  listCandidates: (folderPath: string) => unknown;
  promoteCandidateToShot: (folderPath: string, candidateId: string) => unknown;
  rollbackPromotedCandidateShot: (folderPath: string, imagePath: string) => unknown;
  copyRequestPreview: (payload: unknown) => unknown;
  discardCandidate: (folderPath: string, candidateId: string) => unknown;
  applyCandidate: (payload: unknown) => unknown;
};

export const registerAiIpcHandlers = (ipcMain: IpcMainLike, handlers: AiIpcHandlers): void => {
  ipcMain.handle("ai:getSettings", async () => handlers.getSettings());
  ipcMain.handle("ai:saveOpenAiApiKey", async (_event, apiKey: string) =>
    handlers.saveOpenAiApiKey(apiKey)
  );
  ipcMain.handle("ai:clearOpenAiApiKey", async () => handlers.clearOpenAiApiKey());
  ipcMain.handle("ai:saveSeedreamApiKey", async (_event, apiKey: string) =>
    handlers.saveSeedreamApiKey(apiKey)
  );
  ipcMain.handle("ai:clearSeedreamApiKey", async () => handlers.clearSeedreamApiKey());
  ipcMain.handle("ai:saveComfyUiSettings", async (_event, settings: unknown) =>
    handlers.saveComfyUiSettings(settings)
  );
  ipcMain.handle("ai:testComfyUiConnection", async (_event, serverUrl: string) =>
    handlers.testComfyUiConnection(serverUrl)
  );
  ipcMain.handle("ai:listResources", async (_event, folderPath: string) =>
    handlers.listResources(folderPath)
  );
  ipcMain.handle("ai:importResources", async (_event, folderPath: string, sourceFilePaths: string[]) =>
    handlers.importResources(folderPath, sourceFilePaths)
  );
  ipcMain.handle("ai:deleteResource", async (_event, folderPath: string, fileName: string) =>
    handlers.deleteResource(folderPath, fileName)
  );
  ipcMain.handle("ai:updateResourceMetadata", async (_event, folderPath: string, metadata: unknown) =>
    handlers.updateResourceMetadata(folderPath, metadata)
  );
  ipcMain.handle("ai:generateCandidate", async (_event, payload: unknown) =>
    handlers.generateCandidate(payload)
  );
  ipcMain.handle("ai:generateBatchCandidates", async (_event, payload: unknown) =>
    handlers.generateBatchCandidates(payload)
  );
  ipcMain.handle("ai:listCandidates", async (_event, folderPath: string) =>
    handlers.listCandidates(folderPath)
  );
  ipcMain.handle(
    "ai:promoteCandidateToShot",
    async (_event, folderPath: string, candidateId: string) =>
      handlers.promoteCandidateToShot(folderPath, candidateId)
  );
  ipcMain.handle(
    "ai:rollbackPromotedCandidateShot",
    async (_event, folderPath: string, imagePath: string) =>
      handlers.rollbackPromotedCandidateShot(folderPath, imagePath)
  );
  ipcMain.handle("ai:copyRequestPreview", async (_event, payload: unknown) =>
    handlers.copyRequestPreview(payload)
  );
  ipcMain.handle("ai:discardCandidate", async (_event, folderPath: string, candidateId: string) =>
    handlers.discardCandidate(folderPath, candidateId)
  );
  ipcMain.handle("ai:applyCandidate", async (_event, payload: unknown) =>
    handlers.applyCandidate(payload)
  );
};
