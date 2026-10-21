import type { OwnedStageRetryResult, OwnedStageRetrySelector } from '../shared/ownedStageRetry.js';

/** Explicit invocation/confirmation port. Permission, observed caller binding
 * and native fresh-FD checks remain in the actual prepared-save controller. */
export const createOwnedStageRetryService = <E>(ports: {
  verify: (event: E, selector: OwnedStageRetrySelector) => Promise<{ verified: true }>;
  confirm: (event: E, selector: OwnedStageRetrySelector) => Promise<boolean>;
  cleanup: (event: E, selector: OwnedStageRetrySelector, onDispatch: () => void) => Promise<OwnedStageRetryResult>;
}) => {
  let pending = false;
  return {
  request: async (event: E, raw: unknown): Promise<OwnedStageRetryResult> => {
    if (pending) return { status: 'busy', cleanupOutcome: 'not-started', auditOutcome: 'not-started', callerValidity: 'unknown' };
    pending = true;
    let dispatched = false;
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'binding,failedVersion') throw new Error('Only an observed failed-version selector is accepted');
      const p = raw as Record<string, unknown>;
      if (![p.binding, p.failedVersion].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)) throw new Error('Invalid observed failed-version selector');
      const selector = { binding: p.binding as string, failedVersion: p.failedVersion as string };
      if ((await ports.verify(event, selector)).verified !== true) throw new Error('Original publication not verified');
      if (await ports.confirm(event, selector) !== true) return { status: 'cancelled', cleanupOutcome: 'not-started', auditOutcome: 'not-started', callerValidity: 'unknown' };
      return await ports.cleanup(event, selector, () => { dispatched = true; });
    } catch (error) {
      return { status: dispatched ? 'unknown' : 'refused', cleanupOutcome: dispatched ? 'unknown' : 'not-started', auditOutcome: dispatched ? 'unknown' : 'not-started', callerValidity: 'unknown', error: error instanceof Error ? error.message : String(error) };
    } finally { pending = false; }
  }
  };
};
