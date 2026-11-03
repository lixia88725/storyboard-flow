import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { linkExclusive, syncDirectory } from '../../platform/main/platform/index.js';

export type OutputMove = { from: 'active' | 'parked'; to: 'active' | 'parked'; digest: string; dev: string; ino: string };
export const outputPath = (root: string, name: string, location: 'active' | 'parked') =>
  path.join(root, ...(location === 'parked' ? ['Pending', name] : [name]));

/** A persisted intent identifies the actual source inode. Exclusive link publication
 * never replaces a destination. Recovery only releases the original source name
 * when both names still identify that inode and exact bytes. No guessed rollback. */
export async function settleOutputMove(root: string, name: string, move: OutputMove, bind: () => Promise<void>) {
  if (move.to === 'parked') {
    await bind();
    try { await fs.mkdir(path.join(root, 'Pending')); await syncDirectory(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  return settleOutputFileMove(outputPath(root, name, move.from), outputPath(root, name, move.to), move, bind);
}

/** Internal rename seam: caller supplies already validated project-local paths. */
export async function settleOutputFileMove(source: string, target: string, move: Pick<OutputMove, 'digest' | 'dev' | 'ino'>, bind: () => Promise<void>) {
  const parent = async (file: string) => {
    await bind();
    const directory = path.dirname(file);
    if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw Error('Output move directory changed');
  };
  const inspect = async (file: string) => {
    await parent(file);
    let handle;
    try { handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const st = await handle.stat({ bigint: true });
      if (!st.isFile() || st.size > 128n * 1024n * 1024n || st.nlink < 1n || st.nlink > 2n ||
          String(st.dev) !== move.dev || String(st.ino) !== move.ino) throw Error('Output move identity changed; files retained');
      const bytes = await handle.readFile();
      if (bytes.length > 128 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== move.digest) throw Error('Output move content changed; files retained');
      return st;
    } finally { await handle.close(); }
  };
  await bind();
  let before = await inspect(source), after = await inspect(target);
  if (!before && !after) throw Error('Both output move paths are missing');
  if (!after) {
    if (before!.nlink !== 1n) throw Error('Output source has an unrelated hard link');
    await parent(source); await parent(target);
    await linkExclusive(source, target);
    await syncDirectory(path.dirname(target));
    after = await inspect(target);
  }
  if (before) {
    before = await inspect(source); after = await inspect(target);
    if (!before || !after || before.nlink !== 2n || after.nlink !== 2n) throw Error('Output move changed before source release');
    await parent(source);
    const entry = await fs.lstat(source, { bigint: true });
    if (entry.isSymbolicLink() || String(entry.dev) !== move.dev || String(entry.ino) !== move.ino) throw Error('Output move source replaced');
    await fs.unlink(source);
    await syncDirectory(path.dirname(source));
  }
  after = await inspect(target);
  if (!after || after.nlink !== 1n) throw Error('Output move did not settle');
  // Also flush a destination recovered after publication but before its first flush.
  await syncDirectory(path.dirname(target));
}
