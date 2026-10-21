import { expect, test } from 'vitest';
import { ownedStageRetryMessage } from './ownedStageRetryDisplay';

test('a reported repair with unknown terminal/caller/audit never displays cleanup as certified or grants editing', () => {
  expect(ownedStageRetryMessage({ status: 'unknown', cleanupOutcome: 'unknown', auditOutcome: 'unknown', callerValidity: 'unknown', repair: { stageAbsent: true } })).toBe('Cleanup is not fully confirmed. A repair receipt was reported, but it is evidence only. Recovery remains read-only; do not assume cleanup succeeded.');
});
