import type { OwnedStageRetryResult } from '../shared/ownedStageRetry';

/** Display classification only; this never retires a failure or grants a writer. */
export const ownedStageRetryMessage = (result: OwnedStageRetryResult): string => {
  if (result.status === 'cancelled') return 'Cancelled before cleanup. Recovery remains read-only.';
  if (result.status === 'busy') return 'Another cleanup confirmation is in progress. Nothing was started by this request.';
  if (result.status === 'refused' && result.cleanupOutcome === 'not-started') return 'Cleanup was refused before dispatch. Recovery and the original failure remain unchanged.';
  if (['repaired', 'reconciled', 'already-repaired'].includes(result.status) && result.callerValidity === 'valid' && result.auditOutcome === 'verified' && ['stage-removed', 'stage-absent'].includes(result.cleanupOutcome)) return 'Verified temporary link is absent and the repair receipt was read back. Recovery remains read-only; the original failure is preserved. Save was not retried.';
  return `Cleanup is not fully confirmed.${result.repair ? ' A repair receipt was reported, but it is evidence only.' : ''} Recovery remains read-only; do not assume cleanup succeeded.`;
};
