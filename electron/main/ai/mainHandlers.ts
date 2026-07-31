import type { AiIpcHandlers } from "../ipc/aiHandlers.js";
import type { AiImageProviderName, GenerateAiCandidateInput } from "./generate.js";
import type { GenerateAiBatchCandidatesInput } from "./generateBatch.js";
import type { AiBatchResourceAssignments, AiBatchSize } from "./batch.js";
import type { AiResourceMetadata } from "./context.js";
import type { AiCredentialStore } from "./credentials.js";
import type { AiImageProvider } from "./openAiImageProvider.js";
import type { AiSettingsStore, ComfyUiSettings } from "./settings.js";
import type { Project } from "./types.js";

type AiGenerateCandidatePayload = {
  folderPath: string;
  project: Project;
  shotId: string;
  selectedShotContext?: string;
  selectedResourceIds?: string[];
  generationSettings?: {
    provider?: AiImageProviderName;
    model?: string;
  };
};

type AiGenerateBatchCandidatesPayload = {
  folderPath: string;
  project: Project;
  shotIds: string[];
  batchSize?: AiBatchSize;
  selectedResourceIds?: string[];
  resourceAssignments?: AiBatchResourceAssignments;
  generationSettings?: {
    provider?: AiImageProviderName;
    model?: string;
  };
};

type AiRequestPreviewPayload = AiGenerateCandidatePayload | AiGenerateBatchCandidatesPayload;

type AiComfyUiSettingsPayload = ComfyUiSettings;

type AiApplyCandidatePayload = {
  folderPath: string;
  project: Project;
  candidateId: string;
};

export type AiMainHandlersDependencies = {
  aiCredentialStore: () => AiCredentialStore;
  aiSettingsStore: () => AiSettingsStore;
  applyCandidateAsLayer: (payload: AiApplyCandidatePayload) => unknown;
  buildAiRequestPreview: (
    payload: AiRequestPreviewPayload & { comfyUiSettings?: ComfyUiSettings }
  ) => Promise<string>;
  clearOpenAiApiKey: (store: AiCredentialStore) => Promise<unknown>;
  clearSeedreamApiKey: (store: AiCredentialStore) => Promise<unknown>;
  clipboardWriteText: (text: string) => void;
  createComfyUiImageProvider: (input: { settings: ComfyUiSettings }) => AiImageProvider;
  createOpenAiImageProvider: (input: { apiKey?: string }) => AiImageProvider;
  createSeedreamImageProvider: (input: { apiKey?: string }) => AiImageProvider;
  deleteAiResourceFile: (folderPath: string, fileName: string) => unknown;
  discardAiCandidate: (folderPath: string, candidateId: string) => unknown;
  generateAiBatchCandidates: (input: GenerateAiBatchCandidatesInput) => unknown;
  generateAiCandidate: (input: GenerateAiCandidateInput) => unknown;
  importAiResourceFiles: (folderPath: string, sourceFilePaths: string[]) => unknown;
  listAiCandidates: (folderPath: string) => unknown;
  listAiResources: (folderPath: string) => unknown;
  promoteAiCandidateToShot: (folderPath: string, candidateId: string) => unknown;
  rollbackPromotedCandidateShot: (folderPath: string, imagePath: string) => unknown;
  readAiCredentialStatus: (store: AiCredentialStore) => Promise<unknown>;
  readAiSettings: (store: AiSettingsStore) => Promise<{ comfyUi: ComfyUiSettings }>;
  readOpenAiApiKey: (store: AiCredentialStore) => Promise<string | undefined>;
  readSeedreamApiKey: (store: AiCredentialStore) => Promise<string | undefined>;
  testComfyUiConnection: (serverUrl: string) => unknown;
  validateComfyUiWorkflow: (workflowJson: string, imageCount: number) => { ok: boolean };
  writeAiResourceMetadata: (folderPath: string, metadata: AiResourceMetadata) => unknown;
  writeComfyUiSettings: (
    store: AiSettingsStore,
    settings: AiComfyUiSettingsPayload
  ) => Promise<unknown>;
  writeOpenAiApiKey: (store: AiCredentialStore, apiKey: string) => Promise<unknown>;
  writeSeedreamApiKey: (store: AiCredentialStore, apiKey: string) => Promise<unknown>;
};

