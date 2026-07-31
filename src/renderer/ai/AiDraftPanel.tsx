import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../shared/types";
import {
  defaultAiBatchSize,
  groupAiBatchShotIds,
  summarizeAiBatchGroups,
  type AiBatchSize
} from "../../shared/ai/batch";
import { CopyIcon, SettingsIcon } from "../icons";
import {
  aiPanelSelectionState,
  aiShotNumberLabel,
  canCopyAiRequestPreview,
  nextAiEditableDialogueProject,
  nextAiEditableScriptProject,
  visibleAiStatusMessage
} from "./aiPanelState";
import {
  canRequestAiGeneration,
  nextAiSettingsPanelOpen
} from "./aiSettingsState";
import { windowAiClient, type AiDraftClient } from "./aiClient";
import { useAiDraftController } from "./useAiDraftController";
import { useAiCandidateController, type AiCandidate } from "./useAiCandidateController";
import { useAiBatchGenerationController } from "./useAiBatchGenerationController";
import { useAiResourcesController } from "./useAiResourcesController";
import { AiCandidateSection } from "./AiCandidateSection";
import { AiProviderSettingsSection } from "./AiProviderSettingsSection";
import { AiResourcesSection } from "./AiResourcesSection";
import {
  createAiPanelActions,
  hasActiveAiCandidate
} from "./aiPanelActionsController";

