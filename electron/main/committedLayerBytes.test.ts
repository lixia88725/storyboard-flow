import { expect, test } from 'vitest';
import type fs from 'node:fs/promises';
import { readCommittedLayerBytes } from './committedLayerBytes';

// Virtual OS metadata adapter: this filesystem cannot allocate arbitrary inode
// numbers. Real native-byte/preservation coverage remains in the native suite.
function filesystem() {
  const bytes = Buffer.from('actual failed bytes');
  const exact = { dev: 9007199254740993n, ino: 9007199254740993n, size: BigInt(bytes.length), mtimeNs: 1700000000000000001n, ctimeNs: 1700000000000000003n, isFile: () => true, isSymbolicLink: () => false };
  let pathMetadata = { ...exact }, fdAfter = { ...exact }, closed = 0, reads = 0, stats = 0, cursor = 0, data = bytes, largestBuffer = 0, fault = '';
  const observed = (options: any, value: typeof exact) => options?.bigint ? value : { ...value, dev: Number(value.dev), ino: Number(value.ino), size: Number(value.size) };
  const port = { open: async () => ({ stat: async (options: any) => { const next = stats++; if (fault === (next ? 'stat-after' : 'stat-before')) throw new Error('fixture ' + fault); return observed(options, next ? fdAfter : exact); }, readFile: async () => { reads++; return data; }, read: async (buffer: Buffer, offset: number, length: number) => { if (fault === 'read') throw new Error('fixture read'); reads++; largestBuffer = Math.max(largestBuffer, buffer.length); const count = Math.min(length, data.length - cursor); data.copy(buffer, offset, cursor, cursor + count); cursor += count; return { bytesRead: count, buffer }; }, close: async () => { closed++; } }), lstat: async (_file: string, options: any) => { if (fault === 'lstat') throw new Error('fixture lstat'); return observed(options, pathMetadata); } } as unknown as Pick<typeof fs, 'open' | 'lstat'>;
  return { port, bytes, fail: (value: string) => { fault = value; }, change: (values: Partial<typeof exact>) => { pathMetadata = { ...pathMetadata, ...values }; }, fdChange: (values: Partial<typeof exact>) => { fdAfter = { ...fdAfter, ...values }; }, grow: () => { data = Buffer.concat([bytes, Buffer.alloc(4096)]); }, largestBuffer: () => largestBuffer, closed: () => closed, reads: () => reads };
}
const identity = { dev: '9007199254740993', ino: '9007199254740993' };
test('committed bytes preserve exact native identity beyond safe JS integers', async () => {
  const f = filesystem();
  expect(await readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).toEqual({ bytes: f.bytes, physical: '9007199254740993:9007199254740993' });
  expect(f.closed()).toBe(1);
});
test.each(['dev', 'ino'] as const)('committed read rejects an adjacent %s even when Number would collide', async key => {
  const f = filesystem();
  expect(Number(9007199254740992n)).toBe(Number(9007199254740993n));
  f.change({ [key]: 9007199254740992n });
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).rejects.toThrow('Committed failed producer bytes changed');
  expect(f.closed()).toBe(1);
});
test.each(['mtimeNs', 'ctimeNs'] as const)('committed read rejects exact %s changes', async key => {
  const f = filesystem(); f.change({ [key]: 1700000000000000002n });
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).rejects.toThrow('Committed failed producer bytes changed');
  expect(f.closed()).toBe(1);
});
test('committed read checks the byte budget before reading and closes the descriptor', async () => {
  const f = filesystem();
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1, f.port)).rejects.toThrow('Committed failed producer physical identity');
  expect(f.reads()).toBe(0); expect(f.closed()).toBe(1);
});
test('committed read also refuses changed descriptor metadata after reading', async () => {
  const f = filesystem(); f.fdChange({ ctimeNs: 1700000000000000004n });
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).rejects.toThrow('Committed failed producer bytes changed');
  expect(f.closed()).toBe(1);
});
test('committed read bounds allocation to expected bytes plus one sentinel when the file grows', async () => {
  const f = filesystem(); f.grow();
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).rejects.toThrow('Committed failed producer bytes changed');
  expect(f.largestBuffer()).toBe(f.bytes.length + 1);
  expect(f.closed()).toBe(1);
});
test.each(['stat-before', 'read', 'stat-after', 'lstat'])('committed read closes the descriptor after %s throws', async phase => {
  const f = filesystem(); f.fail(phase);
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).rejects.toThrow('fixture ' + phase);
  expect(f.closed()).toBe(1);
});
test('committed read refuses a changed path file type and closes its descriptor', async () => {
  const f = filesystem(); f.change({ isFile: () => false });
  await expect(readCommittedLayerBytes('/virtual/failed.png', { identity, bytes: f.bytes }, 1024, f.port)).rejects.toThrow('Committed failed producer bytes changed');
  expect(f.closed()).toBe(1);
});
