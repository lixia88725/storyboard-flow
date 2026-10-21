import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import { hasUnresolvedProtectedWrite } from "./protectedLayerFileWriter.js";

export type SavePreparationDirectoryReceipt = {
  directoryPath: string;
  identity: { dev: string; ino: string };
};

export class TiffPreparationRecoveryIncompleteError extends FileReplacementRecoveryIncompleteError {
  constructor(errors: unknown[], readonly retainedPaths: string[]) {
    super(errors);
    this.name = "TiffPreparationRecoveryIncompleteError";
    this.message += ` TIFF preparation remaining or uncertain paths: ${retainedPaths.join(", ")}`;
  }
}

// A UUID is only a proposed name. Exclusive mkdir, not absence, grants ownership.
export const createSavePreparationDirectory = async (
  directoryPath: string
): Promise<SavePreparationDirectoryReceipt> => {
  await mkdir(path.dirname(directoryPath), { recursive: true });
  if (await realpath(path.dirname(directoryPath)) !== path.resolve(path.dirname(directoryPath))) {
    throw new Error(`Save preparation directory has a path alias: ${directoryPath}`);
  }
  await mkdir(directoryPath, { mode: 0o700 });
  try {
    const entry = await lstat(directoryPath, { bigint: true });
    if (!entry.isDirectory()) throw new Error(`Save preparation directory changed: ${directoryPath}`);
    return { directoryPath, identity: { dev: String(entry.dev), ino: String(entry.ino) } };
  } catch (error) {
    // Creation succeeded but its identity is unknown: retain, never guess rm authority.
    throw new TiffPreparationRecoveryIncompleteError([error], [directoryPath]);
  }
};

export const assertSavePreparationDirectoryIdentity = async (
  receipt: SavePreparationDirectoryReceipt,
  allowAbsent = false
): Promise<boolean> => {
  let entry;
  try { entry = await lstat(receipt.directoryPath, { bigint: true }); }
  catch (error) { if (allowAbsent && (error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (!entry.isDirectory() || String(entry.dev) !== receipt.identity.dev || String(entry.ino) !== receipt.identity.ino ||
      await realpath(receipt.directoryPath) !== path.resolve(receipt.directoryPath)) {
    throw new Error(`Save preparation directory identity changed; retained: ${receipt.directoryPath}`);
  }
  return true;
};

// Only call after encoders settle and replacement recovery has fully succeeded.
export const removeSavePreparationDirectory = async (
  receipt: SavePreparationDirectoryReceipt,
  remove: typeof rm = rm
): Promise<void> => {
  if (!await assertSavePreparationDirectoryIdentity(receipt, true)) return;
  await remove(receipt.directoryPath, { recursive: true, force: true });
};

export const hasIncompleteTiffPreparationEffect = (error: unknown): boolean =>
  error instanceof FileReplacementRecoveryIncompleteError || hasUnresolvedProtectedWrite(error) ||
  (error instanceof AggregateError && error.errors.some(hasIncompleteTiffPreparationEffect));

export const retainedTiffPreparationPaths = (error: unknown): string[] => {
  const paths: string[] = [];
  if (hasUnresolvedProtectedWrite(error)) {
    paths.push(error.filePath);
    if (error.retainedTemporary) paths.push(error.retainedTemporary);
  }
  if (error instanceof FileReplacementRecoveryIncompleteError) {
    if ("retainedPaths" in error && Array.isArray(error.retainedPaths)) {
      paths.push(...error.retainedPaths.filter((item): item is string => typeof item === "string"));
    }
    if ("filePath" in error && typeof error.filePath === "string") paths.push(error.filePath);
  }
  if (error instanceof AggregateError) paths.push(...error.errors.flatMap(retainedTiffPreparationPaths));
  return [...new Set(paths)];
};
