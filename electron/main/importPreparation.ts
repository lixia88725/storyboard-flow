import { ImportRecoveryIncompleteError } from "./importRecovery.js";
import {
  createSavePreparationDirectory,
  removeSavePreparationDirectory,
  hasIncompleteTiffPreparationEffect,
  retainedTiffPreparationPaths,
  TiffPreparationRecoveryIncompleteError,
  type SavePreparationDirectoryReceipt
} from "./tiffPreparation.js";

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
