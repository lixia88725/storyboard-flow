import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { OUTPUT_LEDGER_LIMIT, assertOutputLedgerBudget, orderedOutputNames, preflightOutputNames, prepareOutputRename, settleOutputRename, validOutputRename, type OutputRename } from './flowOutputRename.js';
import { createOutputTrash, validOutputDeletion, type OutputDeletion, type TrashItem } from './flowOutputTrash.js';
import { outputPath, settleOutputMove, type OutputMove } from './flowOutputMove.js';
import { snapshotProject } from '../core/persistence/validate.js';
import type { AssetReaderV1, ProjectV1 } from '../shared/refactorV1.js';
import type { TiffCodec } from '../core/formats/index.js';
import { writeManagedSourceFile } from './managedSourceSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const leaf = (s: unknown): s is string => typeof s === 'string' && /^[^\\/\0]+\.tiff?$/i.test(s) && !s.startsWith('.');
const id = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{1,80}$/.test(s);
type Entry = { shotId: string; name: string; original: string | null; current: string | null; pending?: string; location?: 'active' | 'parked'; move?: OutputMove; content?: string; deletion?: OutputDeletion; retired?: 'trashed' | 'absent-unpublished' };
export type TiffSourceBinding = { shotId: string; name: string; digest: string; location?: 'active' | 'parked' };
type Ledger = { version: 1; projectId: string; entries: Entry[]; rename?: OutputRename; saved?: { revision: number; projectHash: string } };
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
export async function openFlowTiffSave(root: string, projectId: string, codec: TiffCodec, trashItem?: TrashItem) {
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
  const trash = createOutputTrash(root, projectId, identity, bind, trashItem);
  const load = async (): Promise<{ ledger: Ledger; bytes: Buffer | null }> => {
    await bind(); const bytes = await optionalRead(ledgerPath, OUTPUT_LEDGER_LIMIT);
    if (!bytes) return { ledger: { version: 1, projectId, entries: [] }, bytes };
    const ledger: Ledger = JSON.parse(bytes.toString());
    if (ledger.version !== 1 || ledger.projectId !== projectId || !Array.isArray(ledger.entries) || ledger.entries.length > 10000 ||
        ledger.entries.some(e => !e || !id(e.shotId) || !leaf(e.name) ||
          e.original !== null && !digest(e.original) || e.current !== null && !digest(e.current) ||
          e.pending !== undefined && !digest(e.pending) || e.content !== undefined && !digest(e.content) ||
          e.location !== undefined && !['active', 'parked'].includes(e.location) ||
          e.retired !== undefined && !['trashed', 'absent-unpublished'].includes(e.retired) ||
          e.retired !== undefined && (e.current !== null || e.pending !== undefined || e.content !== undefined || e.move !== undefined || e.deletion !== undefined) ||
          e.deletion !== undefined && (!validOutputDeletion(e.deletion) || e.deletion.digest !== e.current || e.deletion.from !== (e.location ?? 'active') || e.pending !== undefined || e.move !== undefined) ||
          e.move !== undefined && (!e.move || !['active', 'parked'].includes(e.move.from) ||
            !['active', 'parked'].includes(e.move.to) || e.move.from === e.move.to ||
            e.move.from !== (e.location ?? 'active') || !digest(e.move.digest) || e.move.digest !== e.current ||
            !/^\d+$/.test(e.move.dev) || !/^\d+$/.test(e.move.ino))) ||
        new Set(ledger.entries.map(e => e.shotId)).size !== ledger.entries.length || new Set(ledger.entries.filter(e => !e.retired).map(e => e.name.toLowerCase())).size !== ledger.entries.filter(e => !e.retired).length)
      throw Error('Invalid TIFF output ledger');
    if (ledger.rename !== undefined && (!validOutputRename(ledger.rename) || ledger.rename.files.some(f => !ledger.entries.some(e => e.shotId === f.shotId && !e.retired && !e.deletion && e.name === f.from && e.current === f.digest && (e.location ?? 'active') === 'active' && !e.move && !e.pending)))) throw Error('Invalid bound rename journal');
    return { ledger, bytes };
  };
  const persist = async (ledger: Ledger, previous: Buffer | null) => {
    await bind(); const bytes = Buffer.from(JSON.stringify(ledger));
    if (bytes.length > OUTPUT_LEDGER_LIMIT) throw Error('TIFF output ledger exceeds the 8 MiB read/write limit');
    await writeManagedSourceFile(root, ledgerPath, bytes, previous ? { expectedDigest: hash(previous) } : { createOnly: true });
    return bytes;
  };
  const preserveOriginal = async (e: Entry, target: string) => {
    if (!e.original) return;
    const backup = path.join(root, '.storyboard-flow', 'originals', `${e.shotId}.tif`);
    const old = await optionalRead(backup);
    if (old) { if (hash(old) !== e.original) throw Error('Original backup mismatch'); }
    else {
      const original = await read(target);
      if (hash(original) !== e.original) throw Error('Missing original backup; refusing replacement');
      await bind(); await writeManagedSourceFile(root, backup, original, { createOnly: true, policySource: target });
    }
  };
  return {
    hasPendingTrashAcknowledgements: trash.hasPendingAcknowledgements,
    /** Main/import-owned binding only. Never infer original ownership from a filename alone. */
    bindSources(project: ProjectV1, sources: readonly TiffSourceBinding[], readOriginal: (source: TiffSourceBinding) => Promise<Uint8Array> = source => read(outputPath(root, source.name, source.location ?? 'active'))) {
      const captured = snapshotProject(project), mappings = structuredClone(sources);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        const state = await load();
        if (state.bytes) throw Error('Source bindings already initialized');
        for (const source of mappings) {
          if (!id(source.shotId) || !leaf(source.name) || !digest(source.digest) || !['active', 'parked'].includes(source.location ?? 'active') ||
              !(source.location === 'parked' ? captured.parkedShots : captured.shots).some(s => s.id === source.shotId) ||
              state.ledger.entries.some(e => e.shotId === source.shotId || e.name.toLowerCase() === source.name.toLowerCase())) throw Error('Invalid source binding');
          if (hash(await readOriginal(source)) !== source.digest) throw Error('Source changed since import');
          state.ledger.entries.push({ shotId: source.shotId, name: source.name, original: source.digest, current: source.digest, location: source.location ?? 'active' });
        }
        await persist(state.ledger, null);
      });
    },
    save(project: ProjectV1, reader: AssetReaderV1): Promise<TiffSaveReceipt> {
      const captured = snapshotProject(project);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        let { ledger, bytes } = await load();
        const recoverRename = async () => {
          if (!ledger.rename) return;
          await settleOutputRename(root, ledger.rename, async () => { bytes = await persist(ledger, bytes); }, bind);
          for (const file of ledger.rename.files) ledger.entries.find(e => e.shotId === file.shotId)!.name = file.to;
          delete ledger.rename;
          bytes = await persist(ledger, bytes);
        };
        await recoverRename();
        const retire = (entry: Entry, outcome: NonNullable<Entry['retired']>) => {
          entry.retired = outcome; entry.current = null;
          delete entry.content; delete entry.pending; delete entry.move; delete entry.deletion;
          delete ledger.saved;
        };
        // Finish only recorded effects, even when this Save follows an Undo.
        for (const entry of ledger.entries) if (entry.move) {
          await settleOutputMove(root, entry.name, entry.move, bind);
          entry.location = entry.move.to; delete entry.move;
          bytes = await persist(ledger, bytes);
        }
        for (const entry of ledger.entries) if (entry.deletion) {
          await trash.settle(entry.name, entry.deletion, async () => { bytes = await persist(ledger, bytes); });
          retire(entry, 'trashed'); bytes = await persist(ledger, bytes);
        }
        const allShots = [...captured.shots, ...captured.parkedShots];
        const wanted = new Set(allShots.map(s => s.id));
        for (const shot of allShots) {
          let entry = ledger.entries.find(e => e.shotId === shot.id);
          if (!entry || entry.retired) {
            const name = entry?.retired ? `${shot.id}-${randomUUID()}.tif` : `${shot.id}.tif`;
            if (ledger.entries.some(e => !e.retired && e.shotId !== shot.id && e.name.toLowerCase() === name.toLowerCase())) throw Error('Output name collision');
            if (!entry) { entry = { shotId: shot.id, name, original: null, current: null }; ledger.entries.push(entry); }
            entry.name = name; entry.current = null; delete entry.content; delete entry.pending; delete entry.retired;
            entry.location = captured.parkedShots.some(s => s.id === shot.id) ? 'parked' : 'active';
          }
        }
        if (ledger.entries.length > 10000) throw Error('TIFF output history exceeds 10000 entries; retained history is not automatically deleted');
        const live = () => ledger.entries.filter(e => !e.retired);
        const removed = live().filter(e => !wanted.has(e.shotId));
        const names = orderedOutputNames(captured, live().filter(e => wanted.has(e.shotId)));
        assertOutputLedgerBudget(ledger, names, removed.length * 1024);
        await preflightOutputNames(root, live(), names);
        const preflight = async () => {
          await bind();
          for (const entry of live()) {
            const content = await optionalRead(outputPath(root, entry.name, entry.location ?? 'active')); const actual = content && hash(content);
            if (actual !== entry.current && actual !== entry.pending) throw Error(`TIFF changed outside Flow: ${entry.name}`);
          }
        };
        await preflight();
        // Finish every codec/read failure before replacing any output file.
        const candidates: { entry: Entry; bytes?: Buffer; digest: string; content: string }[] = [];
        let total = 0;
        for (const shot of allShots) {
          const input = { image: captured.images[shot.imageId], text: { projectId, projectName: captured.name,
            shotId: shot.id, shotName: shot.name, scriptText: shot.scriptText, dialogues: captured.dialogues.filter(d => d.shotId === shot.id) } };
          const entry = ledger.entries.find(e => e.shotId === shot.id)!;
          const content = hash(Buffer.from(JSON.stringify(input)));
          if (entry.content === content && entry.current && !entry.pending) {
            candidates.push({ entry, digest: entry.current, content }); continue;
          }
          const encoded = await codec.encode(input, reader);
          if (!encoded.ok) throw Error(encoded.error.message);
          const output = Buffer.from(encoded.value); total += output.length;
          if (total > 512 * 1024 * 1024) throw Error('Prepared TIFF batch exceeds 512 MiB');
          candidates.push({ entry, bytes: output, digest: hash(output), content });
        }
        await preflight(); bytes = await persist(ledger, bytes);
        for (const entry of removed) {
          const target = outputPath(root, entry.name, entry.location ?? 'active');
          const present = await optionalRead(target), actual = present && hash(present);
          if (actual !== entry.current && actual !== entry.pending) throw Error('Deleted TIFF changed outside Flow');
          if (actual === null && entry.current === null && entry.original === null) {
            retire(entry, 'absent-unpublished'); bytes = await persist(ledger, bytes); continue;
          }
          if (!actual) throw Error('Deleted TIFF is missing; Trash not acknowledged');
          if (!trash.available()) throw Error('System Trash capability unavailable');
          await preserveOriginal(entry, target);
          entry.current = actual; delete entry.pending; delete ledger.saved;
          entry.deletion = await trash.prepare(entry.name, entry.location ?? 'active', actual);
          bytes = await persist(ledger, bytes);
          await trash.settle(entry.name, entry.deletion, async () => { bytes = await persist(ledger, bytes); });
          retire(entry, 'trashed'); bytes = await persist(ledger, bytes);
        }
        for (const candidate of candidates) {
          const e = candidate.entry, target = outputPath(root, e.name, e.location ?? 'active');
          await bind();
          await preserveOriginal(e, target);
          const current = await optionalRead(target), actual = current && hash(current);
          if (actual !== e.current && actual !== e.pending) throw Error('Output changed during Save');
          if (candidate.bytes) {
            e.pending = candidate.digest; delete ledger.saved; bytes = await persist(ledger, bytes);
            if (actual !== candidate.digest) { await bind(); await writeManagedSourceFile(root, target, candidate.bytes, actual === null ? { createOnly: true } : { expectedDigest: actual }); }
            if (hash(await read(target)) !== candidate.digest) throw Error('TIFF readback mismatch');
            e.current = candidate.digest; e.content = candidate.content; delete e.pending; bytes = await persist(ledger, bytes);
          }
          const destination = captured.parkedShots.some(s => s.id === e.shotId) ? 'parked' : 'active';
          if (destination !== (e.location ?? 'active')) {
            const identity = await fs.lstat(target, { bigint: true });
            delete ledger.saved;
            e.move = { from: e.location ?? 'active', to: destination, digest: candidate.digest, dev: String(identity.dev), ino: String(identity.ino) };
            bytes = await persist(ledger, bytes);
            await settleOutputMove(root, e.name, e.move, bind);
            e.location = destination; delete e.move;
            bytes = await persist(ledger, bytes);
          }
        }
        await preflight();
        await preflightOutputNames(root, live(), names);
        const rename = await prepareOutputRename(root, live(), names);
        if (rename) {
          delete ledger.saved; ledger.rename = rename;
          bytes = await persist(ledger, bytes);
          await recoverRename();
        }
        await preflight();
        const projectHash = hash(Buffer.from(JSON.stringify(captured)));
        ledger.saved = { revision: captured.revision, projectHash }; await persist(ledger, bytes);
        return { projectId, revision: captured.revision, projectHash, files: candidates.map(c => ({ shotId: c.entry.shotId, name: path.relative(root, outputPath(root, c.entry.name, c.entry.location ?? 'active')), digest: c.digest })) };
      });
    }
  };
}
