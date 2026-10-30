import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { snapshotProject } from '../core/persistence/validate.js';
import type { AssetReaderV1, ProjectV1 } from '../shared/refactorV1.js';
import type { TiffCodec } from '../core/formats/index.js';
import { writeManagedSourceFile } from './managedSourceSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const leaf = (s: unknown): s is string => typeof s === 'string' && /^[^\\/\0]+\.tiff?$/i.test(s) && !s.startsWith('.');
const id = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{1,80}$/.test(s);
type Entry = { shotId: string; name: string; original: string | null; current: string | null; pending?: string };
type Ledger = { version: 1; projectId: string; entries: Entry[]; saved?: { revision: number; projectHash: string } };
export type TiffSaveReceipt = { projectId: string; revision: number; projectHash: string; files: { shotId: string; name: string; digest: string }[] };
const read = async (file: string, limit = 128 * 1024 * 1024): Promise<Buffer> => {
  if (await fs.realpath(file) !== file) throw Error('Aliased output path refused');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size > limit) throw Error('Unsupported output file');
    const bytes = await handle.readFile(); if (bytes.length > limit) throw Error('Output too large'); return bytes;
  } finally { await handle.close(); }
};
const optionalRead = async (file: string, limit?: number) => {
  try { return await read(file, limit); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
};

/** Explicit output only. Native policy/CAS writes, immutable originals and durable
 * per-file pending hashes. A partial failure never returns a Save receipt.
 * Caller serializes one writable project owner; roots/filenames never come from IPC. */
export async function openFlowTiffSave(root: string, projectId: string, codec: TiffCodec) {
  const canonical = await fs.realpath(root), identity = await fs.lstat(root);
  if (canonical !== root || !identity.isDirectory() || identity.isSymbolicLink() || !id(projectId)) throw Error('Invalid output root/project');
  const ledgerPath = path.join(root, '.storyboard-flow', 'tiff-output.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const bind = async () => {
    const now = await fs.lstat(root);
    if (await fs.realpath(root) !== root || now.dev !== identity.dev || now.ino !== identity.ino || !now.isDirectory() || now.isSymbolicLink()) throw Error('Output root changed');
    await assertPhysicalWorkspaceWriterTargets([root]);
  };
  const load = async (): Promise<{ ledger: Ledger; bytes: Buffer | null }> => {
    await bind(); const bytes = await optionalRead(ledgerPath, 8 * 1024 * 1024);
    if (!bytes) return { ledger: { version: 1, projectId, entries: [] }, bytes };
    const ledger: Ledger = JSON.parse(bytes.toString());
    if (ledger.version !== 1 || ledger.projectId !== projectId || !Array.isArray(ledger.entries) || ledger.entries.length > 10000 ||
        ledger.entries.some(e => !e || !id(e.shotId) || !leaf(e.name) || e.original !== null && !digest(e.original) || e.current !== null && !digest(e.current) || e.pending !== undefined && !digest(e.pending)) ||
        new Set(ledger.entries.map(e => e.shotId)).size !== ledger.entries.length || new Set(ledger.entries.map(e => e.name.toLowerCase())).size !== ledger.entries.length)
      throw Error('Invalid TIFF output ledger');
    return { ledger, bytes };
  };
  const persist = async (ledger: Ledger, previous: Buffer | null) => {
    await bind(); const bytes = Buffer.from(JSON.stringify(ledger));
    await writeManagedSourceFile(root, ledgerPath, bytes, previous ? { expectedDigest: hash(previous) } : { createOnly: true });
    return bytes;
  };
  return {
    /** Main/import-owned binding only. Never infer original ownership from a filename alone. */
    bindSources(project: ProjectV1, sources: readonly { shotId: string; name: string; digest: string }[]) {
      const captured = snapshotProject(project), mappings = structuredClone(sources);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        const state = await load();
        if (state.bytes) throw Error('Source bindings already initialized');
        for (const source of mappings) {
          if (!id(source.shotId) || !leaf(source.name) || !digest(source.digest) || !captured.shots.some(s => s.id === source.shotId) ||
              state.ledger.entries.some(e => e.shotId === source.shotId || e.name.toLowerCase() === source.name.toLowerCase())) throw Error('Invalid source binding');
          if (hash(await read(path.join(root, source.name))) !== source.digest) throw Error('Source changed since import');
          state.ledger.entries.push({ shotId: source.shotId, name: source.name, original: source.digest, current: source.digest });
        }
        await persist(state.ledger, null);
      });
    },
    save(project: ProjectV1, reader: AssetReaderV1): Promise<TiffSaveReceipt> {
      const captured = snapshotProject(project);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        let { ledger, bytes } = await load();
        // Membership changes need the separate output/Trash/Pending transaction;
        // refuse rather than silently leave a deleted shot on disk and claim success.
        if (ledger.entries.some(e => !captured.shots.some(s => s.id === e.shotId))) throw Error('Output membership changed; lifecycle transaction required');
        for (const shot of captured.shots) {
          if (!ledger.entries.some(e => e.shotId === shot.id)) {
            const name = `${shot.id}.tif`;
            if (ledger.entries.some(e => e.name.toLowerCase() === name.toLowerCase())) throw Error('Output name collision');
            ledger.entries.push({ shotId: shot.id, name, original: null, current: null });
          }
        }
        const preflight = async () => {
          await bind();
          for (const entry of ledger.entries) {
            const content = await optionalRead(path.join(root, entry.name)); const actual = content && hash(content);
            if (actual !== entry.current && actual !== entry.pending) throw Error(`TIFF changed outside Flow: ${entry.name}`);
          }
        };
        await preflight();
        // Finish every codec/read failure before replacing any output file.
        const candidates: { entry: Entry; bytes: Buffer; digest: string }[] = [];
        let total = 0;
        for (const shot of captured.shots) {
          const encoded = await codec.encode({ image: captured.images[shot.imageId], text: { projectId, projectName: captured.name,
            shotId: shot.id, shotName: shot.name, scriptText: shot.scriptText, dialogues: captured.dialogues.filter(d => d.shotId === shot.id) } }, reader);
          if (!encoded.ok) throw Error(encoded.error.message);
          const output = Buffer.from(encoded.value); total += output.length;
          if (total > 512 * 1024 * 1024) throw Error('Prepared TIFF batch exceeds 512 MiB');
          candidates.push({ entry: ledger.entries.find(e => e.shotId === shot.id)!, bytes: output, digest: hash(output) });
        }
        await preflight(); bytes = await persist(ledger, bytes);
        for (const candidate of candidates) {
          const e = candidate.entry, target = path.join(root, e.name);
          await bind();
          if (e.original) {
            const backup = path.join(root, '.storyboard-flow', 'originals', `${e.shotId}.tif`);
            const old = await optionalRead(backup);
            if (old) { if (hash(old) !== e.original) throw Error('Original backup mismatch'); }
            else {
              const original = await read(target); if (hash(original) !== e.original) throw Error('Missing original backup; refusing replacement');
              await bind(); await writeManagedSourceFile(root, backup, original, { createOnly: true, policySource: target });
            }
          }
          const current = await optionalRead(target), actual = current && hash(current);
          if (actual !== e.current && actual !== e.pending) throw Error('Output changed during Save');
          e.pending = candidate.digest; delete ledger.saved; bytes = await persist(ledger, bytes);
          if (actual !== candidate.digest) { await bind(); await writeManagedSourceFile(root, target, candidate.bytes, actual === null ? { createOnly: true } : { expectedDigest: actual }); }
          if (hash(await read(target)) !== candidate.digest) throw Error('TIFF readback mismatch');
          e.current = candidate.digest; delete e.pending; bytes = await persist(ledger, bytes);
        }
        await preflight();
        const projectHash = hash(Buffer.from(JSON.stringify(captured)));
        ledger.saved = { revision: captured.revision, projectHash }; await persist(ledger, bytes);
        return { projectId, revision: captured.revision, projectHash, files: candidates.map(c => ({ shotId: c.entry.shotId, name: c.entry.name, digest: c.digest })) };
      });
    }
  };
}
