import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
import { FileReplacementRecoveryIncompleteError } from "./fileRenames.js";

export type OwnedFileReceipt = { filePath: string; identity: { dev: string; ino: string } };

export class OwnedFileCreationIncompleteError extends FileReplacementRecoveryIncompleteError {
  constructor(errors: unknown[], readonly filePath: string, readonly receipt?: OwnedFileReceipt) {
    super(errors);
    this.message += ` Retained creation path: ${filePath}`;
    this.name = "OwnedFileCreationIncompleteError";
  }
}

/** A receipt represents an actual exclusive creation, never a planned name. */
export const createOwnedFile = (
  filePath: string,
  bytes: Buffer,
  onCreated?: (receipt: OwnedFileReceipt) => void,
  openFile: typeof open = open
): Promise<OwnedFileReceipt> => withLayerFileOperation(async () => {
  if (await realpath(path.dirname(filePath)) !== path.resolve(path.dirname(filePath))) {
    throw new Error(`Creation directory has a path alias; retained: ${filePath}`);
  }
  const handle = await openFile(filePath, "wx");
  let receipt: OwnedFileReceipt | undefined;
  const errors: unknown[] = [];
  try {
    const stat = await handle.stat({ bigint: true });
    receipt = { filePath, identity: { dev: String(stat.dev), ino: String(stat.ino) } };
    onCreated?.(receipt);
    await handle.writeFile(bytes);
  } catch (error) {
    errors.push(error);
  } finally {
    try { await handle.close(); } catch (error) { errors.push(error); }
  }
  if (errors.length) {
    if (!receipt) {
      // Creation occurred but its identity could not be observed: no guessed
      // deletion is permitted. The caller must retain the unknown directory item.
      throw new OwnedFileCreationIncompleteError(errors, filePath);
    }
    try { await removeOwnedFile(receipt); }
    catch (error) { throw new OwnedFileCreationIncompleteError([...errors, error], filePath, receipt); }
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, "File creation failed; all owned file effects compensated");
  }
  return receipt!;
});

const assertOwnedFile = async (receipt: OwnedFileReceipt): Promise<void> => {
  const entry = await lstat(receipt.filePath, { bigint: true });
  if (!entry.isFile() || String(entry.dev) !== receipt.identity.dev || String(entry.ino) !== receipt.identity.ino) {
    throw new Error(`Owned file identity changed; directory item retained: ${receipt.filePath}`);
  }
};

export const publishOwnedFile = (source: OwnedFileReceipt, target: string,
  onPublished?: (receipt: OwnedFileReceipt) => void): Promise<OwnedFileReceipt> => withLayerFileOperation(async () => {
  await assertOwnedFile(source);
  if (await realpath(path.dirname(target)) !== path.resolve(path.dirname(target))) {
    throw new Error(`Publication directory has a path alias; retained: ${target}`);
  }
  await link(source.filePath, target); // EEXIST/EXDEV never fall back to overwrite.
  const receipt = { filePath: target, identity: source.identity };
  onPublished?.(receipt); // Record publication before source release can fail.
  await unlink(source.filePath);
  return receipt;
});

export const removeOwnedFile = (receipt: OwnedFileReceipt, unlinkFile: (filePath: string) => Promise<void> = unlink): Promise<void> => withLayerFileOperation(async () => {
  let entry;
  try { entry = await lstat(receipt.filePath, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!entry.isFile() || String(entry.dev) !== receipt.identity.dev || String(entry.ino) !== receipt.identity.ino) {
    throw new Error(`Owned file identity changed; directory item retained: ${receipt.filePath}`);
  }
  await unlinkFile(receipt.filePath);
});