export const createAiMainHandlers = (dependencies: AiMainHandlersDependencies): AiIpcHandlers => {
  const readAiSettingsForRenderer = async () => {
    const [credentials, settings] = await Promise.all([
      dependencies.readAiCredentialStatus(dependencies.aiCredentialStore()),
      dependencies.readAiSettings(dependencies.aiSettingsStore())
    ]);
    return {
      ...(credentials as object),
      ...settings,
      hasValidComfyUiSettings: dependencies.validateComfyUiWorkflow(settings.comfyUi.workflowJson, 1).ok
    };
  };

  const createAiImageProvider = async (providerName: AiImageProviderName) => {
    if (providerName === "comfyui") {
      const settings = await dependencies.readAiSettings(dependencies.aiSettingsStore());
      return dependencies.createComfyUiImageProvider({ settings: settings.comfyUi });
    }
    if (providerName === "seedream") {
      return dependencies.createSeedreamImageProvider({
        apiKey: await dependencies.readSeedreamApiKey(dependencies.aiCredentialStore())
      });
    }
    return dependencies.createOpenAiImageProvider({
      apiKey: await dependencies.readOpenAiApiKey(dependencies.aiCredentialStore())
    });
  };

  return {
    getSettings: readAiSettingsForRenderer,
    saveOpenAiApiKey: async (apiKey) => {
      await dependencies.writeOpenAiApiKey(dependencies.aiCredentialStore(), apiKey);
      return readAiSettingsForRenderer();
    },
    clearOpenAiApiKey: async () => {
      await dependencies.clearOpenAiApiKey(dependencies.aiCredentialStore());
      return readAiSettingsForRenderer();
    },
    saveSeedreamApiKey: async (apiKey) => {
      await dependencies.writeSeedreamApiKey(dependencies.aiCredentialStore(), apiKey);
      return readAiSettingsForRenderer();
    },
    clearSeedreamApiKey: async () => {
      await dependencies.clearSeedreamApiKey(dependencies.aiCredentialStore());
      return readAiSettingsForRenderer();
    },
    saveComfyUiSettings: async (settings) => {
      await dependencies.writeComfyUiSettings(
        dependencies.aiSettingsStore(),
        settings as AiComfyUiSettingsPayload
      );
      return readAiSettingsForRenderer();
    },
    testComfyUiConnection: dependencies.testComfyUiConnection,
    listResources: dependencies.listAiResources,
    importResources: dependencies.importAiResourceFiles,
    deleteResource: dependencies.deleteAiResourceFile,
    updateResourceMetadata: (folderPath, metadata) =>
      dependencies.writeAiResourceMetadata(folderPath, metadata as AiResourceMetadata),
    generateCandidate: async (payload) => {
      const typedPayload = payload as AiGenerateCandidatePayload;
      const providerName = typedPayload.generationSettings?.provider ?? "openai";
      return dependencies.generateAiCandidate({
        ...typedPayload,
        provider: await createAiImageProvider(providerName)
      });
    },
    generateBatchCandidates: async (payload) => {
      const typedPayload = payload as AiGenerateBatchCandidatesPayload;
      const providerName = typedPayload.generationSettings?.provider ?? "openai";
      return dependencies.generateAiBatchCandidates({
        ...typedPayload,
        provider: await createAiImageProvider(providerName)
      });
    },
    listCandidates: dependencies.listAiCandidates,
    promoteCandidateToShot: dependencies.promoteAiCandidateToShot,
    rollbackPromotedCandidateShot: dependencies.rollbackPromotedCandidateShot,
    copyRequestPreview: async (payload) => {
      const typedPayload = payload as AiRequestPreviewPayload;
      const providerName = typedPayload.generationSettings?.provider ?? "openai";
      const settings =
        providerName === "comfyui"
          ? await dependencies.readAiSettings(dependencies.aiSettingsStore())
          : undefined;
      const text = await dependencies.buildAiRequestPreview({
        ...typedPayload,
        comfyUiSettings: settings?.comfyUi
      });
      dependencies.clipboardWriteText(text);
      return { text };
    },
    discardCandidate: dependencies.discardAiCandidate,
    applyCandidate: (payload) => dependencies.applyCandidateAsLayer(payload as AiApplyCandidatePayload)
  };
};
