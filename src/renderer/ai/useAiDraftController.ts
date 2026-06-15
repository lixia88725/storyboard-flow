import { useEffect, useMemo, useState } from "react";
import type { AiDraftClient } from "./aiClient";
import {
  type AiProviderName,
  comfyUiWorkflowDraftStatus,
  isAiApiKeyDraftSaveable,
  nextAiApiKeyDraftAfterSave,
  nextAiApiKeyDraftForStatus,
  visibleAiProviderSettings
} from "./aiSettingsState";

export type AiSettingsStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
  hasValidComfyUiSettings: boolean;
  comfyUi: {
    serverUrl: string;
    workflowJson: string;
    timeoutMs: number;
  };
};

type AiDraftApiKeyStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
  hasValidComfyUiSettings: boolean;
};

type AiDraftSettingsState = {
  apiKeyStatus: AiDraftApiKeyStatus;
  openAiApiKeyDraft: string;
  seedreamApiKeyDraft: string;
  comfyUiServerUrl: string;
  comfyUiWorkflowJson: string;
  comfyUiTimeoutMs: number;
};

export const nextAiDraftSettingsFromStatus = ({
  status,
  openAiApiKeyDraft,
  seedreamApiKeyDraft
}: {
  status: AiSettingsStatus;
  openAiApiKeyDraft: string;
  seedreamApiKeyDraft: string;
}): AiDraftSettingsState => ({
  apiKeyStatus: {
    hasOpenAiApiKey: status.hasOpenAiApiKey,
    hasSeedreamApiKey: status.hasSeedreamApiKey,
    hasValidComfyUiSettings: status.hasValidComfyUiSettings
  },
  openAiApiKeyDraft: nextAiApiKeyDraftForStatus({
    currentDraft: openAiApiKeyDraft,
    hasSavedKey: status.hasOpenAiApiKey
  }),
  seedreamApiKeyDraft: nextAiApiKeyDraftForStatus({
    currentDraft: seedreamApiKeyDraft,
    hasSavedKey: status.hasSeedreamApiKey
  }),
  comfyUiServerUrl: status.comfyUi.serverUrl,
  comfyUiWorkflowJson: status.comfyUi.workflowJson,
  comfyUiTimeoutMs: status.comfyUi.timeoutMs
});

