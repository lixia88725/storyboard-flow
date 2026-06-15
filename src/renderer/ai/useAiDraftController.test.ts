import { describe, expect, it } from "vitest";
import { nextAiDraftSettingsFromStatus } from "./useAiDraftController";

describe("AI draft controller", () => {
  it("syncs provider settings from saved status without exposing saved API keys", () => {
    const result = nextAiDraftSettingsFromStatus({
      status: {
        hasOpenAiApiKey: true,
        hasSeedreamApiKey: false,
        hasValidComfyUiSettings: true,
        comfyUi: {
          serverUrl: "http://127.0.0.1:8188",
          workflowJson: "{\"prompt\":\"__SBF_PROMPT__\",\"image\":\"__SBF_IMAGE_1__\"}",
          timeoutMs: 90000
        }
      },
      openAiApiKeyDraft: "",
      seedreamApiKeyDraft: "sk-draft"
    });

    expect(result.apiKeyStatus).toEqual({
      hasOpenAiApiKey: true,
      hasSeedreamApiKey: false,
      hasValidComfyUiSettings: true
    });
    expect(result.openAiApiKeyDraft).toBe("****************");
    expect(result.seedreamApiKeyDraft).toBe("sk-draft");
    expect(result.comfyUiServerUrl).toBe("http://127.0.0.1:8188");
    expect(result.comfyUiWorkflowJson).toContain("__SBF_IMAGE_1__");
    expect(result.comfyUiTimeoutMs).toBe(90000);
  });
});
