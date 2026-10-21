export type OwnedStageRetrySelector = { binding: string; failedVersion: string };
/** Inert outcome data, NOT a writer/Save/ACK capability. A reported repair on an
 * unknown outcome is evidence only, never permission for the next write. */
export type OwnedStageRetryResult = {
  status: 'repaired' | 'reconciled' | 'already-repaired' | 'unknown' | 'caller-invalid' | 'refused' | 'cancelled' | 'busy';
  cleanupOutcome: 'stage-removed' | 'stage-absent' | 'unknown' | 'not-started';
  auditOutcome: 'verified' | 'unknown' | 'not-started';
  callerValidity: 'valid' | 'invalid' | 'unknown';
  repair?: Record<string, unknown>;
  error?: string;
};
