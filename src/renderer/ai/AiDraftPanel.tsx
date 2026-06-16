import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../shared/types";
import { groupAiBatchShotIds, summarizeAiBatchGroups } from "../../shared/ai/batch";
import { CloseIcon, CopyIcon, SettingsIcon } from "../icons";
import {
  aiPanelSelectionState,
  aiShotNumberLabel,
  canCopyAiRequestPreview,
  nextAiEditableDialogueProject,
  nextAiEditableScriptProject,
  visibleAiStatusMessage
} from "./aiPanelState";
import {
  aiProviderApiKeyStatusLabel,
  type AiProviderName,
  canRequestAiGeneration,
  nextAiSettingsPanelOpen,
  isAiApiKeyDraftSaveable
} from "./aiSettingsState";
import { windowAiClient, type AiDraftClient } from "./aiClient";
import { useAiDraftController } from "./useAiDraftController";
import { useAiCandidateController } from "./useAiCandidateController";
import { useAiBatchGenerationController } from "./useAiBatchGenerationController";
import { useAiResourcesController } from "./useAiResourcesController";
import { AiCandidateSection } from "./AiCandidateSection";

type AiDraftPanelProps = {
  isOpen: boolean;
  folderPath: string;
  project: Project;
  selectedShotIds: string[];
  onProjectChange: (project: Project, status: string) => void;
  client?: AiDraftClient;
};

const referenceRoles = [
  "Reference image",
  "Character reference",
  "Scene reference",
  "Style reference",
  "Prop reference"
];

