import fs from 'node:fs/promises';

/** Every place where the checkpoint protocol's guarantees depend on the operating
 * system lives in this module, so the differences can be reviewed and tested in
 * one place instead of being scattered through the persistence code. */
export type PlatformKind = 'posix' | 'win32';

export const currentPlatformKind: PlatformKind = process.platform === 'win32' ? 'win32' : 'posix';

/**
 * Flush a directory entry (a completed rename or link) so the entry itself, not
 * only the file contents, survives a crash.
 *
 * POSIX: a directory can be opened read-only and fsynced. Windows: opening a
 * directory as a file is not supported, so this is skipped and returns
 * 'skipped'. Callers must not claim directory-entry durability after 'skipped'.
 */
export const syncDirectory = async (
  directory: string,
  kind: PlatformKind = currentPlatformKind
): Promise<'synced' | 'skipped'> => {
  if (kind === 'win32') return 'skipped';
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return 'synced';
};

/**
 * Publish an immutable file under its final name without ever replacing an
 * existing entry: link(2)/CreateHardLink. An existing target fails with EEXIST,
 * which the caller verifies instead of overwriting. Requires hard-link support
 * on the target filesystem (NTFS, APFS/HFS+, ext4); there is deliberately no
 * copy fallback, because a non-atomic create would make a partially written
 * asset look like a published one.
 */
export const linkExclusive = (source: string, target: string): Promise<void> => fs.link(source, target);

/**
 * Atomically replace one name with another inside the same directory. rename(2)
 * replaces the directory entry itself; it never follows a symbolic link at the
 * target, so a planted link cannot redirect the write.
 *
 * Windows: mapped to MoveFileEx(MOVEFILE_REPLACE_EXISTING). Whether it can fail
 * with EPERM/EBUSY while another process holds the target open is not verified
 * here; such a failure is reported as an I/O failure, never retried silently.
 */
export const replaceFile = (source: string, target: string): Promise<void> => fs.rename(source, target);