type AiDraftPanelProps = {
  isOpen: boolean;
  folderPath: string;
  project: Project;
  selectedShotIds: string[];
  onCandidatesDiscarded?: (candidateIds: string[]) => void;
  onCandidatesGenerated?: (candidates: AiCandidate[]) => void;
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

const aiBatchSizeOptions: AiBatchSize[] = [1, 4, 16];

export const AiDraftPanel = ({
  isOpen,
  folderPath,
  project,
  selectedShotIds,
  onCandidatesDiscarded,
  onCandidatesGenerated,
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
  const [batchSize, setBatchSize] = useState<AiBatchSize>(defaultAiBatchSize);
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
    onCandidatesDiscarded,
    onCandidatesGenerated,
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
    batchSize,
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
    onCandidatesDiscarded,
    onCandidatesGenerated,
    onProjectChange
  });
  const visibleStatus = visibleAiStatusMessage(status);
  const canCopyRequestPreview = canCopyAiRequestPreview(selection);
  const plannedBatchGroups = useMemo(
    () => (selection.kind === "multi" ? groupAiBatchShotIds(project, batchShotIds, batchSize) : []),
    [batchShotIds.join("|"), batchSize, project, selection.kind]
  );
  const batchSummary =
    selection.kind === "multi" ? summarizeAiBatchGroups(selection.shots.length, plannedBatchGroups) : "";
  const isAiContentVisible = selection.kind === "ready" || selection.kind === "multi";
  const canGenerateForSelection =
    canRequestAiGeneration({ ...apiKeyStatus, provider: providerName, isGenerating }) &&
    (selection.kind === "ready" || (selection.kind === "multi" && selection.shots.length > 0));
  const aiPanelActionMode = selection.kind === "multi" ? "batch" : "single";
  const hasActiveCandidate = hasActiveAiCandidate({
    mode: aiPanelActionMode,
    hasBatchCandidates,
    hasCandidate
  });
  const aiPanelActions = useMemo(
    () =>
      createAiPanelActions({
        mode: aiPanelActionMode,
        single: {
          applyCandidate: applySingleCandidate,
          copyRequestPreview: copySingleRequestPreview,
          discardCandidate: discardSingleCandidate,
          generateCandidate: generateSingleCandidate,
          hasCandidate
        },
        batch: {
          applyBatchCandidates,
          copyBatchRequestPreview,
          discardBatchCandidates,
          generateBatchCandidates,
          hasBatchCandidates
        }
      }),
    [
      aiPanelActionMode,
      applyBatchCandidates,
      applySingleCandidate,
      copyBatchRequestPreview,
      copySingleRequestPreview,
      discardBatchCandidates,
      discardSingleCandidate,
      generateBatchCandidates,
      generateSingleCandidate,
      hasBatchCandidates,
      hasCandidate
    ]
  );

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

  return (
    <aside className={`ai-draft-panel ${isOpen ? "is-open" : ""}`} aria-label="AI Draft panel">
      <header className="ai-draft-panel-header">
        <div className="ai-draft-panel-header-main">
          <div className="ai-draft-panel-title">
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
        </div>
        {selection.kind === "multi" ? (
          <div className="ai-batch-size-row">
            <span>Batch Size</span>
            <div className="ai-batch-size-control" role="group" aria-label="AI batch size">
              {aiBatchSizeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={batchSize === option ? "selected" : ""}
                  aria-pressed={batchSize === option}
                  disabled={isGenerating}
                  onClick={() => setBatchSize(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <div className="ai-draft-panel-content">
        {isSettingsOpen ? (
          <AiProviderSettingsSection
            apiKeyStatus={apiKeyStatus}
            comfyUiConnectionStatus={comfyUiConnectionStatus}
            comfyUiDraftStatus={comfyUiDraftStatus}
            comfyUiServerUrl={comfyUiServerUrl}
            comfyUiTimeoutMs={comfyUiTimeoutMs}
            comfyUiWorkflowJson={comfyUiWorkflowJson}
            currentModel={currentModel}
            openAiApiKeyDraft={openAiApiKeyDraft}
            providerName={providerName}
            providerSettings={providerSettings}
            seedreamApiKeyDraft={seedreamApiKeyDraft}
            clearOpenAiApiKey={clearOpenAiApiKey}
            clearSeedreamApiKey={clearSeedreamApiKey}
            saveComfyUiSettings={saveComfyUiSettings}
            saveOpenAiApiKey={saveOpenAiApiKey}
            saveSeedreamApiKey={saveSeedreamApiKey}
            setComfyUiServerUrl={setComfyUiServerUrl}
            setComfyUiTimeoutMs={setComfyUiTimeoutMs}
            setComfyUiWorkflowJson={setComfyUiWorkflowJson}
            setOpenAiApiKeyDraft={setOpenAiApiKeyDraft}
            setOpenAiModel={setOpenAiModel}
            setProviderName={setProviderName}
            setSeedreamApiKeyDraft={setSeedreamApiKeyDraft}
            setSeedreamModel={setSeedreamModel}
            testComfyUiConnection={testComfyUiConnection}
          />
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
            <AiResourcesSection
              activeResourceIds={activeResourceIds}
              assetUrl={aiClient.assetUrl}
              batchResourceAssignments={batchResourceAssignments}
              deleteResource={(resource) => void deleteResource(resource)}
              importDroppedResources={(event) => void importDroppedResources(event)}
              isAssignmentOpen={isAssignmentOpen}
              isResourceDropActive={isResourceDropActive}
              referenceRoles={referenceRoles}
              resources={resources}
              selection={selection}
              setIsAssignmentOpen={setIsAssignmentOpen}
              setIsResourceDropActive={setIsResourceDropActive}
              shotNumberLabel={(shotId) => aiShotNumberLabel(project, shotId)}
              toggleAssignmentResource={toggleAssignmentResource}
              toggleResource={toggleResource}
              updateResource={updateResource}
            />

            <AiCandidateSection
              mode={selection.kind === "multi" ? "batch" : "single"}
              singleCandidate={candidate}
              batchCandidates={batchCandidates}
              batchGroups={batchGroups}
              hasActiveCandidate={hasActiveCandidate}
              canGenerate={canGenerateForSelection}
              assetUrl={aiClient.assetUrl}
              onGenerate={() => void aiPanelActions.generate()}
              onApply={() => void aiPanelActions.applyCandidate()}
              onDiscard={() => void aiPanelActions.discardCandidate()}
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
        onClick={() => void aiPanelActions.copyRequestPreview()}
      >
        <CopyIcon />
      </button>
    </aside>
  );
};
