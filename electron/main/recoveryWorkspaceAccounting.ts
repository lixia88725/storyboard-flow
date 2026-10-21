import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RecoveryBudget } from './workspaceRecoveryStore.js';

/** Metadata-only accounting, NOT native permission/content certification. Each
 * directory entry is charged its complete encoded size, including hardlink
 * aliases, partial files and unknown residues. Errors never become free space.
 * Caller holds the original Main layer operation and supplies its private Root. */
export const scanRecoveryWorkspace = async (requested: string, budget: RecoveryBudget) => {
  if (!Number.isSafeInteger(budget.bytes) || budget.bytes <= 0 || !Number.isSafeInteger(budget.records) || budget.records <= 0) throw new Error('Recovery accounting unknown budget');
  const root = await fs.realpath(requested);
  if (root !== requested) throw new Error('Recovery accounting workspace alias');
  const metadata = path.join(root, '.storyboard-workbench');
  const parent = await fs.lstat(metadata, { bigint: true });
  if (!parent.isDirectory() || parent.isSymbolicLink() || await fs.realpath(metadata) !== metadata) throw new Error('Recovery accounting parent identity');
  const fingerprint = createHash('sha256');
  const snapshot = (s: typeof parent) => [s.dev, s.ino, s.uid, s.gid, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs, s.birthtimeNs].map(String);
  const same = (a: typeof parent, b: typeof parent) => { const left = snapshot(a), right = snapshot(b); return left.every((value, index) => value === right[index]); };
  let bytes = 0n, records = 0, queued = 0;
  const visit = async (file: string, depth: number): Promise<void> => {
    if (depth > 12 || ++records > budget.records) throw new Error('Recovery workspace inventory record/depth budget');
    const before = await fs.lstat(file, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory() && !before.isFile()) throw new Error('Recovery accounting unknown/link item');
    if (before.size < 0n) throw new Error('Recovery accounting unknown file size');
    if (before.isFile()) {
      bytes += before.size;
      if (bytes > BigInt(budget.bytes)) throw new Error('Accumulated workspace recovery byte budget exceeded');
    }
    fingerprint.update(JSON.stringify([path.relative(metadata, file), ...snapshot(before)]) + '\n');
    if (before.isDirectory()) {
      const names: string[] = [], directory = await fs.opendir(file);
      try {
        for (;;) {
          const entry = await directory.read(); if (!entry) break;
          if (records + queued >= budget.records) throw new Error('Recovery workspace inventory record/depth budget');
          names.push(entry.name); queued++;
        }
      } finally { await directory.close(); }
      for (const name of names.sort()) { queued--; await visit(path.join(file, name), depth + 1); }
    }
    const after = await fs.lstat(file, { bigint: true });
    if (!same(before, after)) throw new Error('Recovery workspace inventory changed');
  };
  for (const namespace of ['workspace-recovery-v1', 'workspace-recovery-v2']) {
    const base = path.join(metadata, namespace);
    try { await fs.lstat(base); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    await visit(base, 0);
  }
  const after = await fs.lstat(metadata, { bigint: true });
  if (!same(parent, after)) throw new Error('Recovery accounting parent changed');
  // Legitimate preview/layer siblings can change this parent's size/times/link
  // count between operations. Bind its incarnation and restrictions, not those
  // historical incidental fields; the read-window comparison above stays exact.
  fingerprint.update(JSON.stringify(['metadata-parent', ...[parent.dev, parent.ino, parent.uid, parent.gid, parent.mode, parent.birthtimeNs].map(String)]));
  return { bytes: Number(bytes), records, fingerprint: fingerprint.digest('hex') };
};
