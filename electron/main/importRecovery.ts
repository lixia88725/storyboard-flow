import { FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import { hasUnresolvedProtectedWrite } from "./protectedLayerFileWriter.js";

type Rollback = { rollback: () => Promise<void> };

export class ImportRecoveryIncompleteError extends AggregateError {
  readonly recoveryIncomplete = true;

  constructor(errors: unknown[]) {
    const details = errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ");
    super(errors, `${details}; Import recovery incomplete. Retained files require manual recovery; dependent restoration stopped.`);
    this.name = "ImportRecoveryIncompleteError";
  }
}

// Used at both Import catch boundaries: an apply can reject before returning
// a handle, and an inner rollback failure must also gate outer script recovery.
export const recoverFailedImport = async (
  error: unknown,
  steps: Array<Rollback | undefined>
): Promise<never> => {
  if (error instanceof ImportRecoveryIncompleteError) throw error;
  if (error instanceof FileReplacementRecoveryIncompleteError || hasUnresolvedProtectedWrite(error)) {
    throw new ImportRecoveryIncompleteError([error]);
  }
  try {
    for (const step of steps) await step?.rollback();
  } catch (rollbackError) {
    throw new ImportRecoveryIncompleteError([error, rollbackError]);
  }
  throw error;
};
