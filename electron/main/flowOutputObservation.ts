import fs from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

/** Read-only observation cache, never authority to overwrite a TIFF. Save still
 * re-reads bytes through its existing native compare-and-swap protocol. */
export function createOutputObservation(bind: () => Promise<void>) {
  const cache = new Map<string, { stamp: string; digest: string }>();
  const stamp = (st: BigIntStats) =>
    [st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs].join(':');
  return async (file: string): Promise<string | null> => {
    await bind();
    let handle;
    try {
      if (await fs.realpath(file) !== file) throw Error('Aliased output path refused');
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { cache.delete(file); return null; }
      throw error;
    }
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size > 128n * 1024n * 1024n) throw Error('Unsupported output file');
      const identity = stamp(before), cached = cache.get(file);
      let digest = cached?.stamp === identity ? cached.digest : undefined;
      if (!digest) {
        const bytes = await handle.readFile();
        if (bytes.length > 128 * 1024 * 1024) throw Error('Output too large');
        digest = createHash('sha256').update(bytes).digest('hex');
      }
      await bind();
      const after = await handle.stat({ bigint: true }), entry = await fs.lstat(file, { bigint: true });
      if (stamp(after) !== identity || stamp(entry) !== identity || entry.isSymbolicLink() || await fs.realpath(file) !== file)
        throw Error('TIFF changed while checking external edits; retry');
      if (cache.size >= 10000 && !cache.has(file)) cache.clear();
      cache.set(file, { stamp: identity, digest });
      return digest;
    } finally { await handle.close(); }
  };
}
