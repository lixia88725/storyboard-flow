import { FileRenameRecoveryIncompleteError, FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import { ImportRecoveryIncompleteError } from "./importRecovery.js";
import { hasUnresolvedProtectedWrite } from "./protectedLayerFileWriter.js";

type Rollback = { rollback: () => Promise<void> };

type SaveRecoverySteps = {
  publicationOrCleanupStarted?: boolean;
  appliedTiffReplacements?: Rollback;
  swbImport?: Rollback;
  appliedRenamePlan?: Rollback;
  stagedPendingDeletedFiles?: Rollback;
};

export class SaveRecoveryIncompleteError extends AggregateError {
  readonly recoveryIncomplete = true;

  constructor(errors: unknown[], readonly publicationOrCleanupStarted = false) {
    const details = errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ");
    super(errors, `${details}; Save recovery incomplete. Remaining staged files retained; dependent restoration stopped. Manual recovery required before retrying Save.`);
    this.name = "SaveRecoveryIncompleteError";
  }
}

// Reverse dependency order: only restore dependent paths after replacements
// and renames are known to be untouched or fully restored. Failed applies may
// leave no handle, so their typed incomplete-recovery errors gate entry too.
export const recoverFailedSave = async (error: unknown, steps: SaveRecoverySteps): Promise<never> => {
  if (steps.publicationOrCleanupStarted) throw new SaveRecoveryIncompleteError([error,
    new Error("Metadata publication or backup cleanup began; installed assets and remaining backups retained, automatic rollback stopped")
  ], true);
  if (error instanceof FileRenameRecoveryIncompleteError || error instanceof FileReplacementRecoveryIncompleteError || error instanceof ImportRecoveryIncompleteError || hasUnresolvedProtectedWrite(error)) {
    throw new SaveRecoveryIncompleteError([error]);
  }
  try {
    await steps.appliedTiffReplacements?.rollback();
    await steps.swbImport?.rollback();
    await steps.appliedRenamePlan?.rollback();
    await steps.stagedPendingDeletedFiles?.rollback();
  } catch (rollbackError) {
    // Do not continue with dependent recovery when any prerequisite fails.
    throw new SaveRecoveryIncompleteError([error, rollbackError]);
  }
  throw error;
};
