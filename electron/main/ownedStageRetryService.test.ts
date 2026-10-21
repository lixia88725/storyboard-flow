import { expect, test } from 'vitest';
import { createOwnedStageRetryService } from './ownedStageRetryService';

// Confirmation and controller are declared external ports here. These checks
// verify dispatch/confirmation routing, NOT native permissions or cleanup bytes.
test('explicit Retry cancellation never enters cleanup and foreign stagePath never reaches verification', async () => {
  let verified = 0, cleaned = 0;
  const service = createOwnedStageRetryService({
    verify: async () => { verified++; return { verified: true }; },
    confirm: async () => false,
    cleanup: async () => { cleaned++; throw new Error('must not enter'); }
  });
  expect(await service.request({}, { binding: 'observed', failedVersion: 'failed' })).toMatchObject({ status: 'cancelled', cleanupOutcome: 'not-started' });
  expect(verified).toBe(1); expect(cleaned).toBe(0);
  expect(await service.request({}, { binding: 'observed', failedVersion: 'failed', stagePath: '/arbitrary' })).toMatchObject({ status: 'refused', cleanupOutcome: 'not-started' });
  expect(verified).toBe(1); expect(cleaned).toBe(0);
});

test.each(['before-dispatch', 'after-dispatch'] as const)('controller %s exception is never guessed from its error text', async point => {
  const service = createOwnedStageRetryService({
    verify: async () => ({ verified: true }), confirm: async () => true,
    cleanup: async (_event, _selector, dispatched) => {
      if (point === 'after-dispatch') dispatched();
      throw new Error('identical failure text');
    }
  });
  expect(await service.request({}, { binding: 'observed', failedVersion: 'failed' })).toMatchObject({
    status: point === 'after-dispatch' ? 'unknown' : 'refused',
    cleanupOutcome: point === 'after-dispatch' ? 'unknown' : 'not-started'
  });
});

test('a pending invocation cannot stack another verification or confirmation dialog', async () => {
  let release!: () => void, verified = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = createOwnedStageRetryService({
    verify: async () => { if (++verified === 1) await gate; return { verified: true }; },
    confirm: async () => false,
    cleanup: async () => { throw new Error('No cleanup allowed'); }
  });
  const selector = { binding: 'observed', failedVersion: 'failed' };
  const first = service.request({}, selector);
  try { expect(await service.request({}, selector)).toMatchObject({ status: 'busy', cleanupOutcome: 'not-started' }); expect(verified).toBe(1); }
  finally { release(); await first; }
  expect(await service.request({}, selector)).toMatchObject({ status: 'cancelled' });
});
