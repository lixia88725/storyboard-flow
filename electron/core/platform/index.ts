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

/** Whole prepared namespace publication. Destination must not exist, including an
 * empty directory created by another writer. Native failure never falls back to
 * replacing it. Wait for the child to settle before inspecting or cleaning stages. */
export async function publishDirectoryExclusive(source: string, target: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  for (const file of [source, target]) {
    if (!path.isAbsolute(file) || await fs.realpath(path.dirname(file)) !== path.dirname(file)) throw Error('Publication directory is aliased');
  }
  const original = await fs.lstat(source, { bigint: true });
  if (!original.isDirectory() || original.isSymbolicLink()) throw Error('Expected a real prepared directory');
  const script = fileURLToPath(new URL('../../../electron/core/platform/publish_directory.py', import.meta.url));
  await new Promise<void>((resolve, reject) => execFile(process.env.FLOW_PYTHON_PATH || 'python3', ['-I', '-B', script, source, target],
    { maxBuffer: 65536 }, (error, _stdout, stderr) => error ? reject(Error(`Project publication failed; stage retained: ${stderr || error.message}`)) : resolve()));
  const published = await fs.lstat(target, { bigint: true });
  if (published.dev !== original.dev || published.ino !== original.ino || !published.isDirectory()) throw Error('Published project identity changed');
  await syncDirectory(path.dirname(target));
  await syncDirectory(path.dirname(source));
}