export const AiDraftPanel = ({
  isOpen,
  folderPath,
  project,
  selectedShotIds,
  onProjectChange,
  client
}: AiDraftPanelProps) => {
  const aiClient = useMemo(() => client ?? windowAiClient(), [client]);
  const selection = useMemo(
    () => aiPanelSelectionState(project, selectedShotIds),
    [project, selectedShotIds]
  );
  const [status, setStatus] = useState("Ready");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    providerName,
    setProviderName,
    setOpenAiModel,
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
  } = useAiDraftController({ aiClient, isOpen, setStatus });
  const {
    activeResourceIds,
    batchResourceAssignments,
    batchSelectedResourceIds,
    deleteResource,
    importDroppedResources,
    isAssignmentOpen,
    isResourceDropActive,
    resources,
    setIsAssignmentOpen,
    setIsResourceDropActive,
    toggleAssignmentResource,
    toggleResource,
    updateResource
  } = useAiResourcesController({
    aiClient,
    folderPath,
    isOpen,
    project,
    selection,
    onProjectChange,
    setStatus
  });
  const {
    applyCandidate: applySingleCandidate,
    candidate,
    clearCandidate,
    copyRequestPreview: copySingleRequestPreview,
    discardCandidate: discardSingleCandidate,
    generateCandidate: generateSingleCandidate,
    hasCandidate
  } = useAiCandidateController({
    aiClient,
    folderPath,
    generationSettings: currentGenerationSettings,
    project,
    selectedResourceIds: activeResourceIds,
    selectedShotIds,
    selection,
    setIsGenerating,
    setStatus,
    onProjectChange
  });
  const {
    applyBatchCandidates,
    batchCandidates,
    batchGroups,
    batchShotIds,
    clearBatchCandidates,
    copyBatchRequestPreview,
    discardBatchCandidates,
    generateBatchCandidates,
    hasBatchCandidates
  } = useAiBatchGenerationController({
    aiClient,
    clearSingleCandidate: clearCandidate,
    folderPath,
    generationSettings: currentGenerationSettings,
    project,
    resourceAssignments: batchResourceAssignments,
    selectedResourceIds: batchSelectedResourceIds,
    selectedShotIds,
    selection,
    setIsGenerating,
    setStatus,
    onProjectChange
  });
  const visibleStatus = visibleAiStatusMessage(status);
  const canCopyRequestPreview = canCopyAiRequestPreview(selection);
  const plannedBatchGroups = useMemo(
    () => (selection.kind === "multi" ? groupAiBatchShotIds(project, batchShotIds) : []),
    [batchShotIds.join("|"), project, selection.kind]
  );
  const batchSummary =
    selection.kind === "multi" ? summarizeAiBatchGroups(selection.shots.length, plannedBatchGroups) : "";
  const isAiContentVisible = selection.kind === "ready" || selection.kind === "multi";
  const canGenerateForSelection =
    canRequestAiGeneration({ ...apiKeyStatus, provider: providerName, isGenerating }) &&
    (selection.kind === "ready" || (selection.kind === "multi" && selection.shots.length > 0));
  const hasActiveCandidate =
    selection.kind === "multi" ? hasBatchCandidates : hasCandidate;

  useEffect(() => {
    clearBatchCandidates();
    setStatus("Ready");
  }, [folderPath, selectedShotIds.join("|")]);

  const updateProjectContext = (projectContext: string) => {
    onProjectChange(
      {
        ...project,
        ai: {
          ...project.ai,
          projectContext
        }
      },
      "AI project context updated"
    );
  };

  const updateShotScript = (shotId: string, scriptText: string) => {
    onProjectChange(
      nextAiEditableScriptProject(project, shotId, scriptText),
      "AI shot script updated"
    );
  };

  const updateShotDialogue = (shotId: string, dialogueText: string) => {
    onProjectChange(
      nextAiEditableDialogueProject(project, shotId, dialogueText),
      "AI shot dialogue updated"
    );
  };

  const generate = async () => {
    if (selection.kind === "multi") {
      await generateBatchCandidates();
      return;
    }

    await generateSingleCandidate();
  };

  const copyRequestPreview = async () => {
    if (selection.kind === "multi") {
      await copyBatchRequestPreview();
      return;
    }

    await copySingleRequestPreview();
  };

  const discardCandidate = async () => {
    if (selection.kind === "multi") {
      await discardBatchCandidates();
      return;
    }

    await discardSingleCandidate();
  };

  const applyCandidate = async () => {
    if (selection.kind === "multi") {
      await applyBatchCandidates();
      return;
    }

    await applySingleCandidate();
  };

  return (
    <aside className={`ai-draft-panel ${isOpen ? "is-open" : ""}`} aria-label="AI Draft panel">
      <header className="ai-draft-panel-header">
        <div>
          <span>
            {selection.kind === "ready"
              ? selection.shot.fileName
              : selection.kind === "multi"
                ? `${selection.shots.length} selected shots`
                : "Select one storyboard"}
          </span>
          {selection.kind === "multi" ? <small>{batchSummary}</small> : null}
        </div>
        <button
          type="button"
          className={`ai-settings-toggle ${isSettingsOpen ? "selected" : ""}`}
          aria-label="Toggle AI General Settings"
          aria-expanded={isSettingsOpen}
          title="General Settings"
          onClick={() => setIsSettingsOpen((isOpen) => nextAiSettingsPanelOpen(isOpen))}
        >
          <SettingsIcon />
        </button>
      </header>

      <div className="ai-draft-panel-content">
        {isSettingsOpen ? (
          <section className="ai-panel-section ai-settings-panel">
            <h3>General Settings</h3>
            <div className="ai-settings-fields">
              <label className="ai-setting-row">
                <span>Provider</span>
                <select
                  value={providerName}
                  onChange={(event) => setProviderName(event.target.value as AiProviderName)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="seedream">Seedream</option>
                  <option value="comfyui">ComfyUI</option>
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
                  <span>{providerName === "seedream" ? "Seedream Model / Endpoint ID" : "OpenAI Model"}</span>
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
        ) : null}

        {selection.kind === "empty" ? <p className="ai-empty-state">Select one storyboard to generate an AI draft.</p> : null}
        {selection.kind === "multi" && selection.shots.length === 0 ? (
          <p className="ai-empty-state">The selected storyboards could not be found.</p>
        ) : null}
        {selection.kind === "missing" ? <p className="ai-empty-state">The selected storyboard could not be found.</p> : null}

        {isAiContentVisible ? (
          <section className="ai-panel-section">
            <h3>Project Additional Context</h3>
            <textarea
              value={project.ai?.projectContext ?? ""}
              onChange={(event) => updateProjectContext(event.target.value)}
              placeholder="Style, story rules, recurring character notes..."
            />
          </section>
        ) : null}

        {selection.kind === "ready" ? (
          <section className="ai-panel-section">
            <label className="ai-shot-edit-field">
              <span>Script</span>
              <textarea
                value={selection.scriptText}
                onChange={(event) => updateShotScript(selection.shot.id, event.target.value)}
                placeholder="No script text"
              />
            </label>
            <label className="ai-shot-edit-field">
              <span>Dialogue</span>
              <textarea
                value={selection.dialogueText}
                onChange={(event) => updateShotDialogue(selection.shot.id, event.target.value)}
                placeholder="No dialogue"
              />
            </label>
          </section>
        ) : null}

        {isAiContentVisible ? (
          <>
            {selection.kind === "ready" ? (
              <section
                className={`ai-panel-section ai-resources-section ${isResourceDropActive ? "is-drop-active" : ""}`}
                onDragEnter={(event) => {
                  if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                    setIsResourceDropActive(true);
                  }
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setIsResourceDropActive(true);
                  }
                }}
                onDragLeave={() => setIsResourceDropActive(false)}
                onDrop={(event) => void importDroppedResources(event)}
              >
                <h3>AI Resources</h3>
                {resources.length === 0 ? (
                  <p className="ai-empty-state">Drop reference images here to add them to AI Resources.</p>
                ) : (
                  <div className="ai-resource-list">
                    {resources.map((resource) => (
                      <article key={resource.id} className="ai-resource-card">
                        <button
                          type="button"
                          className="ai-resource-delete"
                          aria-label={`Delete ${resource.fileName}`}
                          title="Delete resource"
                          onClick={() => void deleteResource(resource)}
                        >
                          <CloseIcon />
                        </button>
                        <label className="ai-resource-select">
                          <input
                            type="checkbox"
                            checked={activeResourceIds.includes(resource.id)}
                            onChange={() => toggleResource(resource.id)}
                          />
                          <img src={aiClient.assetUrl(resource.filePath)} alt="" />
                          <span>{resource.fileName}</span>
                        </label>
                        <div className="ai-resource-details">
                          <select
                            value={resource.role}
                            onChange={(event) => updateResource(resource.fileName, { role: event.target.value })}
                          >
                            {referenceRoles.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={resource.note}
                            onChange={(event) => updateResource(resource.fileName, { note: event.target.value })}
                            placeholder="How should the model use this image?"
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {selection.kind === "multi" ? (
              <section className="ai-resource-assignment">
                  <button
                    type="button"
                    className="ai-assignment-toggle"
                    aria-expanded={isAssignmentOpen}
                    onClick={() => setIsAssignmentOpen((isOpen) => !isOpen)}
                  >
                    <span>Shot Resource Assignment</span>
                    <span
                      className={`ai-assignment-toggle-icon ${isAssignmentOpen ? "is-open" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {isAssignmentOpen ? (
                    <div className="ai-assignment-list">
                      {selection.shots.map((shot) => {
                        const availableResourceIds = batchResourceAssignments[shot.id] ?? [];
                        return (
                          <article key={shot.id} className="ai-assignment-card">
                            <div className="ai-assignment-card-header">
                              <span>{aiShotNumberLabel(project, shot.id)}</span>
                              <span>
                                {availableResourceIds.length} / {resources.length} references
                              </span>
                            </div>
                            {resources.length > 0 ? (
                              <div className="ai-assignment-resources">
                                {resources.map((resource) => (
                                  <label key={resource.id}>
                                    <input
                                      type="checkbox"
                                      checked={availableResourceIds.includes(resource.id)}
                                      onChange={() => toggleAssignmentResource(shot.id, resource.id)}
                                    />
                                    <span>{resource.fileName}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <p className="ai-empty-state">
                                Drop reference images into AI Resources from a single shot.
                              </p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
              </section>
            ) : null}

            <AiCandidateSection
              mode={selection.kind === "multi" ? "batch" : "single"}
              singleCandidate={candidate}
              batchCandidates={batchCandidates}
              batchGroups={batchGroups}
              hasActiveCandidate={hasActiveCandidate}
              canGenerate={canGenerateForSelection}
              assetUrl={aiClient.assetUrl}
              onGenerate={() => void generate()}
              onApply={() => void applyCandidate()}
              onDiscard={() => void discardCandidate()}
            />
          </>
        ) : null}
      </div>

      {visibleStatus ? (
        <footer className="ai-draft-panel-status" role="status">
          {visibleStatus}
        </footer>
      ) : null}

      <button
        type="button"
        className="ai-request-preview-copy"
        aria-label="Copy AI request preview"
        title="Copy AI request preview"
        disabled={!canCopyRequestPreview}
        onClick={() => void copyRequestPreview()}
      >
        <CopyIcon />
      </button>
    </aside>
  );
};
