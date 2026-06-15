type StoryboardApi = Window["storyboard"];

export type AiDraftClient = StoryboardApi["ai"] &
  Pick<StoryboardApi, "assetUrl" | "filePathForDroppedFile">;

export const createWindowAiClient = (storyboardApi: StoryboardApi): AiDraftClient => ({
  getSettings: () => storyboardApi.ai.getSettings(),
  saveOpenAiApiKey: (apiKey) => storyboardApi.ai.saveOpenAiApiKey(apiKey),
  clearOpenAiApiKey: () => storyboardApi.ai.clearOpenAiApiKey(),
  saveSeedreamApiKey: (apiKey) => storyboardApi.ai.saveSeedreamApiKey(apiKey),
  clearSeedreamApiKey: () => storyboardApi.ai.clearSeedreamApiKey(),
  saveComfyUiSettings: (settings) => storyboardApi.ai.saveComfyUiSettings(settings),
  testComfyUiConnection: (serverUrl) => storyboardApi.ai.testComfyUiConnection(serverUrl),
  listResources: (folderPath) => storyboardApi.ai.listResources(folderPath),
  importResources: (folderPath, sourceFilePaths) =>
    storyboardApi.ai.importResources(folderPath, sourceFilePaths),
  deleteResource: (folderPath, fileName) => storyboardApi.ai.deleteResource(folderPath, fileName),
  updateResourceMetadata: (folderPath, metadata) =>
    storyboardApi.ai.updateResourceMetadata(folderPath, metadata),
  generateCandidate: (payload) => storyboardApi.ai.generateCandidate(payload),
  generateBatchCandidates: (payload) => storyboardApi.ai.generateBatchCandidates(payload),
  copyRequestPreview: (payload) => storyboardApi.ai.copyRequestPreview(payload),
  discardCandidate: (folderPath, candidateId) =>
    storyboardApi.ai.discardCandidate(folderPath, candidateId),
  applyCandidate: (payload) => storyboardApi.ai.applyCandidate(payload),
  assetUrl: (filePath) => storyboardApi.assetUrl(filePath),
  filePathForDroppedFile: (file) => storyboardApi.filePathForDroppedFile(file)
});

export const windowAiClient = (): AiDraftClient => createWindowAiClient(window.storyboard);
