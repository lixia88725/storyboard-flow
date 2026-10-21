import fs from 'node:fs/promises';
import { constants } from 'node:fs';

/** Read genuine failed publication bytes only; this never certifies ordinary
 * custody or grants cleanup permission. The optional port is the OS test seam. */
export const readCommittedLayerBytes = async (file: string, expected: {
  identity: { dev: string; ino: string }; bytes: Buffer;
}, maximumBytes: number, filesystem: Pick<typeof fs, 'open' | 'lstat'> = fs): Promise<{ bytes: Buffer; physical: string }> => {
  const fd = await filesystem.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true }), physical = `${before.dev}:${before.ino}`;
    if (!before.isFile() || physical !== `${expected.identity.dev}:${expected.identity.ino}` || before.size > BigInt(maximumBytes) || before.size !== BigInt(expected.bytes.length)) throw new Error('Committed failed producer physical identity');
    // Bound allocation by the original Main-owned bytes, not a disk allowance.
    // One sentinel byte detects growth without an unbounded readFile().
    const buffer = Buffer.allocUnsafe(expected.bytes.length + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await fd.read(buffer, total, buffer.length - total, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length - total) throw new Error('Committed failed producer bytes changed');
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== expected.bytes.length) throw new Error('Committed failed producer bytes changed');
    const bytes = buffer.subarray(0, total);
    const finished = await fd.stat({ bigint: true });
    const after = await filesystem.lstat(file, { bigint: true });
    if (!finished.isFile() || finished.dev !== before.dev || finished.ino !== before.ino || finished.size !== before.size || finished.mtimeNs !== before.mtimeNs || finished.ctimeNs !== before.ctimeNs || !bytes.equals(expected.bytes) || BigInt(bytes.length) !== before.size || !after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error('Committed failed producer bytes changed');
    return { bytes, physical };
  } finally { await fd.close(); }
};
