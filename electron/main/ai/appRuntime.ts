import type { AiIpcHandlers } from "../ipc/aiHandlers.js";
import { applyAiCandidateAsLayer, discardAiCandidate } from "./candidates.js";
import { createComfyUiImageProvider } from "./comfyUiImageProvider.js";
import { validateComfyUiServerUrl, validateComfyUiWorkflow } from "./comfyUiWorkflow.js";
import {
  clearOpenAiApiKey,
  clearSeedreamApiKey,
  readAiCredentialStatus,
  readOpenAiApiKey,
  readSeedreamApiKey,
  writeOpenAiApiKey,
  writeSeedreamApiKey,
  type AiCredentialStore
} from "./credentials.js";
import { generateAiCandidate } from "./generate.js";
import { generateAiBatchCandidates } from "./generateBatch.js";
import { createAiMainHandlers } from "./mainHandlers.js";
import { createOpenAiImageProvider } from "./openAiImageProvider.js";
import { buildAiRequestPreview } from "./requestPreview.js";
import {
  deleteAiResourceFile,
  importAiResourceFiles,
  listAiResources,
  writeAiResourceMetadata
} from "./resources.js";
import { createSeedreamImageProvider } from "./seedreamImageProvider.js";
import { readAiSettings, writeComfyUiSettings, type AiSettingsStore } from "./settings.js";

type ComfyUiConnectionResponse = Pick<Response, "ok" | "status" | "text">;

type FetchComfyUiConnection = (input: string) => Promise<ComfyUiConnectionResponse>;

export type AiAppHandlersOptions = {
  aiCredentialStore: () => AiCredentialStore;
  aiSettingsStore: () => AiSettingsStore;
  clipboardWriteText: (text: string) => void;
  fetchComfyUiConnection?: FetchComfyUiConnection;
};

export const testComfyUiConnection = async (
  serverUrl: string,
  fetchComfyUiConnection: FetchComfyUiConnection = fetch
): Promise<{ ok: true; message: string }> => {
  const normalizedServerUrl = validateComfyUiServerUrl(serverUrl);
  const response = await fetchComfyUiConnection(`${normalizedServerUrl}/system_stats`);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.trim() || `ComfyUI connection failed with ${response.status}`);
  }
  return { ok: true, message: "ComfyUI connection ready" };
};

export const createAiAppHandlers = ({
  aiCredentialStore,
  aiSettingsStore,
  clipboardWriteText,
  fetchComfyUiConnection = fetch
}: AiAppHandlersOptions): AiIpcHandlers =>
  createAiMainHandlers({
    aiCredentialStore,
    aiSettingsStore,
    applyCandidateAsLayer: applyAiCandidateAsLayer,
    buildAiRequestPreview,
    clearOpenAiApiKey,
    clearSeedreamApiKey,
    clipboardWriteText,
    createComfyUiImageProvider,
    createOpenAiImageProvider,
    createSeedreamImageProvider,
    deleteAiResourceFile,
    discardAiCandidate,
    generateAiBatchCandidates,
    generateAiCandidate,
    importAiResourceFiles,
    listAiResources,
    readAiCredentialStatus,
    readAiSettings,
    readOpenAiApiKey,
    readSeedreamApiKey,
    testComfyUiConnection: (serverUrl) =>
      testComfyUiConnection(serverUrl, fetchComfyUiConnection),
    validateComfyUiWorkflow,
    writeAiResourceMetadata,
    writeComfyUiSettings,
    writeOpenAiApiKey,
    writeSeedreamApiKey
  });
