/** Shared pure output-record rules. Callers retain their own admission policy:
 * a runtime view may contain unknown, Import may allow a missing envelope,
 * and main/Create still prove the actual paths and whole file identities. */
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const isOutputHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** Field-only predicate: intentionally does not decide container/hash policy.
 * Create's established coercion policy stays local to that caller. */
export const hasCertifiedPendingBakeState = (entry: { state?: unknown; editToken?: unknown }): boolean =>
  entry.state === "synced" && entry.editToken === undefined ||
  entry.state === "pending" && typeof entry.editToken === "string" && entry.editToken.length > 0;

export const isCertifiedPendingBakeEntry = (value: unknown): boolean =>
  record(value) && isOutputHash(value.acceptedOutputIdentity) && hasCertifiedPendingBakeState(value);

export type PendingBakeClassification = "missing" | "supported" | "unsupported" | "corrupt";

/** Classify raw data without normalizing or mutating it, including empty workspaces. */
export const classifyPendingBakeEnvelope = (raw: unknown): PendingBakeClassification => {
  if (raw === undefined) return "missing";
  if (!record(raw)) return "corrupt";
  if (typeof raw.version === "number" && raw.version !== 1) return "unsupported";
  if (raw.version !== 1 || !record(raw.shots)) return "corrupt";
  return Object.values(raw.shots).every(entry =>
    record(entry) && (entry.state === "unknown" || isCertifiedPendingBakeEntry(entry))
  ) ? "supported" : "corrupt";
};
