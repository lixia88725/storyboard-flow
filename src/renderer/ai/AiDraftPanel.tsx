import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { Project } from "../../shared/types";
import { CloseIcon, CopyIcon, SettingsIcon } from "../icons";
import {
  aiPanelSelectionState,
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
  nextAiApiKeyDraftAfterSave,
  nextAiApiKeyDraftForStatus,
  isAiApiKeyDraftSaveable,
  visibleAiProviderSettings
} from "./aiSettingsState";

type AiResource = {
  id: string;
  fileName: string;
  filePath: string;
  role: string;
  note: string;
};

type AiCandidate = {
  id: string;
  shotId: string;
  filePath: string;
  prompt: string;
};

type AiDraftPanelProps = {
  isOpen: boolean;
  folderPath: string;
  project: Project;
  selectedShotIds: string[];
  onProjectChange: (project: Project, status: string) => void;
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
  onProjectChange
}: AiDraftPanelProps) => {
  const selection = useMemo(
    () => aiPanelSelectionState(project, selectedShotIds),
    [project, selectedShotIds]
  );
  const [resources, setResources] = useState<AiResource[]>([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<AiCandidate | undefined>();
  const [status, setStatus] = useState("Ready");
  const [isGenerating, setIsGenerating] = useState(false);
  const [providerName, setProviderName] = useState<AiProviderName>("openai");
  const [openAiModel, setOpenAiModel] = useState("gpt-image-2");
  const [seedreamModel, setSeedreamModel] = useState("doubao-seedream-5.0-lite");
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [seedreamApiKeyDraft, setSeedreamApiKeyDraft] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState({
    hasOpenAiApiKey: false,
    hasSeedreamApiKey: false
  });
  const [isResourceDropActive, setIsResourceDropActive] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const currentModel = providerName === "seedream" ? seedreamModel : openAiModel;
  const providerSettings = visibleAiProviderSettings(providerName);
  const visibleStatus = visibleAiStatusMessage(status);
  const canCopyRequestPreview = canCopyAiRequestPreview(selection);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    window.storyboard.ai
      .listResources(folderPath)
      .then((result) => {
        if (!cancelled) {
          setResources(result.resources);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(`Could not load AI Resources: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [folderPath, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    window.storyboard.ai
      .getSettings()
      .then((result) => {
        if (!cancelled) {
          setApiKeyStatus(result);
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
  }, [isOpen]);

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

  const updateResource = (fileName: string, patch: Partial<Pick<AiResource, "role" | "note">>) => {
    const nextResources = resources.map((resource) =>
      resource.fileName === fileName ? { ...resource, ...patch } : resource
    );
    setResources(nextResources);
    void window.storyboard.ai
      .updateResourceMetadata(folderPath, {
        version: 1,
        resources: nextResources.map((resource) => ({
          fileName: resource.fileName,
          role: resource.role,
          note: resource.note
        }))
      })
      .catch((error) => {
        setStatus(`Could not save AI resource notes: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const importDroppedResources = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsResourceDropActive(false);
    const sourceFilePaths = Array.from(event.dataTransfer.files)
      .map((file) => window.storyboard.filePathForDroppedFile(file))
      .filter((filePath) => filePath.trim() !== "");
    if (sourceFilePaths.length === 0) {
      return;
    }

    try {
      const result = await window.storyboard.ai.importResources(folderPath, sourceFilePaths);
      setResources(result.resources);
      setStatus(
        result.importedFileNames.length > 0
          ? `Imported ${result.importedFileNames.length} AI resource${result.importedFileNames.length === 1 ? "" : "s"}`
          : "No supported image files were dropped"
      );
    } catch (error) {
      setStatus(`Could not import AI Resources: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const deleteResource = async (resource: AiResource) => {
    try {
      const result = await window.storyboard.ai.deleteResource(folderPath, resource.fileName);
      setResources(result.resources);
      setSelectedResourceIds((current) => current.filter((id) => id !== resource.id));
      setStatus(`Deleted AI resource: ${resource.fileName}`);
    } catch (error) {
      setStatus(`Could not delete AI resource: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleResource = (resourceId: string) => {
    setSelectedResourceIds((current) =>
      current.includes(resourceId)
        ? current.filter((id) => id !== resourceId)
        : [...current, resourceId]
    );
  };

  const generate = async () => {
    if (selection.kind !== "ready") {
      return;
    }
    setIsGenerating(true);
    setStatus("Generating AI candidate...");
    try {
      const nextCandidate = await window.storyboard.ai.generateCandidate({
        folderPath,
        project,
        shotId: selection.shot.id,
        selectedResourceIds,
        generationSettings: { provider: providerName, model: currentModel }
      });
      setCandidate(nextCandidate);
      setStatus("AI candidate ready");
    } catch (error) {
      setStatus(`AI generation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyRequestPreview = async () => {
    if (selection.kind !== "ready") {
      return;
    }
    try {
      await window.storyboard.ai.copyRequestPreview({
        folderPath,
        project,
        shotId: selection.shot.id,
        selectedResourceIds,
        generationSettings: { provider: providerName, model: currentModel }
      });
      setStatus("AI request preview copied");
    } catch (error) {
      setStatus(`Could not copy AI request preview: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const saveOpenAiApiKey = async () => {
    if (!isAiApiKeyDraftSaveable(openAiApiKeyDraft)) {
      return;
    }
    try {
      const nextStatus = await window.storyboard.ai.saveOpenAiApiKey(openAiApiKeyDraft);
      setApiKeyStatus(nextStatus);
      setOpenAiApiKeyDraft(nextAiApiKeyDraftAfterSave());
      setStatus("OpenAI API key saved");
    } catch (error) {
      setStatus(`Could not save OpenAI API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearOpenAiApiKey = async () => {
    try {
      const nextStatus = await window.storyboard.ai.clearOpenAiApiKey();
      setApiKeyStatus(nextStatus);
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
      const nextStatus = await window.storyboard.ai.saveSeedreamApiKey(seedreamApiKeyDraft);
      setApiKeyStatus(nextStatus);
      setSeedreamApiKeyDraft(nextAiApiKeyDraftAfterSave());
      setStatus("Seedream API key saved");
    } catch (error) {
      setStatus(`Could not save Seedream API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearSeedreamApiKey = async () => {
    try {
      const nextStatus = await window.storyboard.ai.clearSeedreamApiKey();
      setApiKeyStatus(nextStatus);
      setSeedreamApiKeyDraft("");
      setStatus("Seedream API key cleared");
    } catch (error) {
      setStatus(`Could not clear Seedream API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const discardCandidate = async () => {
    if (!candidate) {
      return;
    }
    await window.storyboard.ai.discardCandidate(folderPath, candidate.id).catch(() => undefined);
    setCandidate(undefined);
    setStatus("AI candidate discarded");
  };

  const applyCandidate = async () => {
    if (!candidate) {
      return;
    }
    try {
      const result = await window.storyboard.ai.applyCandidate({
        folderPath,
        project,
        candidateId: candidate.id
      });
      onProjectChange(result.project, "AI Draft layer added");
      setCandidate(undefined);
      setStatus("AI Draft layer added");
    } catch (error) {
      setStatus(`Could not apply AI candidate: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <aside className={`ai-draft-panel ${isOpen ? "is-open" : ""}`} aria-label="AI Draft panel">
      <header className="ai-draft-panel-header">
        <div>
          <span>{selection.kind === "ready" ? selection.shot.fileName : "Select one storyboard"}</span>
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
        {selection.kind === "ready" ? (
          <section className="ai-panel-section">
            <h3>Project Additional Context</h3>
            <textarea
              value={project.ai?.projectContext ?? ""}
              onChange={(event) => updateProjectContext(event.target.value)}
              placeholder="Style, story rules, recurring character notes..."
            />
          </section>
        ) : null}

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
            </div>
          </section>
        ) : null}

        {selection.kind === "empty" ? <p className="ai-empty-state">Select one storyboard to generate an AI draft.</p> : null}
        {selection.kind === "multi" ? <p className="ai-empty-state">AI Draft MVP supports one selected storyboard at a time.</p> : null}
        {selection.kind === "missing" ? <p className="ai-empty-state">The selected storyboard could not be found.</p> : null}

        {selection.kind === "ready" ? (
          <>
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
                          checked={selectedResourceIds.includes(resource.id)}
                          onChange={() => toggleResource(resource.id)}
                        />
                        <img src={window.storyboard.assetUrl(resource.filePath)} alt="" />
                        <span>{resource.fileName}</span>
                      </label>
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
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="ai-panel-section">
              <h3>Candidate</h3>
              {candidate ? (
                <img className="ai-candidate-preview" src={window.storyboard.assetUrl(candidate.filePath)} alt="" />
              ) : (
                <p className="ai-empty-state">Generate one candidate, then apply it as a new AI Draft layer.</p>
              )}
              <div className="ai-actions">
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={!canRequestAiGeneration({ ...apiKeyStatus, provider: providerName, isGenerating })}
                >
                  {candidate ? "Retry" : "Generate"}
                </button>
                <button type="button" onClick={() => void applyCandidate()} disabled={!candidate}>
                  Apply
                </button>
                <button type="button" onClick={() => void discardCandidate()} disabled={!candidate}>
                  Discard
                </button>
              </div>
            </section>
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
