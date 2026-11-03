import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { errnoCode, errorMessage, ProjectStoreError } from './errors.js';

/** O_NOFOLLOW is not defined on Windows; there the lstat checks below are the
 * only link protection, which FORMAT.md lists as an untested limitation. */
const READ_FLAGS = constants.O_RDONLY
  | (Number(constants.O_NOFOLLOW) || 0)
  | (constants.O_NONBLOCK ?? 0);

/** A file this process created and can still recognise by device/inode. */
export type OwnedFile = { path: string; dev: string; ino: string };

const conflict = (message: string): never => {
  throw new ProjectStoreError('conflict', message);
};

/**
 * Read a regular file that must not be a link, bounded by the entry size
 * observed before and after the read. Returns undefined when the entry does not
 * exist; every other filesystem problem is reported, never swallowed.
 */
export const readBoundFile = async (filePath: string, maxBytes: number): Promise<Buffer | undefined> => {
  let entry;
  try {
    entry = await fs.lstat(filePath, { bigint: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  if (entry.isSymbolicLink()) conflict(`Unsafe pre-existing entry; a symbolic link is not accepted: ${filePath}`);
  if (!entry.isFile()) conflict(`Unsafe pre-existing entry; expected a regular file: ${filePath}`);
  if (entry.size > BigInt(maxBytes)) {
    conflict(`Existing entry is larger than the ${maxBytes}-byte limit: ${filePath}`);
  }

  const handle = await fs.open(filePath, READ_FLAGS);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino) {
      conflict(`File changed while it was being opened: ${filePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || BigInt(bytes.length) !== before.size) {
      conflict(`File changed while it was being read: ${filePath}`);
    }
    if (bytes.length > maxBytes) conflict(`File is larger than the ${maxBytes}-byte limit: ${filePath}`);
    return bytes;
  } finally {
    await handle.close();
  }
};

/** Create a new file exclusively (never replacing an existing entry), write and
 * flush it, and return its identity. On failure only the file this call created
 * is removed, and only after its identity was observed. */
export const createFileExclusive = async (filePath: string, bytes: Uint8Array, mode = 0o600): Promise<OwnedFile> => {
  const handle = await fs.open(filePath, 'wx', mode);
  let owned: OwnedFile | undefined;
  let failure: unknown;
  try {
    const stat = await handle.stat({ bigint: true });
    owned = { path: filePath, dev: String(stat.dev), ino: String(stat.ino) };
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    failure = error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    if (owned) {
      try {
        await removeOwnedFile(owned);
      } catch (removalError) {
        throw new ProjectStoreError(
          'io-failure',
          `File creation failed (${errorMessage(failure)}) and the partially written file was retained: ${filePath} (${errorMessage(removalError)})`
        );
      }
    }
    throw failure;
  }
  return owned!;
};

/** Remove a file only if it is still the exact file this process created. A
 * changed entry is retained and reported; nothing is deleted by name alone. */
export const removeOwnedFile = async (owned: OwnedFile): Promise<void> => {
  let entry;
  try {
    entry = await fs.lstat(owned.path, { bigint: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return;
    throw error;
  }
  if (!entry.isFile() || String(entry.dev) !== owned.dev || String(entry.ino) !== owned.ino) {
    throw new ProjectStoreError('conflict', `Owned file identity changed; entry retained: ${owned.path}`);
  }
  await fs.unlink(owned.path);
};

/** Write a uniquely named temporary file in `directory` and flush it. The name
 * is random, so a temporary file left by a crashed run is never reused or
 * mistaken for this run's file; wave 1 never garbage-collects such leftovers. */
export const writeTemporaryFile = async (directory: string, purpose: string, bytes: Uint8Array): Promise<OwnedFile> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const name = `${purpose}.${randomBytes(12).toString('hex')}.tmp`;
    const candidate = path.join(directory, name);
    try {
      return await createFileExclusive(candidate, bytes);
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') continue;
      throw new ProjectStoreError('io-failure', `Temporary file could not be written in ${directory}: ${errorMessage(error)}`);
    }
  }
  throw new ProjectStoreError('io-failure', `Temporary file name could not be allocated in ${directory}`);
};

/** Remove a temporary file this call created, reporting retention as an I/O
 * failure instead of claiming a clean outcome. */
export const releaseTemporary = async (temporary: OwnedFile): Promise<void> => {
  try {
    await removeOwnedFile(temporary);
  } catch (error) {
    throw new ProjectStoreError('io-failure', `Temporary file was retained at ${temporary.path} (${errorMessage(error)})`);
  }
};

/** Abandon a temporary file after a failed effect and report the original reason.
 * Only the exact file this call created is removed; a retained file is named. */
export const failAfterCleanup = async (temporary: OwnedFile, reason: unknown, context: string): Promise<never> => {
  try {
    await removeOwnedFile(temporary);
  } catch (cleanupError) {
    throw new ProjectStoreError(
      'io-failure',
      `${context}: ${errorMessage(reason)}; the temporary file was retained at ${temporary.path} (${errorMessage(cleanupError)})`
    );
  }
  if (reason instanceof ProjectStoreError) throw reason;
  throw new ProjectStoreError('io-failure', `${context}: ${errorMessage(reason)}`);
};
