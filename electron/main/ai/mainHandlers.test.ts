import { describe, expect, it, vi } from "vitest";
import { createAiMainHandlers } from "./mainHandlers.js";

const createDependencies = () => ({
  aiCredentialStore: () => ({ userDataPath: "/user-data", crypto: "safe-storage" }),
  aiSettingsStore: () => ({ userDataPath: "/user-data" }),
  applyCandidateAsLayer: vi.fn(async (payload) => ({ applied: payload })),
  buildAiRequestPreview: vi.fn(async () => "preview text"),
  clearOpenAiApiKey: vi.fn(async () => undefined),
  clearSeedreamApiKey: vi.fn(async () => undefined),
  clipboardWriteText: vi.fn(),
  createComfyUiImageProvider: vi.fn(() => ({ provider: "comfyui" })),
  createOpenAiImageProvider: vi.fn(() => ({ provider: "openai" })),
  createSeedreamImageProvider: vi.fn(() => ({ provider: "seedream" })),
  deleteAiResourceFile: vi.fn(),
  discardAiCandidate: vi.fn(),
  generateAiBatchCandidates: vi.fn(async (payload) => ({ batch: payload })),
  generateAiCandidate: vi.fn(async (payload) => ({ candidate: payload })),
  importAiResourceFiles: vi.fn(),
  listAiResources: vi.fn(),
  readAiCredentialStatus: vi.fn(async () => ({
    hasOpenAiApiKey: true,
    hasSeedreamApiKey: false
  })),
  readAiSettings: vi.fn(async () => ({
    comfyUi: { serverUrl: "http://127.0.0.1:8188", workflowJson: "{}", timeoutMs: 1000 }
  })),
  readOpenAiApiKey: vi.fn(async () => "openai-key"),
  readSeedreamApiKey: vi.fn(async () => "seedream-key"),
  testComfyUiConnection: vi.fn(async () => ({ ok: true, message: "ready" })),
  validateComfyUiWorkflow: vi.fn(() => ({ ok: true })),
  writeAiResourceMetadata: vi.fn(),
  writeComfyUiSettings: vi.fn(async () => undefined),
  writeOpenAiApiKey: vi.fn(async () => undefined),
  writeSeedreamApiKey: vi.fn(async () => undefined)
});

describe("createAiMainHandlers", () => {
  it("returns renderer settings after credential updates", async () => {
    const deps = createDependencies();
    const handlers = createAiMainHandlers(deps);

    await expect(handlers.saveOpenAiApiKey("next-key")).resolves.toEqual({
      hasOpenAiApiKey: true,
      hasSeedreamApiKey: false,
      comfyUi: { serverUrl: "http://127.0.0.1:8188", workflowJson: "{}", timeoutMs: 1000 },
      hasValidComfyUiSettings: true
    });

    expect(deps.writeOpenAiApiKey).toHaveBeenCalledWith(
      { userDataPath: "/user-data", crypto: "safe-storage" },
      "next-key"
    );
  });

  it("injects the selected provider into single and batch generation", async () => {
    const deps = createDependencies();
    const handlers = createAiMainHandlers(deps);

    await handlers.generateCandidate({
      folderPath: "/project",
      project: { shots: [] },
      shotId: "shot-1",
      generationSettings: { provider: "seedream" }
    });
    await handlers.generateBatchCandidates({
      folderPath: "/project",
      project: { shots: [] },
      shotIds: ["shot-1"],
      generationSettings: { provider: "comfyui" }
    });

    expect(deps.createSeedreamImageProvider).toHaveBeenCalledWith({ apiKey: "seedream-key" });
    expect(deps.generateAiCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: { provider: "seedream" } })
    );
    expect(deps.createComfyUiImageProvider).toHaveBeenCalledWith({
      settings: { serverUrl: "http://127.0.0.1:8188", workflowJson: "{}", timeoutMs: 1000 }
    });
    expect(deps.generateAiBatchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ provider: { provider: "comfyui" } })
    );
  });

  it("copies ComfyUI request preview text with ComfyUI settings", async () => {
    const deps = createDependencies();
    const handlers = createAiMainHandlers(deps);

    await expect(
      handlers.copyRequestPreview({
        folderPath: "/project",
        project: { shots: [] },
        shotId: "shot-1",
        generationSettings: { provider: "comfyui" }
      })
    ).resolves.toEqual({ text: "preview text" });

    expect(deps.buildAiRequestPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        comfyUiSettings: { serverUrl: "http://127.0.0.1:8188", workflowJson: "{}", timeoutMs: 1000 }
      })
    );
    expect(deps.clipboardWriteText).toHaveBeenCalledWith("preview text");
  });
});
