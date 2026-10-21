import type { RecoveryBudget } from './workspaceRecoveryStore.js';

const approvedCapacityBytes = 8589934592;

/** Parse only finite accepted limits. Unknown fields never authorize growth/GC. */
export const resolveRecoveryBudget = (input: string | undefined): RecoveryBudget => {
  // Independent structural ceilings, not a generation count or preallocation.
  // Keep headroom for the approved 60-shot/3-layer scale and retained History;
  // encoded inventory capacity still refuses growth before any sidecar effect.
  if (input === undefined) return {
    bytes: approvedCapacityBytes,
    records: 1000000,
    assets: 100000,
    jsonDepth: 80
  };
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('Invalid recovery limits JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'assets,bytes,jsonDepth,records'
    || !Object.values(value).every(number => Number.isSafeInteger(number) && number > 0)
    || (value as RecoveryBudget).bytes > approvedCapacityBytes) {
    throw new Error('Invalid recovery limits or capacity exceeds the approved 8 GiB');
  }
  return { ...value as RecoveryBudget };
};
