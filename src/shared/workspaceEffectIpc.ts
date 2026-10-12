// Only incomplete failures are enveloped. Ordinary rejection and success stay unchanged.
export type WorkspaceEffectFailure = {
  ok: false;
  error: {
    code: "SAVE_RECOVERY_INCOMPLETE" | "PENDING_RECOVERY_INCOMPLETE";
    message: string;
    recoveryIncomplete: true;
    publicationOrCleanup: "started" | "not-started";
    metadata: "unknown" | "not-started";
    retainedPaths: string[];
    sourceEffects?: 0 | "unknown";
  };
};
export class WorkspaceEffectIpcError extends Error {
  readonly recoveryIncomplete = true;
  readonly code: WorkspaceEffectFailure["error"]["code"];
  readonly publicationOrCleanup: WorkspaceEffectFailure["error"]["publicationOrCleanup"];
  readonly metadata: WorkspaceEffectFailure["error"]["metadata"];
  readonly retainedPaths: string[];
  readonly sourceEffects?: 0 | "unknown";
  constructor(error: WorkspaceEffectFailure["error"]) {
    super(error.message);
    this.name = "WorkspaceEffectIpcError";
    this.code = error.code;
    this.publicationOrCleanup = error.publicationOrCleanup;
    this.metadata = error.metadata;
    this.retainedPaths = [...error.retainedPaths];
    this.sourceEffects = error.sourceEffects;
  }
}
export const decodeWorkspaceEffectResult = <T>(value: T | WorkspaceEffectFailure): T => {
  if (value && typeof value === "object" && "ok" in value) {
    const failure = value as WorkspaceEffectFailure;
    const error = failure.error;
    if (failure.ok !== false || !error ||
      !["SAVE_RECOVERY_INCOMPLETE", "PENDING_RECOVERY_INCOMPLETE"].includes(error.code) ||
      typeof error.message !== "string" || error.recoveryIncomplete !== true ||
      !["started", "not-started"].includes(error.publicationOrCleanup) ||
      error.metadata !== (error.publicationOrCleanup === "started" ? "unknown" : "not-started") ||
      (error.sourceEffects !== undefined && error.sourceEffects !== 0 && error.sourceEffects !== "unknown") ||
      !Array.isArray(error.retainedPaths) || error.retainedPaths.some(p => typeof p !== "string")) {
      throw new Error("Invalid workspace effect result; operation not completed");
    }
    throw new WorkspaceEffectIpcError(error);
  }
  return value as T;
};
