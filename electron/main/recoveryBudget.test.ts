import { test, expect } from 'vitest';
import { resolveRecoveryBudget } from './recoveryBudget';

// Capacity is the user-approved per-workspace disk policy, not a RAM allocation.
test('ordinary startup supplies the approved 8 GiB finite recovery capacity without an environment override', () => {
  const budget = resolveRecoveryBudget(undefined);
  expect(budget.bytes).toBe(8589934592);
  expect(Object.keys(budget).sort()).toEqual(['assets', 'bytes', 'jsonDepth', 'records']);
  expect(Object.values(budget).every(value => Number.isSafeInteger(value) && value > 0)).toBe(true);
  // 60 shots x 3 layers, plus base TIFFs and two full asset snapshots.
  expect(budget.assets).toBeGreaterThanOrEqual(600);
});

test('explicit finite smaller limits remain usable for isolated quota checks', () => {
  const fixture = { bytes: 1048576, records: 2000, assets: 64, jsonDepth: 80 };
  expect(resolveRecoveryBudget(JSON.stringify(fixture))).toEqual(fixture);
});

test('configuration cannot silently exceed the approved capacity or become unlimited', () => {
  const valid = { bytes: 8589934592, records: 2000, assets: 64, jsonDepth: 80 };
  for (const input of [
    '', 'null', '[]', '{}', '{bad',
    JSON.stringify({ ...valid, bytes: 8589934593 }),
    JSON.stringify({ ...valid, bytes: 0 }),
    JSON.stringify({ ...valid, records: -1 }),
    JSON.stringify({ ...valid, assets: 1.5 }),
    JSON.stringify({ ...valid, jsonDepth: 0 }),
    JSON.stringify({ ...valid, gc: true }),
    JSON.stringify({ ...valid, records: Number.MAX_SAFE_INTEGER + 1 })
  ]) expect(() => resolveRecoveryBudget(input)).toThrow(/recovery/i);
});

test('callers cannot change the shared default for another operation', () => {
  const first = resolveRecoveryBudget(undefined);
  first.bytes = 1;
  expect(resolveRecoveryBudget(undefined).bytes).toBe(8589934592);
});
