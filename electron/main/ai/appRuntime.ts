import type { AiIpcHandlers } from "../ipc/aiHandlers.js";
import {
  applyAiCandidateAsLayer,
  discardAiCandidate,
  listAiCandidates,
  promoteAiCandidateToShot,
  rollbackPromotedAiCandidateShot
} from "./candidates.js";
import { previewRootForFolder } from "../previewPaths.js";
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
  createImageRecords: (
    imagePaths: string[],
    previewRoot: string
  ) => Promise<Array<{
    imagePath: string;
    previewPath?: string;
    fileName: string;
    width?: number;
    height?: number;
    fingerprint?: string;
    swbMetadata?: unknown;
  }>>;
  fetchComfyUiConnection?: FetchComfyUiConnection;
  trashItem: (filePath: string) => Promise<void>;
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
  createImageRecords,
  fetchComfyUiConnection = fetch,
  trashItem
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
    discardAiCandidate: (folderPath, candidateId) =>
      discardAiCandidate(folderPath, candidateId, { trashItem }),
    generateAiBatchCandidates,
    generateAiCandidate,
    importAiResourceFiles,
    listAiCandidates,
    listAiResources,
    promoteAiCandidateToShot: async (folderPath, candidateId) => {
      const imagePath = await promoteAiCandidateToShot(folderPath, candidateId);
      try {
        const [image] = await createImageRecords([imagePath], previewRootForFolder(folderPath));
        if (!image) {
          throw new Error("Could not read promoted AI Draft shot");
        }
        return image;
      } catch (error) {
        await rollbackPromotedAiCandidateShot(folderPath, imagePath);
        throw error;
      }
    },
    rollbackPromotedCandidateShot: rollbackPromotedAiCandidateShot,
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
