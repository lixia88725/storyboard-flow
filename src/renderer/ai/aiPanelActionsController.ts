type AiPanelMode = "single" | "batch";

type SingleAiActions = {
  applyCandidate: () => Promise<void>;
  copyRequestPreview: () => Promise<void>;
  discardCandidate: () => Promise<void>;
  generateCandidate: () => Promise<void>;
  hasCandidate: boolean;
};

type BatchAiActions = {
  applyBatchCandidates: () => Promise<void>;
  copyBatchRequestPreview: () => Promise<void>;
  discardBatchCandidates: () => Promise<void>;
  generateBatchCandidates: () => Promise<void>;
  hasBatchCandidates: boolean;
};

export const hasActiveAiCandidate = ({
  mode,
  hasBatchCandidates,
  hasCandidate
}: {
  mode: AiPanelMode;
  hasBatchCandidates: boolean;
  hasCandidate: boolean;
}): boolean => (mode === "batch" ? hasBatchCandidates : hasCandidate);

export const createAiPanelActions = ({
  mode,
  single,
  batch
}: {
  mode: AiPanelMode;
  single: SingleAiActions;
  batch: BatchAiActions;
}) => ({
  applyCandidate: () =>
    mode === "batch" ? batch.applyBatchCandidates() : single.applyCandidate(),
  copyRequestPreview: () =>
    mode === "batch" ? batch.copyBatchRequestPreview() : single.copyRequestPreview(),
  discardCandidate: () =>
    mode === "batch" ? batch.discardBatchCandidates() : single.discardCandidate(),
  generate: () =>
    mode === "batch" ? batch.generateBatchCandidates() : single.generateCandidate()
});
