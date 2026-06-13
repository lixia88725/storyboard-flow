type AiApiKeyStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
};

export type AiProviderName = "openai" | "seedream";

export const aiApiKeyStatusLabel = ({ hasOpenAiApiKey }: AiApiKeyStatus): string =>
  hasOpenAiApiKey ? "OpenAI API key saved" : "OpenAI API key not set";

export const aiProviderApiKeyStatusLabel = (
  provider: AiProviderName,
  status: AiApiKeyStatus
): string => {
  if (provider === "seedream") {
    return status.hasSeedreamApiKey ? "Seedream API key saved" : "Seedream API key not set";
  }
  return aiApiKeyStatusLabel(status);
};

export const canRequestAiGeneration = ({
  provider,
  hasOpenAiApiKey,
  hasSeedreamApiKey,
  isGenerating
}: AiApiKeyStatus & { provider: AiProviderName; isGenerating: boolean }): boolean => {
  const hasProviderKey = provider === "seedream" ? hasSeedreamApiKey : hasOpenAiApiKey;
  return hasProviderKey && !isGenerating;
};

export const visibleAiProviderSettings = (
  provider: AiProviderName
): { showOpenAi: boolean; showSeedream: boolean } => ({
  showOpenAi: provider === "openai",
  showSeedream: provider === "seedream"
});

const maskedAiApiKeyDraft = "****************";

export const nextAiApiKeyDraftAfterSave = (): string => maskedAiApiKeyDraft;

export const nextAiApiKeyDraftForStatus = ({
  currentDraft,
  hasSavedKey
}: {
  currentDraft: string;
  hasSavedKey: boolean;
}): string => {
  if (currentDraft === maskedAiApiKeyDraft || currentDraft.trim() === "") {
    return hasSavedKey ? maskedAiApiKeyDraft : "";
  }
  return currentDraft;
};

export const isAiApiKeyDraftSaveable = (draft: string): boolean =>
  draft.trim() !== "" && draft !== maskedAiApiKeyDraft;

export const nextAiSettingsPanelOpen = (isOpen: boolean): boolean => !isOpen;
