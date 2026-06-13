import { describe, expect, it } from "vitest";
import {
  aiApiKeyStatusLabel,
  aiProviderApiKeyStatusLabel,
  canRequestAiGeneration,
  nextAiSettingsPanelOpen,
  nextAiApiKeyDraftAfterSave,
  nextAiApiKeyDraftForStatus,
  isAiApiKeyDraftSaveable,
  visibleAiProviderSettings
} from "./aiSettingsState";

describe("AI settings state", () => {
  it("shows GUI-only API key status text", () => {
    expect(aiApiKeyStatusLabel({ hasOpenAiApiKey: false, hasSeedreamApiKey: false })).toBe(
      "OpenAI API key not set"
    );
    expect(aiApiKeyStatusLabel({ hasOpenAiApiKey: true, hasSeedreamApiKey: false })).toBe(
      "OpenAI API key saved"
    );
    expect(
      aiProviderApiKeyStatusLabel("seedream", {
        hasOpenAiApiKey: false,
        hasSeedreamApiKey: false
      })
    ).toBe("Seedream API key not set");
    expect(
      aiProviderApiKeyStatusLabel("seedream", {
        hasOpenAiApiKey: false,
        hasSeedreamApiKey: true
      })
    ).toBe("Seedream API key saved");
  });

  it("requires a saved GUI API key before generation can start", () => {
    expect(
      canRequestAiGeneration({
        provider: "openai",
        hasOpenAiApiKey: false,
        hasSeedreamApiKey: true,
        isGenerating: false
      })
    ).toBe(false);
    expect(
      canRequestAiGeneration({
        provider: "openai",
        hasOpenAiApiKey: true,
        hasSeedreamApiKey: false,
        isGenerating: false
      })
    ).toBe(true);
    expect(
      canRequestAiGeneration({
        provider: "seedream",
        hasOpenAiApiKey: true,
        hasSeedreamApiKey: false,
        isGenerating: false
      })
    ).toBe(false);
    expect(
      canRequestAiGeneration({
        provider: "seedream",
        hasOpenAiApiKey: false,
        hasSeedreamApiKey: true,
        isGenerating: false
      })
    ).toBe(true);
    expect(
      canRequestAiGeneration({
        provider: "seedream",
        hasOpenAiApiKey: true,
        hasSeedreamApiKey: true,
        isGenerating: true
      })
    ).toBe(false);
  });

  it("keeps a masked key draft visible after saving or loading saved status", () => {
    const maskedDraft = nextAiApiKeyDraftAfterSave();

    expect(maskedDraft).not.toBe("");
    expect(nextAiApiKeyDraftForStatus({ currentDraft: "", hasSavedKey: true })).toBe(maskedDraft);
    expect(nextAiApiKeyDraftForStatus({ currentDraft: "", hasSavedKey: false })).toBe("");
    expect(nextAiApiKeyDraftForStatus({ currentDraft: "sk-new", hasSavedKey: true })).toBe("sk-new");
    expect(nextAiApiKeyDraftForStatus({ currentDraft: maskedDraft, hasSavedKey: false })).toBe("");
  });

  it("does not treat the visible masked key as a saveable API key", () => {
    expect(isAiApiKeyDraftSaveable("")).toBe(false);
    expect(isAiApiKeyDraftSaveable(nextAiApiKeyDraftAfterSave())).toBe(false);
    expect(isAiApiKeyDraftSaveable("sk-new")).toBe(true);
  });

  it("toggles General Settings from the header button", () => {
    expect(nextAiSettingsPanelOpen(false)).toBe(true);
    expect(nextAiSettingsPanelOpen(true)).toBe(false);
  });

  it("shows settings only for the selected provider", () => {
    expect(visibleAiProviderSettings("openai")).toEqual({
      showOpenAi: true,
      showSeedream: false
    });
    expect(visibleAiProviderSettings("seedream")).toEqual({
      showOpenAi: false,
      showSeedream: true
    });
  });
});
