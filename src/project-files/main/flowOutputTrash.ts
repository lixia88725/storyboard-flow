import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { syncDirectory } from '../../platform/main/platform/index.js';
import { outputPath, settleOutputFileMove } from './flowOutputMove.js';

export type TrashItem = (file: string) => Promise<void>;
export type OutputDeletion = {
  token: string; from: 'active' | 'parked'; phase: 'stage' | 'ready' | 'dispatching' | 'confirmed';
  digest: string; dev: string; ino: string; directoryDev: string; directoryIno: string;
};
export function validOutputDeletion(value: unknown): value is OutputDeletion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as OutputDeletion;
  return Object.keys(d).length === 8 && typeof d.token === 'string' && /^[a-f0-9-]{36}$/.test(d.token) &&
    ['active', 'parked'].includes(d.from) && ['stage', 'ready', 'dispatching', 'confirmed'].includes(d.phase) &&
    typeof d.digest === 'string' && /^[a-f0-9]{64}$/.test(d.digest) &&
    [d.dev, d.ino, d.directoryDev, d.directoryIno].every(v => typeof v === 'string' && /^\d{1,32}$/.test(v));
}

/** Main-only Trash capability. No renderer path, unlink fallback or missing-file ACK.
 * An in-memory OS acknowledgement cannot be discarded until its phase is durable. */
export function createOutputTrash(root: string, projectId: string, rootIdentity: { dev: number; ino: number }, bind: () => Promise<void>, trashItem?: TrashItem) {
  const acknowledged = new Set<string>();
  const container = path.join(root, '.storyboard-flow', 'deletions');
  const directory = async (file: string) => {
    const stat = await fs.lstat(file, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file) throw Error('Trash staging directory is aliased or replaced');
    return stat;
  };
  const parents = async () => { await bind(); await directory(path.join(root, '.storyboard-flow')); await directory(container); };
  const stageDirectory = async (intent: OutputDeletion) => {
    await parents();
    const dir = path.join(container, intent.token), st = await directory(dir);
    if (String(st.dev) !== intent.directoryDev || String(st.ino) !== intent.directoryIno) throw Error('Trash staging directory identity changed');
    return dir;
  };
  const key = (name: string, d: OutputDeletion) => JSON.stringify([root, rootIdentity.dev, rootIdentity.ino, projectId, name, d.token, d.from, d.digest, d.dev, d.ino, d.directoryDev, d.directoryIno]);
  const staged = async (name: string, intent: OutputDeletion) => {
    const file = path.join(await stageDirectory(intent), name);
    let handle;
    try { handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const st = await handle.stat({ bigint: true });
      if (!st.isFile() || st.nlink !== 1n || st.size > 128n * 1024n * 1024n || String(st.dev) !== intent.dev || String(st.ino) !== intent.ino) throw Error('Staged TIFF identity changed; retained');
      const bytes = await handle.readFile();
      if (bytes.length > 128 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== intent.digest) throw Error('Staged TIFF content changed; retained');
      const entry = await fs.lstat(file, { bigint: true });
      if (entry.isSymbolicLink() || entry.dev !== st.dev || entry.ino !== st.ino) throw Error('Staged TIFF replaced while reading');
      return file;
    } finally { await handle.close(); }
  };
  return {
    available: () => trashItem !== undefined,
    hasPendingAcknowledgements: () => acknowledged.size > 0,
    async recovery(name: string, intent: OutputDeletion) {
      if (intent.phase !== 'dispatching') return;
      const directory = '.storyboard-flow/deletions/' + intent.token;
      try {
        const file = await staged(name, intent);
        const ack = acknowledged.has(key(name, intent));
        const state = file && ack ? 'inspect' : file || ack ? 'retry' : 'restore';
        return { kind: 'trash-recovery', name, directory, state } as const;
      } catch {
        return { kind: 'trash-recovery', name, directory, state: 'inspect' } as const;
      }
    },
    async prepare(name: string, from: 'active' | 'parked', digest: string): Promise<OutputDeletion> {
      if (!trashItem) throw Error('System Trash capability unavailable');
      await bind(); await directory(path.join(root, '.storyboard-flow'));
      try { await fs.mkdir(container, { mode: 0o700 }); await syncDirectory(path.dirname(container)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await parents();
      const token = randomUUID(), dir = path.join(container, token);
      await fs.mkdir(dir, { mode: 0o700 }); await syncDirectory(container);
      const owner = await directory(dir), source = await fs.lstat(outputPath(root, name, from), { bigint: true });
      if (!source.isFile() || source.isSymbolicLink() || source.nlink !== 1n) throw Error('Unsupported deleted TIFF source');
      const intent: OutputDeletion = { token, from, phase: 'stage', digest, dev: String(source.dev), ino: String(source.ino), directoryDev: String(owner.dev), directoryIno: String(owner.ino) };
      if (!validOutputDeletion(intent)) throw Error('Invalid deletion intent');
      return intent;
    },
    async settle(name: string, intent: OutputDeletion, persist: () => Promise<void>) {
      if (!validOutputDeletion(intent)) throw Error('Invalid deletion intent');
      const receiptKey = key(name, intent);
      if (!trashItem && intent.phase !== 'confirmed' && !acknowledged.has(receiptKey)) throw Error('System Trash capability unavailable');
      if (intent.phase === 'stage') {
        await settleOutputFileMove(outputPath(root, name, intent.from), path.join(await stageDirectory(intent), name), intent, async () => { await stageDirectory(intent); });
        intent.phase = 'ready'; await persist();
      }
      const file = await staged(name, intent);
      if (intent.phase === 'confirmed') {
        if (file) throw Error('A file reappeared after confirmed Trash; retained');
        if (acknowledged.has(receiptKey)) await persist();
        acknowledged.delete(receiptKey); return;
      }
      if (!file) {
        if (!acknowledged.has(receiptKey)) throw Error('Trash completion is unknown; staged TIFF is missing without acknowledgement. Retain the project and restore the staged file before retrying.');
      } else {
        if (acknowledged.has(receiptKey)) throw Error('A file reappeared after Trash acknowledgement; retained');
        if (!trashItem) throw Error('System Trash capability unavailable');
        intent.phase = 'dispatching'; await persist();
        const checked = await staged(name, intent);
        if (!checked) throw Error('Staged TIFF disappeared before Trash dispatch');
        await trashItem(checked);
        // Cache the real OS response before readback or persistence can fail.
        acknowledged.add(receiptKey);
        if (await staged(name, intent)) throw Error('System Trash returned without removing the staged TIFF');
      }
      await syncDirectory(await stageDirectory(intent));
      intent.phase = 'confirmed'; await persist();
      acknowledged.delete(receiptKey);
    }
  };
}
