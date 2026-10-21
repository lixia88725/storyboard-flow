import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { constants as bufferConstants } from 'node:buffer';
import { allocateSnapshotMemory } from './controlledMemory.js';

/** Bounded by the initial stat plus one sentinel, never by subsequent growth.
 * This does not authenticate provenance/native restrictions or certify that the
 * caller's maximum is a suitable application-wide RAM allowance. */
export const readSnapshotFile = async (file: string, maximumBytes: number, filesystem: Pick<typeof fs, 'lstat' | 'open'> = fs): Promise<Buffer> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error('Finite snapshot read budget required');
  const before = await filesystem.lstat(file, { bigint: true });
  const regular = (s: typeof before) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n;
  const fields = (s: typeof before) => [s.dev, s.ino, s.uid, s.gid, s.mode, s.nlink, s.size, s.birthtimeNs, s.mtimeNs, s.ctimeNs];
  const same = (s: typeof before) => regular(s) && fields(s).every((value, i) => value === fields(before)[i]);
  if (!regular(before) || before.size < 0n || before.size > BigInt(maximumBytes) || before.size >= BigInt(bufferConstants.MAX_LENGTH)) throw new Error('Snapshot file identity/budget');
  const fd = await filesystem.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!same(await fd.stat({ bigint: true }))) throw new Error('Snapshot file changed');
    const buffer = allocateSnapshotMemory(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await fd.read(buffer, length, buffer.length - length, length);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length - length) throw new Error('Snapshot file read count');
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (BigInt(length) !== before.size || !same(await fd.stat({ bigint: true })) || !same(await filesystem.lstat(file, { bigint: true }))) throw new Error('Snapshot file changed');
    return buffer.subarray(0, length);
  } finally { await fd.close(); }
};
