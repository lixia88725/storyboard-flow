import { createControlledMemoryBudget, getControlledMemoryContext, withControlledMemory, type ControlledMemoryBudget, type MemoryPressurePolicy } from './controlledMemory.js';
import type { JSONResourceLimits } from './jsonMemoryResources.js';

/**
 * Production admission limits for the Main-process recovery and layer paths.
 *
 * Measured on the delivery machine (Apple silicon Mac mini, 32 GiB physical,
 * Electron 36.9.5 / Node 22.19.0, heap limit 4,294,705,152 B): restoring
 * 60 shots × 3 layers at 1920×1080 through the real Browser Main chain
 * (240 assets, prepare → retain/readback → persist → ACK → readonly) peaked at
 * maxRSS 426,770,432 B (407 MiB) with 22,742,640 B of encoded originals.
 *
 * These are empirical admission thresholds, NOT a hard RSS guarantee. They bound
 * the controlled backing pool this process funds and refuse a new operation when
 * the live system is already close to its limit; opaque codec/encoder workspace,
 * renderer memory, Python and other processes stay outside this account.
 */
export const MAIN_MEMORY_BUDGET_BYTES = 1024 * 1024 * 1024;

export const MAIN_MEMORY_PRESSURE: MemoryPressurePolicy = Object.freeze({
  rssBytes: 6 * 1024 * 1024 * 1024,
  externalBytes: 3 * 1024 * 1024 * 1024,
  heapBytes: 3 * 1024 * 1024 * 1024,
  // macOS keeps free pages low by design (cache/inactive pages are reclaimable):
  // a real machine reported 918 MB "free" while the OS reported 86% available.
  // The gate therefore only catches a truly exhausted system; RSS/heap/external
  // carry the real admission decision.
  minimumFreeBytes: 64 * 1024 * 1024,
  operationHeadroomBytes: 256 * 1024 * 1024,
});

/**
 * Logical JSON limits for recovery data. A normal project document is far below
 * these; the limits exist to refuse a malformed or runaway document before it is
 * parsed or serialized, and the refusal keeps the source on disk untouched.
 * `maximumNesting` follows the approved recovery JSON depth (80) plus the root.
 */
export const MAIN_MEMORY_JSON: JSONResourceLimits = Object.freeze({
  maximumSourceBytes: 64 * 1024 * 1024,
  maximumTokens: 4_000_000,
  maximumStringSourceBytes: 32 * 1024 * 1024,
  maximumNesting: 81,
});

let processBudget: ControlledMemoryBudget | undefined;

/** The one Main-process pool. Every entry (Save service, layer IPC, preview
 * coding) shares this instance so nested work never switches ownership. */
export const getMainMemoryBudget = (): ControlledMemoryBudget =>
  (processBudget ??= createControlledMemoryBudget(
    MAIN_MEMORY_BUDGET_BYTES,
    { policy: MAIN_MEMORY_PRESSURE },
    MAIN_MEMORY_JSON,
  ));

/**
 * Peak-transient admission for a native encoder step whose output goes straight
 * to disk (preview coding). The quote is held for the whole operation so a
 * concurrent entry sees it, then released — never adopted, because the codec's
 * real backing is opaque to this process. An existing budget context always
 * wins; unit tests only get production admission by entering one explicitly.
 */
export const withMainMemoryAdmission = async <T>(
  quotedBytes: number,
  operation: () => Promise<T>,
): Promise<T> => {
  if (!Number.isSafeInteger(quotedBytes) || quotedBytes < 0) throw new Error('Finite memory quote required');
  const bytes = Math.max(1, quotedBytes);
  const context = getControlledMemoryContext();
  if (context) {
    const reservation = context.reserve(bytes);
    try { return await operation(); } finally { reservation.cancel(); }
  }
  // Tests opt in by running inside an explicit budget; they must not inherit
  // the production pressure policy and become sampling-dependent.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return operation();
  const budget = getMainMemoryBudget();
  return withControlledMemory(budget, async () => {
    const reservation = budget.reserve(bytes);
    try { return await operation(); } finally { reservation.cancel(); }
  });
};
