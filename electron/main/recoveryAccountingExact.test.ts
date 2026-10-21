import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRecoveryWorkspace } from './recoveryWorkspaceAccounting';

const budget = { bytes: 1024, records: 20, assets: 8, jsonDepth: 80 };
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-accounting-exact-'));
  const base = path.join(root, '.storyboard-workbench/workspace-recovery-v1');
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const file = path.join(base, 'partial');
  await fs.writeFile(file, 'abc', { mode: 0o600 });
  return { root, file };
};

test('joint project fingerprint distinguishes exact inode identities lost by Number conversion', async () => {
  const f = await fixture(), real = fs.lstat.bind(fs);
  let inode = 9007199254740992n;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation((async (file: any, options: any) => {
    const s = await real(file, options);
    return file === f.file ? new Proxy(s, { get: (target, key) => key === 'ino' ? options?.bigint ? inode : Number(inode) : Reflect.get(target, key) }) : s;
  }) as any);
  try {
    const before = await scanRecoveryWorkspace(f.root, budget);
    inode = 9007199254740993n;
    const after = await scanRecoveryWorkspace(f.root, budget);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.bytes).toBe(3);
  } finally { spy.mockRestore(); }
});

test.each(['mode', 'uid', 'mtimeNs', 'ctimeNs'] as const)('project accounting refuses a read-window %s change with unchanged numeric ms', async field => {
  const f = await fixture(), real = fs.lstat.bind(fs);
  let reads = 0;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation((async (file: any, options: any) => {
    const s = await real(file, options);
    if (file !== f.file || ++reads < 2) return s;
    return new Proxy(s, { get: (target, key) => {
      const value = Reflect.get(target, key);
      return key === field ? typeof value === 'bigint' ? value + 1n : (value ?? 0) + 1 : value;
    } });
  }) as any);
  try { await expect(scanRecoveryWorkspace(f.root, budget)).rejects.toThrow('inventory changed'); }
  finally { spy.mockRestore(); }
});
