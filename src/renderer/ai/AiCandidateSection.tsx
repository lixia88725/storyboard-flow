export type AiCandidateSectionMode = "single" | "batch";

type AiCandidatePreview = {
  id: string;
  filePath: string;
};

type AiCandidateGroup = {
  index: number;
  error?: string;
};

type AiCandidateSectionProps = {
  mode: AiCandidateSectionMode;
  singleCandidate?: AiCandidatePreview;
  batchCandidates: AiCandidatePreview[];
  batchGroups: AiCandidateGroup[];
  hasActiveCandidate: boolean;
  canGenerate: boolean;
  assetUrl: (filePath: string) => string;
  onGenerate: () => void;
  onApply: () => void;
  onDiscard: () => void;
};

export const aiCandidateEmptyMessage = (mode: AiCandidateSectionMode): string =>
  mode === "batch"
    ? "Generate batch candidates, then apply them as new AI Draft layers."
    : "Generate one candidate, then apply it as a new AI Draft layer.";

export const aiCandidateActionLabels = (
  mode: AiCandidateSectionMode
): { apply: string; discard: string } => ({
  apply: mode === "batch" ? "Apply All" : "Apply",
  discard: mode === "batch" ? "Discard All" : "Discard"
});

export const AiCandidateSection = ({
  mode,
  singleCandidate,
  batchCandidates,
  batchGroups,
  hasActiveCandidate,
  canGenerate,
  assetUrl,
  onGenerate,
  onApply,
  onDiscard
}: AiCandidateSectionProps) => {
  const actionLabels = aiCandidateActionLabels(mode);
  const failedGroups = batchGroups.filter((group) => group.error);

  return (
    <section className="ai-panel-section">
      <h3>Candidate</h3>
      {mode === "single" && singleCandidate ? (
        <img className="ai-candidate-preview" src={assetUrl(singleCandidate.filePath)} alt="" />
      ) : mode === "batch" && batchCandidates.length > 0 ? (
        <div className="ai-batch-candidate-list">
          {batchCandidates.map((item) => (
            <img key={item.id} src={assetUrl(item.filePath)} alt="" />
          ))}
        </div>
      ) : (
        <p className="ai-empty-state">{aiCandidateEmptyMessage(mode)}</p>
      )}
      {failedGroups.length > 0 ? (
        <div className="ai-batch-errors">
          {failedGroups.map((group) => (
            <p key={group.index}>Group {group.index + 1} failed: {group.error}</p>
          ))}
        </div>
      ) : null}
      <div className="ai-actions">
        <button type="button" onClick={onGenerate} disabled={!canGenerate}>
          {hasActiveCandidate ? "Retry" : "Generate"}
        </button>
        <button type="button" onClick={onApply} disabled={!hasActiveCandidate}>
          {actionLabels.apply}
        </button>
        <button type="button" onClick={onDiscard} disabled={!hasActiveCandidate}>
          {actionLabels.discard}
        </button>
      </div>
    </section>
  );
};
