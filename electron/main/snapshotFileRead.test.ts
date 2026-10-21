import { expect, test, vi } from 'vitest';
import { readSnapshotFile } from './snapshotFileRead';

// File-descriptor IO seam: virtual growth/exact metadata, not an OS permission
// certificate. Literal source bytes and read allowance are independent oracles.
const fixture = (growth: boolean) => {
  const stat = { dev: 1n, ino: 9007199254740993n, uid: 501n, gid: 20n, mode: 33152n, nlink: 1n, size: 3n, birthtimeNs: 5n, mtimeNs: 7n, ctimeNs: 9n, isFile: () => true, isSymbolicLink: () => false };
  const source = Buffer.from(growth ? 'abcdef' : 'abc');
  let requested = 0;
  const close = vi.fn(async () => {}), readFile = vi.fn(async () => { throw new Error('Unbounded readFile forbidden'); });
  const fd = { stat: vi.fn(async () => stat), close, readFile,
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      requested += length; const bytesRead = Math.min(length, source.length - position);
      source.copy(buffer, offset, position, position + bytesRead); return { bytesRead, buffer };
    }) };
  const filesystem = { lstat: vi.fn(async () => stat), open: vi.fn(async () => fd) };
  return { filesystem, close, readFile, fd, requested: () => requested };
};

test('snapshot read limits a growing file to its initial size plus one sentinel and closes', async () => {
  const f = fixture(true);
  await expect(readSnapshotFile('/synthetic', 100, f.filesystem as any)).rejects.toThrow('Snapshot file changed');
  expect(f.requested()).toBeLessThanOrEqual(4);
  expect(f.readFile).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
});

test('snapshot read returns unchanged literal bytes and rejects exact post-read FD changes', async () => {
  const f = fixture(false);
  expect(await readSnapshotFile('/synthetic', 100, f.filesystem as any)).toEqual(Buffer.from('abc'));
  expect(f.close).toHaveBeenCalledOnce();
  const changed = fixture(false);
  const original = await changed.fd.stat();
  changed.fd.stat.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, ctimeNs: 10n });
  await expect(readSnapshotFile('/synthetic', 100, changed.filesystem as any)).rejects.toThrow('Snapshot file changed');
  expect(changed.close).toHaveBeenCalledOnce();
});
