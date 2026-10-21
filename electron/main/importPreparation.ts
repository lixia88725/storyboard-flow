import { ImportRecoveryIncompleteError } from "./importRecovery.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createSavePreparationDirectory,
  removeSavePreparationDirectory,
  hasIncompleteTiffPreparationEffect,
  retainedTiffPreparationPaths,
  TiffPreparationRecoveryIncompleteError,
  type SavePreparationDirectoryReceipt
} from "./tiffPreparation.js";

export type ImportFailureEvidence = {
  schema: 'swb.import-preparation-failure.v1'; candidatePath: string;
  code: string | null; syscall: string | null; path: string | null;
  message: string; preparationStarted: boolean; acknowledged: false;
};
const failureObserver = new AsyncLocalStorage<(fact: ImportFailureEvidence) => void>();
// Only the original Main producer may attach an observer. No IPC accepts facts
// or candidate paths and no later scan reconstructs a failed producer receipt.
export const withImportFailureEvidence = <T>(observe: (fact: ImportFailureEvidence) => void, run: () => Promise<T>) => failureObserver.run(observe, run);

const hasIncompletePreparationEffect = (error: unknown): boolean =>
  error instanceof ImportRecoveryIncompleteError || hasIncompleteTiffPreparationEffect(error) ||
  (error instanceof AggregateError && error.errors.some(hasIncompletePreparationEffect));

/** The callback must settle every started encoder before rejecting. Import's
 * stop-claim/drain map holds the whole-operation queue through that boundary.
 * Successful preparation leaves its namespace for the existing move lifecycle. */
export const prepareImportStaging = async <T>(
  directoryPath: string,
  prepare: () => Promise<T>
): Promise<T> => {
  let receipt: SavePreparationDirectoryReceipt | undefined;
  try {
    receipt = await createSavePreparationDirectory(directoryPath);
    return await prepare();
  } catch (error) {
    const original = error as NodeJS.ErrnoException;
    failureObserver.getStore()?.({ schema: 'swb.import-preparation-failure.v1', candidatePath: directoryPath,
      code: original?.code ?? null, syscall: original?.syscall ?? null, path: original?.path ?? null,
      message: String(error), preparationStarted: receipt !== undefined, acknowledged: false });
    if (hasIncompletePreparationEffect(error)) {
      // Unknown native effects may include user assets, not just disposable
      // encoder outputs. Retain the entire namespace; identity alone is not
      // authority to discard an unresolved effect.
      throw new ImportRecoveryIncompleteError([
        new TiffPreparationRecoveryIncompleteError([error], [
          ...(receipt ? [receipt.directoryPath] : []),
          ...retainedTiffPreparationPaths(error)
        ])
      ]);
    }
    if (receipt) {
      try {
        await removeSavePreparationDirectory(receipt);
      } catch (cleanupError) {
        throw new ImportRecoveryIncompleteError([
          new TiffPreparationRecoveryIncompleteError([error, cleanupError], [receipt.directoryPath])
        ]);
      }
    }
    // Failed exclusive creation grants no ownership. Fully cleaned ordinary
    // preparation failures retain their original error identity.
    throw error;
  }
};
