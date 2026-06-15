import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import type { AiDraftClient } from "./aiClient";
import type { AiPanelSelectionState } from "./aiPanelState";
import type { AiCandidate } from "./useAiCandidateController";

export type AiBatchCandidate = AiCandidate;
export type AiBatchGroupResult = Awaited<ReturnType<AiDraftClient["generateBatchCandidates"]>>["groups"][number];
type AiGenerationSettings = Parameters<AiDraftClient["generateBatchCandidates"]>[0]["generationSettings"];

export const hasAiBatchCandidates = (candidates: AiBatchCandidate[]): boolean => candidates.length > 0;

export const aiBatchGenerationReadyStatus = (
  candidates: AiBatchCandidate[],
  groups: AiBatchGroupResult[]
): string => {
  const failedGroups = groups.filter((group) => group.error);
  return failedGroups.length > 0
    ? `${candidates.length} AI batch candidates ready; ${failedGroups.length} group${failedGroups.length === 1 ? "" : "s"} failed: ${failedGroups.map((group) => `#${group.index + 1}`).join(", ")}`
    : `${candidates.length} AI batch candidates ready`;
};

export const aiBatchApplySuccessStatus = (candidateCount: number): string =>
  `${candidateCount} AI Draft layers added`;

export const aiBatchGenerationResetKey = ({
  folderPath,
  selectedShotIds
}: {
  folderPath: string;
  selectedShotIds: string[];
}): string => [folderPath, ...selectedShotIds].join("|");

export const useAiBatchGenerationController = ({
  aiClient,
  clearSingleCandidate,
  folderPath,
  generationSettings,
  project,
  resourceAssignments,
  selectedResourceIds,
  selectedShotIds,
  selection,
  setIsGenerating,
  setStatus,
  onProjectChange
}: {
  aiClient: AiDraftClient;
  clearSingleCandidate: () => void;
  folderPath: string;
  generationSettings: AiGenerationSettings;
  project: Project;
  resourceAssignments: Record<string, string[]>;
  selectedResourceIds: string[];
  selectedShotIds: string[];
  selection: AiPanelSelectionState;
  setIsGenerating: (isGenerating: boolean) => void;
  setStatus: (status: string) => void;
  onProjectChange: (project: Project, status: string) => void;
}) => {
  const [batchCandidates, setBatchCandidates] = useState<AiBatchCandidate[]>([]);
  const [batchGroups, setBatchGroups] = useState<AiBatchGroupResult[]>([]);
  const resetKey = aiBatchGenerationResetKey({ folderPath, selectedShotIds });

  useEffect(() => {
    setBatchCandidates([]);
    setBatchGroups([]);
  }, [resetKey]);

  const clearBatchCandidates = () => {
    setBatchCandidates([]);
    setBatchGroups([]);
  };

  const batchShotIds = selection.kind === "multi" ? selection.shots.map((shot) => shot.id) : [];

  const generateBatchCandidates = async () => {
    if (selection.kind !== "multi" || selection.shots.length === 0) {
      return;
    }
    setIsGenerating(true);
    setStatus("Generating AI batch candidates...");
    try {
      const result = await aiClient.generateBatchCandidates({
        folderPath,
        project,
        shotIds: batchShotIds,
        selectedResourceIds,
        resourceAssignments,
        generationSettings
      });
      setBatchCandidates(result.candidates);
      setBatchGroups(result.groups);
      clearSingleCandidate();
      setStatus(aiBatchGenerationReadyStatus(result.candidates, result.groups));
    } catch (error) {
      setStatus(`AI batch generation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyBatchRequestPreview = async () => {
    if (selection.kind !== "multi" || selection.shots.length === 0) {
      return;
    }
    try {
      await aiClient.copyRequestPreview({
        folderPath,
        project,
        shotIds: batchShotIds,
        selectedResourceIds,
        resourceAssignments,
        generationSettings
      });
      setStatus("AI request preview copied");
    } catch (error) {
      setStatus(`Could not copy AI request preview: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const discardBatchCandidates = async () => {
    await Promise.all(
      batchCandidates.map((item) => aiClient.discardCandidate(folderPath, item.id).catch(() => undefined))
    );
    clearBatchCandidates();
    setStatus("AI batch candidates discarded");
  };

  const applyBatchCandidates = async () => {
    if (batchCandidates.length === 0) {
      return;
    }
    try {
      let nextProject = project;
      for (const item of batchCandidates) {
        const result = await aiClient.applyCandidate({
          folderPath,
          project: nextProject,
          candidateId: item.id
        });
        nextProject = result.project;
      }
      const status = aiBatchApplySuccessStatus(batchCandidates.length);
      onProjectChange(nextProject, status);
      clearBatchCandidates();
      setStatus(status);
    } catch (error) {
      setStatus(`Could not apply AI batch candidates: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    applyBatchCandidates,
    batchCandidates,
    batchGroups,
    batchShotIds,
    clearBatchCandidates,
    copyBatchRequestPreview,
    discardBatchCandidates,
    generateBatchCandidates,
    hasBatchCandidates: hasAiBatchCandidates(batchCandidates)
  };
};
