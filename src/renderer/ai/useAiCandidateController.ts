import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import type { AiDraftClient } from "./aiClient";
import type { AiPanelSelectionState } from "./aiPanelState";

export type AiCandidate = Awaited<ReturnType<AiDraftClient["generateCandidate"]>>;
type AiGenerationSettings = Parameters<AiDraftClient["generateCandidate"]>[0]["generationSettings"];

export const hasAiCandidate = (candidate: AiCandidate | undefined): boolean => Boolean(candidate);

export const aiCandidateResetKey = ({
  folderPath,
  selectedShotIds
}: {
  folderPath: string;
  selectedShotIds: string[];
}): string => [folderPath, ...selectedShotIds].join("|");

export const aiCandidateApplySuccessStatus = (): string => "AI Draft layer added";

export const useAiCandidateController = ({
  aiClient,
  folderPath,
  generationSettings,
  project,
  selectedResourceIds,
  selectedShotIds,
  selection,
  setIsGenerating,
  setStatus,
  onProjectChange
}: {
  aiClient: AiDraftClient;
  folderPath: string;
  generationSettings: AiGenerationSettings;
  project: Project;
  selectedResourceIds: string[];
  selectedShotIds: string[];
  selection: AiPanelSelectionState;
  setIsGenerating: (isGenerating: boolean) => void;
  setStatus: (status: string) => void;
  onProjectChange: (project: Project, status: string) => void;
}) => {
  const [candidate, setCandidate] = useState<AiCandidate | undefined>();
  const resetKey = aiCandidateResetKey({ folderPath, selectedShotIds });

  useEffect(() => {
    setCandidate(undefined);
  }, [resetKey]);

  const clearCandidate = () => {
    setCandidate(undefined);
  };

  const generateCandidate = async () => {
    if (selection.kind !== "ready") {
      return;
    }
    setIsGenerating(true);
    setStatus("Generating AI candidate...");
    try {
      const nextCandidate = await aiClient.generateCandidate({
        folderPath,
        project,
        shotId: selection.shot.id,
        selectedResourceIds,
        generationSettings
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
      await aiClient.copyRequestPreview({
        folderPath,
        project,
        shotId: selection.shot.id,
        selectedResourceIds,
        generationSettings
      });
      setStatus("AI request preview copied");
    } catch (error) {
      setStatus(`Could not copy AI request preview: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const discardCandidate = async () => {
    if (!candidate) {
      return;
    }
    await aiClient.discardCandidate(folderPath, candidate.id).catch(() => undefined);
    setCandidate(undefined);
    setStatus("AI candidate discarded");
  };

  const applyCandidate = async () => {
    if (!candidate) {
      return;
    }
    try {
      const result = await aiClient.applyCandidate({
        folderPath,
        project,
        candidateId: candidate.id
      });
      onProjectChange(result.project, aiCandidateApplySuccessStatus());
      setCandidate(undefined);
      setStatus(aiCandidateApplySuccessStatus());
    } catch (error) {
      setStatus(`Could not apply AI candidate: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    applyCandidate,
    candidate,
    clearCandidate,
    copyRequestPreview,
    discardCandidate,
    generateCandidate,
    hasCandidate: hasAiCandidate(candidate)
  };
};
