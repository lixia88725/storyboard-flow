import {
  aiProviderApiKeyStatusLabel,
  type AiProviderName,
  isAiApiKeyDraftSaveable
} from "./aiSettingsState";

type AiApiKeyStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
  hasValidComfyUiSettings: boolean;
};

type AiProviderSettingsVisibility = {
  showOpenAi: boolean;
  showSeedream: boolean;
  showComfyUi: boolean;
  showModel: boolean;
};

type AiProviderSettingsSectionProps = {
  apiKeyStatus: AiApiKeyStatus;
  comfyUiConnectionStatus: string;
  comfyUiDraftStatus: { ok: boolean; message: string };
  comfyUiServerUrl: string;
  comfyUiTimeoutMs: number;
  comfyUiWorkflowJson: string;
  currentModel: string;
  openAiApiKeyDraft: string;
  providerName: AiProviderName;
  providerSettings: AiProviderSettingsVisibility;
  seedreamApiKeyDraft: string;
  clearOpenAiApiKey: () => Promise<void>;
  clearSeedreamApiKey: () => Promise<void>;
  saveComfyUiSettings: () => Promise<void>;
  saveOpenAiApiKey: () => Promise<void>;
  saveSeedreamApiKey: () => Promise<void>;
  setComfyUiServerUrl: (serverUrl: string) => void;
  setComfyUiTimeoutMs: (timeoutMs: number) => void;
  setComfyUiWorkflowJson: (workflowJson: string) => void;
  setOpenAiApiKeyDraft: (apiKeyDraft: string) => void;
  setOpenAiModel: (model: string) => void;
  setProviderName: (providerName: AiProviderName) => void;
  setSeedreamApiKeyDraft: (apiKeyDraft: string) => void;
  setSeedreamModel: (model: string) => void;
  testComfyUiConnection: () => Promise<void>;
};

export const aiProviderSettingsHeading = (): string => "General Settings";

export const aiProviderSelectOptions = (): { value: AiProviderName; label: string }[] => [
  { value: "openai", label: "OpenAI" },
  { value: "seedream", label: "Seedream" },
  { value: "comfyui", label: "ComfyUI" }
];

export const aiProviderModelFieldLabel = (providerName: AiProviderName): string =>
  providerName === "seedream" ? "Seedream Model / Endpoint ID" : "OpenAI Model";

