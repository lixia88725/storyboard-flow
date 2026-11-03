import { afterEach, expect, it, vi } from 'vitest';
import { waitForRefreshSettlement } from './deferredRefresh';
afterEach(() => vi.useRealTimers());
it('keeps original producers live until settled, shows waiting, then captures once', async () => {
  vi.useFakeTimers(); let busy = true, active = true; const calls: string[] = [];
  const waiting = waitForRefreshSettlement({isBusy: () => busy, isCurrent: () => active, waiting: () => calls.push('Waiting for Save to finish before refreshing'), capture: async () => {calls.push('capture'); return 'exact';}});
  await vi.advanceTimersByTimeAsync(1000); expect(calls).toEqual(['Waiting for Save to finish before refreshing']);
  busy = false; await vi.advanceTimersByTimeAsync(50); expect(await waiting).toBe('exact');
  expect(calls.at(-1)).toBe('capture'); active = false;
});
it('does not freeze, cancel, replay or capture original work after Main timeout cancellation', async () => {
  vi.useFakeTimers(); let active = true; const capture = vi.fn();
  const waiting = waitForRefreshSettlement({isBusy: () => true, isCurrent: () => active, waiting: vi.fn(), capture});
  active = false; await vi.advanceTimersByTimeAsync(50);
  expect(await waiting).toBeUndefined(); expect(capture).not.toHaveBeenCalled();
});
it('idle request captures immediately without a spurious waiting state', async () => {
  const waiting = vi.fn(), capture = vi.fn(async () => 'idle');
  expect(await waitForRefreshSettlement({isBusy: () => false, isCurrent: () => true, waiting, capture})).toBe('idle');
  expect(waiting).not.toHaveBeenCalled(); expect(capture).toHaveBeenCalledOnce();
});
