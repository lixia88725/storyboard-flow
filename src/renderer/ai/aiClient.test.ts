import { describe, expect, it, vi } from "vitest";
import { createWindowAiClient } from "./aiClient";

describe("aiClient", () => {
  it("proxies AI calls and asset helpers through the preload API", async () => {
    const settings = {
      hasOpenAiApiKey: true,
      hasSeedreamApiKey: false,
      hasValidComfyUiSettings: false,
      comfyUi: {
        serverUrl: "http://127.0.0.1:8188",
        workflowJson: "",
        timeoutMs: 120000
      }
    };
    const storyboardApi = {
      filePathForDroppedFile: vi.fn(() => "/tmp/reference.png"),
      assetUrl: vi.fn((filePath: string) => `asset://${filePath}`),
      ai: {
        getSettings: vi.fn(async () => settings),
        listCandidates: vi.fn(async () => []),
        promoteCandidateToShot: vi.fn(async () => ({
          imagePath: "/scene/ai.tiff",
          fileName: "ai.tiff"
        })),
        rollbackPromotedCandidateShot: vi.fn(async () => undefined),
        testComfyUiConnection: vi.fn(async () => ({ ok: true, message: "Connected" }))
      }
    };
    const client = createWindowAiClient(storyboardApi as never);

    await expect(client.getSettings()).resolves.toBe(settings);
    await expect(client.testComfyUiConnection("http://127.0.0.1:8188")).resolves.toEqual({
      ok: true,
      message: "Connected"
    });
    await expect(client.listCandidates("/scene")).resolves.toEqual([]);
    await expect(client.promoteCandidateToShot("/scene", "candidate-a")).resolves.toEqual({
      imagePath: "/scene/ai.tiff",
      fileName: "ai.tiff"
    });
    await expect(
      client.rollbackPromotedCandidateShot("/scene", "/scene/ai_draft_1_0.tiff")
    ).resolves.toBeUndefined();
    expect(client.filePathForDroppedFile({} as File)).toBe("/tmp/reference.png");
    expect(client.assetUrl("/tmp/candidate.png")).toBe("asset:///tmp/candidate.png");
    expect(storyboardApi.ai.testComfyUiConnection).toHaveBeenCalledWith("http://127.0.0.1:8188");
  });
});
