type AiApiKeyStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
  hasValidComfyUiSettings?: boolean;
};

export type AiProviderName = "openai" | "seedream" | "comfyui";

export const aiApiKeyStatusLabel = ({ hasOpenAiApiKey }: AiApiKeyStatus): string =>
  hasOpenAiApiKey ? "OpenAI API key saved" : "OpenAI API key not set";

export const aiProviderApiKeyStatusLabel = (
  provider: AiProviderName,
  status: AiApiKeyStatus
): string => {
  if (provider === "comfyui") {
    return status.hasValidComfyUiSettings ? "ComfyUI settings ready" : "ComfyUI workflow not configured";
  }
  if (provider === "seedream") {
    return status.hasSeedreamApiKey ? "Seedream API key saved" : "Seedream API key not set";
  }
  return aiApiKeyStatusLabel(status);
};

export const canRequestAiGeneration = ({
  provider,
  hasOpenAiApiKey,
  hasSeedreamApiKey,
  hasValidComfyUiSettings,
  isGenerating
}: AiApiKeyStatus & { provider: AiProviderName; isGenerating: boolean }): boolean => {
  if (isGenerating) {
    return false;
  }
  if (provider === "comfyui") {
    return Boolean(hasValidComfyUiSettings);
  }
  return provider === "seedream" ? hasSeedreamApiKey : hasOpenAiApiKey;
};

export const visibleAiProviderSettings = (
  provider: AiProviderName
): { showOpenAi: boolean; showSeedream: boolean; showComfyUi: boolean; showModel: boolean } => ({
  showOpenAi: provider === "openai",
  showSeedream: provider === "seedream",
  showComfyUi: provider === "comfyui",
  showModel: provider !== "comfyui"
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

export const comfyUiWorkflowDraftStatus = (workflowJson: string): { ok: boolean; message: string } => {
  if (workflowJson.trim() === "") {
    return { ok: false, message: "Workflow JSON is required" };
  }

  try {
    JSON.parse(workflowJson);
  } catch {
    return { ok: false, message: "Workflow JSON is invalid" };
  }

  if (!workflowJson.includes("__SBF_PROMPT__")) {
    return { ok: false, message: "Missing __SBF_PROMPT__" };
  }
  if (!workflowJson.includes("__SBF_IMAGE_1__")) {
    return { ok: false, message: "Missing __SBF_IMAGE_1__" };
  }

  const imageIndexes = [...workflowJson.matchAll(/__SBF_IMAGE_(\d+)__/g)].map((match) => Number(match[1]));
  const imagePlaceholderCount = Math.max(...imageIndexes);
  for (let index = 1; index <= imagePlaceholderCount; index += 1) {
    if (!imageIndexes.includes(index)) {
      return {
        ok: false,
        message: "Workflow image placeholders must be continuous from __SBF_IMAGE_1__"
      };
    }
  }

  return {
    ok: true,
    message: `${imagePlaceholderCount} image placeholder${imagePlaceholderCount === 1 ? "" : "s"} configured`
  };
};