export const AiProviderSettingsSection = ({
  apiKeyStatus,
  comfyUiConnectionStatus,
  comfyUiDraftStatus,
  comfyUiServerUrl,
  comfyUiTimeoutMs,
  comfyUiWorkflowJson,
  currentModel,
  openAiApiKeyDraft,
  providerName,
  providerSettings,
  seedreamApiKeyDraft,
  clearOpenAiApiKey,
  clearSeedreamApiKey,
  saveComfyUiSettings,
  saveOpenAiApiKey,
  saveSeedreamApiKey,
  setComfyUiServerUrl,
  setComfyUiTimeoutMs,
  setComfyUiWorkflowJson,
  setOpenAiApiKeyDraft,
  setOpenAiModel,
  setProviderName,
  setSeedreamApiKeyDraft,
  setSeedreamModel,
  testComfyUiConnection
}: AiProviderSettingsSectionProps) => (
  <section className="ai-panel-section ai-settings-panel">
    <h3>{aiProviderSettingsHeading()}</h3>
    <div className="ai-settings-fields">
      <label className="ai-setting-row">
        <span>Provider</span>
        <select
          value={providerName}
          onChange={(event) => setProviderName(event.target.value as AiProviderName)}
        >
          {aiProviderSelectOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {providerSettings.showOpenAi ? (
        <>
          <label className="ai-setting-row">
            <span>OpenAI API Key</span>
            <input
              type="password"
              value={openAiApiKeyDraft}
              onChange={(event) => setOpenAiApiKeyDraft(event.target.value)}
              onFocus={(event) => {
                if (!isAiApiKeyDraftSaveable(openAiApiKeyDraft) && apiKeyStatus.hasOpenAiApiKey) {
                  event.currentTarget.select();
                }
              }}
              placeholder="Paste OpenAI API key"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="ai-settings-actions">
            <span className="ai-setting-status">{aiProviderApiKeyStatusLabel("openai", apiKeyStatus)}</span>
            <button
              type="button"
              onClick={() => void saveOpenAiApiKey()}
              disabled={!isAiApiKeyDraftSaveable(openAiApiKeyDraft)}
            >
              Save Key
            </button>
            <button
              type="button"
              onClick={() => void clearOpenAiApiKey()}
              disabled={!apiKeyStatus.hasOpenAiApiKey}
            >
              Clear
            </button>
          </div>
        </>
      ) : null}
      {providerSettings.showSeedream ? (
        <>
          <label className="ai-setting-row">
            <span>Seedream API Key</span>
            <input
              type="password"
              value={seedreamApiKeyDraft}
              onChange={(event) => setSeedreamApiKeyDraft(event.target.value)}
              onFocus={(event) => {
                if (!isAiApiKeyDraftSaveable(seedreamApiKeyDraft) && apiKeyStatus.hasSeedreamApiKey) {
                  event.currentTarget.select();
                }
              }}
              placeholder="Paste Seedream API key"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="ai-settings-actions">
            <span className="ai-setting-status">{aiProviderApiKeyStatusLabel("seedream", apiKeyStatus)}</span>
            <button
              type="button"
              onClick={() => void saveSeedreamApiKey()}
              disabled={!isAiApiKeyDraftSaveable(seedreamApiKeyDraft)}
            >
              Save Key
            </button>
            <button
              type="button"
              onClick={() => void clearSeedreamApiKey()}
              disabled={!apiKeyStatus.hasSeedreamApiKey}
            >
              Clear
            </button>
          </div>
        </>
      ) : null}
      {providerSettings.showComfyUi ? (
        <>
          <label className="ai-setting-row">
            <span>ComfyUI Server URL</span>
            <input
              type="text"
              value={comfyUiServerUrl}
              onChange={(event) => setComfyUiServerUrl(event.target.value)}
              placeholder="http://127.0.0.1:8188"
              spellCheck={false}
            />
          </label>
          <label className="ai-setting-row">
            <span>Timeout (ms)</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={comfyUiTimeoutMs}
              onChange={(event) =>
                setComfyUiTimeoutMs(Math.max(1000, Math.round(Number(event.target.value) || 1000)))
              }
            />
          </label>
          <label className="ai-setting-row ai-setting-row-tall">
            <span>API Workflow JSON</span>
            <textarea
              value={comfyUiWorkflowJson}
              onChange={(event) => setComfyUiWorkflowJson(event.target.value)}
              placeholder="Paste ComfyUI API workflow JSON with __SBF_PROMPT__ and __SBF_IMAGE_1__"
              spellCheck={false}
            />
          </label>
          <div className="ai-settings-actions">
            <span className="ai-setting-status">
              {comfyUiConnectionStatus || aiProviderApiKeyStatusLabel("comfyui", apiKeyStatus)}
            </span>
            <button type="button" onClick={() => void testComfyUiConnection()}>
              Test Connection
            </button>
            <button type="button" onClick={() => void saveComfyUiSettings()}>
              Save Settings
            </button>
          </div>
          <p className={`ai-setting-note ${comfyUiDraftStatus.ok ? "is-ready" : ""}`}>
            {comfyUiDraftStatus.message}
          </p>
        </>
      ) : null}
      {providerSettings.showModel ? (
        <label className="ai-setting-row">
          <span>{aiProviderModelFieldLabel(providerName)}</span>
          <input
            type="text"
            value={currentModel}
            onChange={(event) =>
              providerName === "seedream"
                ? setSeedreamModel(event.target.value)
                : setOpenAiModel(event.target.value)
            }
            spellCheck={false}
          />
        </label>
      ) : null}
    </div>
  </section>
);