export const useAiDraftController = ({
  aiClient,
  isOpen,
  setStatus
}: {
  aiClient: AiDraftClient;
  isOpen: boolean;
  setStatus: (status: string) => void;
}) => {
  const [providerName, setProviderName] = useState<AiProviderName>("openai");
  const [openAiModel, setOpenAiModel] = useState("gpt-image-2");
  const [seedreamModel, setSeedreamModel] = useState("doubao-seedream-5.0-lite");
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [seedreamApiKeyDraft, setSeedreamApiKeyDraft] = useState("");
  const [comfyUiServerUrl, setComfyUiServerUrl] = useState("http://127.0.0.1:8188");
  const [comfyUiWorkflowJson, setComfyUiWorkflowJson] = useState("");
  const [comfyUiTimeoutMs, setComfyUiTimeoutMs] = useState(120000);
  const [comfyUiConnectionStatus, setComfyUiConnectionStatus] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState<AiDraftApiKeyStatus>({
    hasOpenAiApiKey: false,
    hasSeedreamApiKey: false,
    hasValidComfyUiSettings: false
  });

  const applySettingsStatus = (status: AiSettingsStatus) => {
    const nextSettings = nextAiDraftSettingsFromStatus({
      status,
      openAiApiKeyDraft: "",
      seedreamApiKeyDraft: ""
    });
    setApiKeyStatus(nextSettings.apiKeyStatus);
    setComfyUiServerUrl(nextSettings.comfyUiServerUrl);
    setComfyUiWorkflowJson(nextSettings.comfyUiWorkflowJson);
    setComfyUiTimeoutMs(nextSettings.comfyUiTimeoutMs);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    aiClient
      .getSettings()
      .then((result) => {
        if (!cancelled) {
          applySettingsStatus(result);
          setOpenAiApiKeyDraft((currentDraft) =>
            nextAiApiKeyDraftForStatus({
              currentDraft,
              hasSavedKey: result.hasOpenAiApiKey
            })
          );
          setSeedreamApiKeyDraft((currentDraft) =>
            nextAiApiKeyDraftForStatus({
              currentDraft,
              hasSavedKey: result.hasSeedreamApiKey
            })
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(`Could not load AI settings: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aiClient, isOpen]);

  const currentModel = providerName === "seedream" ? seedreamModel : openAiModel;
  const currentGenerationSettings = useMemo(
    () =>
      providerName === "comfyui"
        ? { provider: providerName }
        : { provider: providerName, model: currentModel },
    [currentModel, providerName]
  );
  const providerSettings = visibleAiProviderSettings(providerName);
  const comfyUiDraftStatus = comfyUiWorkflowDraftStatus(comfyUiWorkflowJson);

  const saveOpenAiApiKey = async () => {
    if (!isAiApiKeyDraftSaveable(openAiApiKeyDraft)) {
      return;
    }
    try {
      const nextStatus = await aiClient.saveOpenAiApiKey(openAiApiKeyDraft);
      applySettingsStatus(nextStatus);
      setOpenAiApiKeyDraft(nextAiApiKeyDraftAfterSave());
      setStatus("OpenAI API key saved");
    } catch (error) {
      setStatus(`Could not save OpenAI API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearOpenAiApiKey = async () => {
    try {
      const nextStatus = await aiClient.clearOpenAiApiKey();
      applySettingsStatus(nextStatus);
      setOpenAiApiKeyDraft("");
      setStatus("OpenAI API key cleared");
    } catch (error) {
      setStatus(`Could not clear OpenAI API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const saveSeedreamApiKey = async () => {
    if (!isAiApiKeyDraftSaveable(seedreamApiKeyDraft)) {
      return;
    }
    try {
      const nextStatus = await aiClient.saveSeedreamApiKey(seedreamApiKeyDraft);
      applySettingsStatus(nextStatus);
      setSeedreamApiKeyDraft(nextAiApiKeyDraftAfterSave());
      setStatus("Seedream API key saved");
    } catch (error) {
      setStatus(`Could not save Seedream API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearSeedreamApiKey = async () => {
    try {
      const nextStatus = await aiClient.clearSeedreamApiKey();
      applySettingsStatus(nextStatus);
      setSeedreamApiKeyDraft("");
      setStatus("Seedream API key cleared");
    } catch (error) {
      setStatus(`Could not clear Seedream API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const saveComfyUiSettings = async () => {
    try {
      const nextStatus = await aiClient.saveComfyUiSettings({
        serverUrl: comfyUiServerUrl,
        workflowJson: comfyUiWorkflowJson,
        timeoutMs: comfyUiTimeoutMs
      });
      applySettingsStatus(nextStatus);
      setStatus(
        nextStatus.hasValidComfyUiSettings
          ? "ComfyUI settings saved"
          : "ComfyUI settings saved; workflow placeholders are incomplete"
      );
    } catch (error) {
      setStatus(`Could not save ComfyUI settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const testComfyUiConnection = async () => {
    setComfyUiConnectionStatus("");
    try {
      const result = await aiClient.testComfyUiConnection(comfyUiServerUrl);
      setComfyUiConnectionStatus(result.message);
      setStatus(result.message);
    } catch (error) {
      const message = `ComfyUI connection failed: ${error instanceof Error ? error.message : String(error)}`;
      setComfyUiConnectionStatus(message);
      setStatus(message);
    }
  };

  return {
    providerName,
    setProviderName,
    openAiModel,
    setOpenAiModel,
    seedreamModel,
    setSeedreamModel,
    openAiApiKeyDraft,
    setOpenAiApiKeyDraft,
    seedreamApiKeyDraft,
    setSeedreamApiKeyDraft,
    comfyUiServerUrl,
    setComfyUiServerUrl,
    comfyUiWorkflowJson,
    setComfyUiWorkflowJson,
    comfyUiTimeoutMs,
    setComfyUiTimeoutMs,
    comfyUiConnectionStatus,
    apiKeyStatus,
    currentModel,
    currentGenerationSettings,
    providerSettings,
    comfyUiDraftStatus,
    saveOpenAiApiKey,
    clearOpenAiApiKey,
    saveSeedreamApiKey,
    clearSeedreamApiKey,
    saveComfyUiSettings,
    testComfyUiConnection
  };
};
