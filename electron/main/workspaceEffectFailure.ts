import { SaveRecoveryIncompleteError } from "./saveRecovery.js";
import { PendingRecoveryIncompleteError } from "./pendingShotFilesService.js";
import { FileRenameRecoveryIncompleteError, FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import { ImportRecoveryIncompleteError } from "./importRecovery.js";
import { ProtectedLayerWriteError, hasUnresolvedProtectedWrite } from "./protectedLayerFileWriter.js";
import type { WorkspaceEffectFailure } from "../shared/workspaceEffectIpc.js";

// The envelope carries only typed facts, never inferred paths or message markers.
export const workspaceEffectFailure = (error: unknown, kind: "save" | "pending"): WorkspaceEffectFailure => {
  const incomplete = error instanceof SaveRecoveryIncompleteError || error instanceof PendingRecoveryIncompleteError ||
    error instanceof FileRenameRecoveryIncompleteError || error instanceof FileReplacementRecoveryIncompleteError ||
    error instanceof ImportRecoveryIncompleteError || hasUnresolvedProtectedWrite(error);
  if (!incomplete) throw error;
  const paths: string[] = [];
  const visited = new Set<unknown>();
  const collect = (value: unknown) => {
    if (!value || visited.has(value)) return;
    visited.add(value);
    if (value instanceof FileReplacementRecoveryIncompleteError && "retainedPaths" in value && Array.isArray(value.retainedPaths)) {
      paths.push(...value.retainedPaths.filter((p): p is string => typeof p === "string"));
    }
    if (value instanceof ProtectedLayerWriteError) {
      if (value.effect !== "refused") paths.push(value.filePath);
      if (value.retainedTemporary) paths.push(value.retainedTemporary);
    }
    if (value instanceof AggregateError) value.errors.forEach(collect);
  };
  collect(error);
  const started = (error instanceof SaveRecoveryIncompleteError || error instanceof PendingRecoveryIncompleteError) && error.publicationOrCleanupStarted;
  return { ok: false, error: { code: kind === "save" ? "SAVE_RECOVERY_INCOMPLETE" : "PENDING_RECOVERY_INCOMPLETE",
    message: error instanceof Error ? error.message : String(error), recoveryIncomplete: true,
    publicationOrCleanup: started ? "started" : "not-started", metadata: started ? "unknown" : "not-started",
    retainedPaths: [...new Set(paths)] } };
};
