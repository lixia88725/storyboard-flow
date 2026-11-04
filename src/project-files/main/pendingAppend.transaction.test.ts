import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createImageProject } from './createImageProject';
import { openFlowEditorRuntime } from './flowEditorRuntime';
import { openFlowTiffSave } from './flowTiffSave';
import { openFlowAssetDepot } from './persistence/depot';
import { createProjectStore } from './persistence/index.js';
import { createTiffCodec } from './formats/index.js';
import { createPresentationCodec } from './formats/presentation.js';
import { flowCodecOptions } from '../../platform/main/flowRuntimePaths.js';
import { preparePendingAdd } from './appendPendingImages';
import { pendingOutput } from '../../platform/main/platform/index.js';
import { consumePendingNameGrowth, PENDING_ADD_BATCH_LIMIT, PENDING_ADD_STAGE_LIMIT } from './flowTiffSave';
import type { AssetReaderV1, ProjectV1 } from '../../platform/contracts/refactorV1.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const solid = (r: number, g: number, b: number) => sharp({ create: { width: 4, height: 3, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
const codec = () => createPresentationCodec(createTiffCodec(flowCodecOptions()));

async function project() {
  const root = await temporaryWorkspace('flow-pending-tx-');
  const sources = path.join(root, 'sources');
  await fs.mkdir(sources);
  for (const [index, name] of ['one.png', 'two.png'].entries()) await fs.writeFile(path.join(sources, name), await solid(10 * index, 20, 30));
  const { root: created } = await createImageProject({
    source: { kind: 'folder', folder: sources }, destinationParent: root, folderName: 'Proj', name: 'Proj',
    naming: { sceneCode: 'S01', artistName: 'Li', version: '1' }
  }, { signal: new AbortController().signal });
  const loaded = await createProjectStore().loadCheckpoint(created);
  if (!loaded.ok) throw Error(loaded.error.message);
  return { root: created, project: loaded.value.project };
}

async function addSource(root: string, name: string, rgb: [number, number, number]) {
  const folder = path.join(root, 'add-' + name.replace(/\W/g, ''));
  await fs.mkdir(folder);
  const file = path.join(folder, name);
  await fs.writeFile(file, await solid(...rgb));
  return file;
}

async function topLevelDigests(root: string) {
  const result: Record<string, string> = {};
  for (const name of await fs.readdir(root)) {
    if (!name.endsWith('.tif')) continue;
    result[name] = hash(await fs.readFile(path.join(root, name)));
  }
  return result;
}

async function ledger(root: string) {
  return JSON.parse(await fs.readFile(path.join(root, '.storyboard-flow', 'tiff-output.json'), 'utf8'));
}

async function checkpoint(root: string): Promise<ProjectV1> {
  const loaded = await createProjectStore().loadCheckpoint(root);
  if (!loaded.ok) throw Error(loaded.error.message);
  return loaded.value.project;
}

describe('appendPending transaction', () => {
  it('materialises only the added Pending file and never rewrites existing working TIFFs', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const before = await topLevelDigests(root);
    // Simulate the Session flush: an edited (unsaved) board is checkpointed but
    // its working TIFF still holds the previous pixels/text.
    const edited = structuredClone(current);
    edited.revision += 1;
    edited.shots[0].scriptText = 'edited but not saved';
    expect((await runtime.checkpoint(edited)).ok).toBe(true);
    // A foreign Pending leaf occupies the natural name; the append must step aside.
    await fs.mkdir(path.join(root, 'Pending'));
    await fs.writeFile(path.join(root, 'Pending', 'panel.tif'), 'foreign');
    const file = await addSource(root, 'panel.png', [90, 80, 70]);
    const result = await runtime.appendPending(edited, { source: { kind: 'files', files: [file] }, operationId: 'op-append-1' }, { signal: new AbortController().signal });
    if (!result.ok) throw Error(result.error.message);
    expect(result.ok).toBe(true);
    const { project: after, added } = result.value;
    expect(after.revision).toBe(edited.revision + 1);
    expect(after.shots).toEqual(edited.shots);
    expect(after.parkedShots).toHaveLength(1);
    expect(after.parkedShots[0].name).toBe('panel');
    expect(added[0].name).toBe('panel-2.tif');
    // Every pre-existing working TIFF kept its exact bytes.
    expect(await topLevelDigests(root)).toEqual(before);
    // The foreign file was never adopted, overwritten or removed.
    expect(await fs.readFile(path.join(root, 'Pending', 'panel.tif'), 'utf8')).toBe('foreign');
    const output = path.join(root, 'Pending', 'panel-2.tif');
    expect(hash(await fs.readFile(output))).toBe(added[0].digest);
    // The ledger entry is parked, published and bound to the written bytes.
    const entries = (await ledger(root)).entries.filter((entry: { shotId: string }) => entry.shotId === added[0].shotId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'panel-2.tif', location: 'parked', published: true, current: added[0].digest });
    expect(entries[0].original).toBe(added[0].digest);
    // The durable checkpoint already contains the appended board.
    expect((await checkpoint(root)).parkedShots.map(shot => shot.id)).toEqual([added[0].shotId]);
  }, 120_000);

  it('lets a later explicit Save reuse the added TIFF without rewriting it', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'reuse.png', [5, 6, 7]);
    const appended = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-append-1' }, { signal: new AbortController().signal });
    if (!appended.ok) throw Error(appended.error.message);
    expect(appended.ok).toBe(true);
    const output = path.join(root, 'Pending', appended.value.added[0].name);
    const before = await fs.lstat(output, { bigint: true }), bytes = await fs.readFile(output);
    const saved = await runtime.saveTiff(appended.value.project);
    expect(saved.ok).toBe(true);
    const after = await fs.lstat(output, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(await fs.readFile(output)).toEqual(bytes);
    const status = await runtime.folderStatus({ project: appended.value.project, inspectDisk: true });
    expect(status).toBe('current');
  }, 120_000);

  it('recovers an interrupted append from the journal and the persisted bytes', async () => {
    const { root, project: current } = await project();
    const rawCodec = createTiffCodec(flowCodecOptions());
    const depot = await openFlowAssetDepot({ root, sessionId: 'tx', maxPixels: 16_000_000, maxPngBytes: 32 * 1024 * 1024 });
    if (!depot.ok) throw Error(depot.error.message);
    const store = createProjectStore();
    const output = await openFlowTiffSave(root, current.id, rawCodec);
    const readAsset: AssetReaderV1 = async id => { const r = await depot.value.read(id); if (!r.ok) throw Error(r.error.message); return r.value; };
    const file = await addSource(root, 'crash.png', [11, 22, 33]);
    const plan = await preparePendingAdd(current, { kind: 'files', files: [file] }, { signal: new AbortController().signal }, { codec: codec(), depot: depot.value });
    const additions = plan.additions.map(addition => {
      const original = addition.original;
      return original.kind === 'source'
        ? { shot: addition.shot, image: addition.image, dialogues: addition.dialogues, basis: addition.basis,
            original: { kind: 'source' as const, digest: original.digest, read: async () => fs.readFile(original.source.file) } }
        : { shot: addition.shot, image: addition.image, dialogues: addition.dialogues, basis: addition.basis, original: { kind: 'output' as const } };
    });
    const realSave = async (project: ProjectV1) => {
      const saved = await store.saveCheckpoint(root, project, readAsset);
      if (!saved.ok) throw Error(saved.error.message);
    };
    let savedOnce = false;
    const access = {
      load: async () => {
        if (savedOnce) { savedOnce = false; throw Error('simulated interruption'); }
        const loaded = await store.loadCheckpoint(root);
        if (!loaded.ok) throw Error(loaded.error.message);
        return loaded.value.project;
      },
      save: async (project: ProjectV1) => { await realSave(project); savedOnce = true; }
    };
    await expect(output.appendPending(current, additions, readAsset, access, 'op-crash')).rejects.toThrow('simulated interruption');
    const pendingFile = path.join(root, 'Pending', additions[0].basis + '.tif');
    expect(await fs.stat(pendingFile)).toBeTruthy();
    const journal = (await ledger(root)).add;
    expect(journal).toMatchObject({ complete: false });
    const reopened = await openFlowEditorRuntime(root);
    const recovered = await checkpoint(root);
    expect(recovered.parkedShots.map(shot => shot.id)).toEqual([plan.project.parkedShots[0].id]);
    expect((await ledger(root)).add).toMatchObject({ complete: true });
    expect((await reopened.folderStatus({ project: recovered, inspectDisk: true }))).toBe('current');
  }, 120_000);

  it('recreates a published Pending output whose target was removed with a fresh inode', async () => {
    const { root, project: current } = await project();
    const journal = await interruptedAppend(root, current, 'orphan.png', [1, 2, 4]);
    const pendingFile = path.join(root, 'Pending', journal.additions[0].name);
    const removed = await fs.lstat(pendingFile, { bigint: true });
    await fs.unlink(pendingFile);
    await openFlowEditorRuntime(root);
    const recreated = await fs.lstat(pendingFile, { bigint: true });
    expect(String(recreated.ino)).not.toBe(String(removed.ino));
    expect(hash(await fs.readFile(pendingFile))).toBe(journal.additions[0].digest);
    expect((await ledger(root)).add).toMatchObject({ complete: true });
  }, 120_000);

  it('refuses when both the target and the staged bytes are gone', async () => {
    const { root, project: current } = await project();
    const journal = await interruptedAppend(root, current, 'lost.png', [1, 2, 5]);
    const pendingFile = path.join(root, 'Pending', journal.additions[0].name);
    await fs.unlink(pendingFile);
    await fs.unlink(path.join(root, '.storyboard-flow', 'pending-add', 'blobs', journal.additions[0].staged));
    await expect(openFlowEditorRuntime(root)).rejects.toThrow('Prepared Pending TIFF is unavailable');
    await expect(fs.lstat(pendingFile)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('answers recover with the durable after without appending a second time', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'again.png', [9, 9, 9]);
    const first = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-append-1' }, { signal: new AbortController().signal });
    if (!first.ok) throw Error(first.error.message);
    expect(first.ok).toBe(true);
    const entries = (await ledger(root)).entries.length;
    const second = await runtime.appendPending(first.value.project, { recover: true, operationId: 'op-append-1' }, { signal: new AbortController().signal });
    expect(second.ok).toBe(true);
    if (!second.ok) throw Error(second.error.message);
    expect(second.value.added).toEqual(first.value.added);
    expect(second.value.project.parkedShots).toEqual(first.value.project.parkedShots);
    expect((await ledger(root)).entries.length).toBe(entries);
    expect((await fs.readdir(path.join(root, 'Pending'))).length).toBe(1);
  }, 120_000);

  it('cancels before the journal with no Pending output and an unchanged ledger', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const ledgerBefore = hash(await fs.readFile(path.join(root, '.storyboard-flow', 'tiff-output.json')));
    const folder = path.join(root, 'cancel');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'broken.png'), 'not an image');
    const result = await runtime.appendPending(current, { source: { kind: 'folder', folder }, operationId: 'op-cancel' },
      { signal: new AbortController().signal, decideIssues: async () => 'cancel' });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('cancel must not succeed');
    expect(result.error.effect).toBe('none');
    expect(hash(await fs.readFile(path.join(root, '.storyboard-flow', 'tiff-output.json')))).toBe(ledgerBefore);
    await expect(fs.lstat(path.join(root, 'Pending'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('keeps an undone added board on disk until the next explicit Save moves it to Trash', async () => {
    const { root, project: current } = await project();
    const trashed: string[] = [];
    const runtime = await openFlowEditorRuntime(root, async file => { trashed.push(file); await fs.rm(file); });
    const file = await addSource(root, 'undo.png', [8, 7, 6]);
    const appended = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-append-1' }, { signal: new AbortController().signal });
    if (!appended.ok) throw Error(appended.error.message);
    const output = path.join(root, 'Pending', appended.value.added[0].name);
    const undone = structuredClone(appended.value.project);
    undone.parkedShots = [];
    undone.revision += 1;
    expect((await runtime.checkpoint(undone)).ok).toBe(true);
    // Undo is a project edit only: nothing has gone to Trash yet.
    expect(await fs.stat(output)).toBeTruthy();
    expect(trashed).toHaveLength(0);
    const saved = await runtime.saveTiff(undone);
    expect(saved.ok).toBe(true);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toContain(appended.value.added[0].name);
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('accepts a TIFF source through the append seam without cloning its reader', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const tiffName = (await fs.readdir(root)).find(name => name.endsWith('_0010.tif'))!;
    const source = path.join(root, tiffName), sourceBytes = await fs.readFile(source);
    const result = await runtime.appendPending(current, { source: { kind: 'files', files: [source] }, operationId: 'op-tiff' },
      { signal: new AbortController().signal });
    if (!result.ok) throw Error(result.error.message);
    const added = result.value.added[0], shot = result.value.project.parkedShots[0];
    expect(result.value.project.images[shot.imageId].layers).toHaveLength(1);
    // The leaf collides with the active board's name on disk, so it steps aside.
    expect(added.name).toBe(tiffName.replace(/\.tif$/i, '') + '-2.tif');
    const original = await fs.readFile(path.join(root, '.storyboard-flow', 'originals', added.shotId + '.tif'));
    expect(hash(original)).toBe(hash(sourceBytes));
  }, 120_000);

  it('never re-checks a completed receipt against an older checkpoint after edits and reopen', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'later.png', [3, 4, 5]);
    const appended = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-later' },
      { signal: new AbortController().signal });
    if (!appended.ok) throw Error(appended.error.message);
    const edited = structuredClone(appended.value.project);
    edited.shots[0].scriptText = 'changed after the append';
    edited.revision += 1;
    expect((await runtime.checkpoint(edited)).ok).toBe(true);
    // A normal reopen must not fail because the receipt's afterHash is now stale.
    const reopened = await openFlowEditorRuntime(root);
    const opened = reopened.open().project;
    expect(opened.parkedShots).toHaveLength(1);
    expect(opened.shots[0].scriptText).toBe('changed after the append');
  }, 120_000);

  it('refuses a receipt owned by another operation id and never reinstalls it', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'owner.png', [6, 5, 4]);
    const appended = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-owner' },
      { signal: new AbortController().signal });
    if (!appended.ok) throw Error(appended.error.message);
    const foreign = await runtime.appendPending(appended.value.project, { recover: true, operationId: 'op-foreign' },
      { signal: new AbortController().signal });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw Error('a foreign operation id must not claim the receipt');
    expect(foreign.error.message).toMatch(/different Pending add/i);
    const own = await runtime.appendPending(appended.value.project, { recover: true, operationId: 'op-owner' },
      { signal: new AbortController().signal });
    if (!own.ok) throw Error(own.error.message);
    expect(own.value.added).toEqual(appended.value.added);
  }, 120_000);

  it('never writes a target when the staged inode was replaced', async () => {
    const root = await temporaryWorkspace('flow-pending-native-');
    const stageDir = path.join(root, 'stage'), pendingDir = path.join(root, 'pending');
    await fs.mkdir(stageDir); await fs.mkdir(pendingDir);
    const staged = path.join(stageDir, 'one.tif');
    await fs.writeFile(staged, 'ours');
    const file = await fs.lstat(staged, { bigint: true });
    const dirs = { stage: await fs.lstat(stageDir, { bigint: true }), pending: await fs.lstat(pendingDir, { bigint: true }) };
    const base = { stageDir, stageName: 'one.tif', pendingDir, targetName: 'one.tif',
      fileDev: String(file.dev), fileIno: String(file.ino),
      stageDev: String(dirs.stage.dev), stageIno: String(dirs.stage.ino),
      pendingDev: String(dirs.pending.dev), pendingIno: String(dirs.pending.ino) };
    const created = await pendingOutput('create', base);
    if (!created.ok) throw Error(created.message);
    await fs.unlink(staged); await fs.writeFile(staged, 'foreign');
    const written = await pendingOutput('write', { ...base, targetDev: created.dev, targetIno: created.ino });
    expect(written.ok).toBe(false);
    if (written.ok) throw Error('a replaced staged inode must not be read');
    expect(written.code).toBe('staged');
    expect((await fs.stat(path.join(pendingDir, 'one.tif'))).size).toBe(0);
    expect(await fs.readFile(staged, 'utf8')).toBe('foreign');
  }, 60_000);

  it('never replaces a foreign Pending target and leaves both files in place', async () => {
    const root = await temporaryWorkspace('flow-pending-native2-');
    const stageDir = path.join(root, 'stage'), pendingDir = path.join(root, 'pending');
    await fs.mkdir(stageDir); await fs.mkdir(pendingDir);
    const staged = path.join(stageDir, 'one.tif'), target = path.join(pendingDir, 'one.tif');
    await fs.writeFile(staged, 'ours'); await fs.writeFile(target, 'foreign');
    const file = await fs.lstat(staged, { bigint: true });
    const dirs = { stage: await fs.lstat(stageDir, { bigint: true }), pending: await fs.lstat(pendingDir, { bigint: true }) };
    const result = await pendingOutput('create', { stageDir, stageName: 'one.tif', pendingDir, targetName: 'one.tif',
      fileDev: String(file.dev), fileIno: String(file.ino),
      stageDev: String(dirs.stage.dev), stageIno: String(dirs.stage.ino),
      pendingDev: String(dirs.pending.dev), pendingIno: String(dirs.pending.ino) });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('a foreign target must not be adopted');
    expect(result.code).toBe('exists');
    expect(await fs.readFile(target, 'utf8')).toBe('foreign');
    expect(await fs.readFile(staged, 'utf8')).toBe('ours');
  }, 60_000);

  it('never truncates a target whose inode was replaced after creation', async () => {
    const root = await temporaryWorkspace('flow-pending-native3-');
    const stageDir = path.join(root, 'stage'), pendingDir = path.join(root, 'pending');
    await fs.mkdir(stageDir); await fs.mkdir(pendingDir);
    const staged = path.join(stageDir, 'one.tif'), target = path.join(pendingDir, 'one.tif');
    await fs.writeFile(staged, 'ours');
    const file = await fs.lstat(staged, { bigint: true });
    const dirs = { stage: await fs.lstat(stageDir, { bigint: true }), pending: await fs.lstat(pendingDir, { bigint: true }) };
    const base = { stageDir, stageName: 'one.tif', pendingDir, targetName: 'one.tif',
      fileDev: String(file.dev), fileIno: String(file.ino),
      stageDev: String(dirs.stage.dev), stageIno: String(dirs.stage.ino),
      pendingDev: String(dirs.pending.dev), pendingIno: String(dirs.pending.ino) };
    const created = await pendingOutput('create', base);
    if (!created.ok) throw Error(created.message);
    const first = await pendingOutput('write', { ...base, targetDev: created.dev, targetIno: created.ino });
    expect(first.ok).toBe(true);
    await fs.unlink(target); await fs.writeFile(target, 'foreign');
    const second = await pendingOutput('write', { ...base, targetDev: created.dev, targetIno: created.ino });
    expect(second.ok).toBe(false);
    if (second.ok) throw Error('a replaced target must not be truncated');
    expect(second.code).toBe('target');
    expect(await fs.readFile(target, 'utf8')).toBe('foreign');
    expect(await fs.readFile(staged, 'utf8')).toBe('ours');
  }, 60_000);

  it('rewrites its own registered target idempotently and keeps the staged bytes', async () => {
    const root = await temporaryWorkspace('flow-pending-native4-');
    const stageDir = path.join(root, 'stage'), pendingDir = path.join(root, 'pending');
    await fs.mkdir(stageDir); await fs.mkdir(pendingDir);
    const staged = path.join(stageDir, 'one.tif'), target = path.join(pendingDir, 'one.tif');
    await fs.writeFile(staged, 'ours');
    const file = await fs.lstat(staged, { bigint: true });
    const dirs = { stage: await fs.lstat(stageDir, { bigint: true }), pending: await fs.lstat(pendingDir, { bigint: true }) };
    const base = { stageDir, stageName: 'one.tif', pendingDir, targetName: 'one.tif',
      fileDev: String(file.dev), fileIno: String(file.ino),
      stageDev: String(dirs.stage.dev), stageIno: String(dirs.stage.ino),
      pendingDev: String(dirs.pending.dev), pendingIno: String(dirs.pending.ino) };
    const created = await pendingOutput('create', base);
    if (!created.ok) throw Error(created.message);
    for (let index = 0; index < 2; index += 1) {
      const written = await pendingOutput('write', { ...base, targetDev: created.dev, targetIno: created.ino });
      expect(written.ok).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe('ours');
    }
    expect(await fs.readFile(staged, 'utf8')).toBe('ours');
    expect((await fs.lstat(target, { bigint: true })).nlink).toBe(1n);
  }, 60_000);

  it('refuses to follow a Pending directory replaced by a symbolic link', async () => {
    const { root, project: current } = await project();
    const journal = await interruptedAppend(root, current, 'symlink.png', [7, 8, 9]);
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.rename(path.join(root, 'Pending'), path.join(root, 'Pending-old'));
    await fs.symlink(outside, path.join(root, 'Pending'));
    await expect(openFlowEditorRuntime(root)).rejects.toThrow(/aliased or replaced/);
    expect(await fs.readdir(outside)).toEqual([]);
    expect((await fs.readdir(path.join(root, 'Pending-old'))).length).toBe(1);
    expect(journal.additions).toHaveLength(1);
  }, 120_000);
  it('keeps a same-digest replacement untouched and publishes under a fresh name', async () => {
    const { root, project: current } = await project();
    const journal = await interruptedAppend(root, current, 'replaced.png', [21, 22, 23]);
    const target = path.join(root, 'Pending', journal.additions[0].name);
    const bytes = await fs.readFile(target);
    // Same bytes, different inode: a copy is not proof of ownership.
    await fs.unlink(target);
    await fs.writeFile(target, bytes);
    const replacedIno = String((await fs.lstat(target, { bigint: true })).ino);
    await openFlowEditorRuntime(root);
    expect(await fs.readFile(target)).toEqual(bytes);
    const names = (await fs.readdir(path.join(root, 'Pending'))).filter(name => name !== journal.additions[0].name);
    expect(names).toHaveLength(1);
    const added = path.join(root, 'Pending', names[0]);
    expect(hash(await fs.readFile(added))).toBe(journal.additions[0].digest);
    expect(String((await fs.lstat(added, { bigint: true })).ino)).not.toBe(replacedIno);
    expect((await ledger(root)).add).toMatchObject({ complete: true });
  }, 120_000);
  it('consumes only the actual name growth from the reserved allowance', () => {
    expect(consumePendingNameGrowth(1056, 'a.tif', 'a-2.tif')).toBe(1052);
    expect(consumePendingNameGrowth(1055, 'a.tif', 'a-2.tif')).toBe(1051);
    expect(consumePendingNameGrowth(2, 'a.tif', 'a-2.tif')).toBe(0);
  });

  it('keeps an entry created before its inode was registered and publishes beside it', async () => {
    const { root, project: current } = await project();
    const journal = await interruptedAppend(root, current, 'unregistered.png', [61, 62, 63]);
    const old = path.join(root, 'Pending', journal.additions[0].name);
    const bytes = await fs.readFile(old);
    const ledgerPath = path.join(root, '.storyboard-flow', 'tiff-output.json');
    const stored = await ledger(root);
    delete stored.add!.additions[0].targetDev;
    delete stored.add!.additions[0].targetIno;
    await fs.writeFile(ledgerPath, JSON.stringify(stored));
    await openFlowEditorRuntime(root);
    expect(await fs.readFile(old)).toEqual(bytes);
    const names = (await fs.readdir(path.join(root, 'Pending'))).filter(name => name !== journal.additions[0].name);
    expect(names).toHaveLength(1);
    expect(hash(await fs.readFile(path.join(root, 'Pending', names[0])))).toBe(journal.additions[0].digest);
    expect((await ledger(root)).add).toMatchObject({ complete: true });
  }, 120_000);


  it('retains staged bytes by content address instead of deleting them', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'retain.png', [71, 72, 73]);
    const result = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-retain' },
      { signal: new AbortController().signal });
    if (!result.ok) throw Error(result.error.message);
    const blob = path.join(root, '.storyboard-flow', 'pending-add', 'blobs', result.value.added[0].digest + '.tif');
    expect((await fs.lstat(blob, { bigint: true })).size).toBeGreaterThan(0);
    await openFlowEditorRuntime(root);
    expect((await fs.lstat(blob)).isFile()).toBe(true);
  }, 120_000);

  it('refuses an append when retained staging cannot reserve one batch, without deleting it', async () => {
    const { root, project: current } = await project();
    const blobs = path.join(root, '.storyboard-flow', 'pending-add', 'blobs');
    await fs.mkdir(blobs, { recursive: true });
    const unknown = path.join(blobs, 'unknown.bin');
    const size = PENDING_ADD_STAGE_LIMIT - PENDING_ADD_BATCH_LIMIT + 1;
    await fs.writeFile(unknown, '');
    await fs.truncate(unknown, size);
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'budget.png', [81, 82, 83]);
    const result = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-stage-budget' },
      { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('an over-budget staging area must not start');
    expect(result.error.message).toMatch(/Pending staging retains/);
    expect((await fs.lstat(unknown)).size).toBe(size);
    expect((await ledger(root)).add).toBeUndefined();
    await expect(fs.lstat(path.join(root, 'Pending'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);


  it('cancels during the write phase before the journal and leaves no Pending output', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const ledgerBefore = hash(await fs.readFile(path.join(root, '.storyboard-flow', 'tiff-output.json')));
    const file = await addSource(root, 'abort-write.png', [31, 32, 33]);
    const controller = new AbortController();
    const result = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-abort-write' },
      { signal: controller.signal, onProgress: ({ phase }) => { if (phase === 'write') controller.abort(); } });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('an aborted append must not report success');
    expect(result.error.effect).toBe('none');
    expect(result.error.message).toMatch(/取消/);
    await expect(fs.lstat(path.join(root, 'Pending'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(path.join(root, '.storyboard-flow', 'pending-add', 'blobs'))).length).toBeGreaterThan(0);
    expect(hash(await fs.readFile(path.join(root, '.storyboard-flow', 'tiff-output.json')))).toBe(ledgerBefore);
  }, 120_000);

  it('refuses to exceed the 10000-entry output history before writing an intent', async () => {
    const { root, project: current } = await project();
    const entries = Array.from({ length: 10_000 }, (_, index) => ({ shotId: 'history-' + index, name: 'history-' + index + '.tif', original: null, current: null }));
    await fs.writeFile(path.join(root, '.storyboard-flow', 'tiff-output.json'), JSON.stringify({ version: 1, projectId: current.id, entries }));
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'overflow.png', [41, 42, 43]);
    const result = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-overflow' },
      { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('history overflow must be refused before intent');
    expect(result.error.message).toMatch(/10000/);
    await expect(fs.lstat(path.join(root, 'Pending'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);
});

  it('refuses a ledger close to 8 MiB before the journal, reserving name growth', async () => {
    const { root, project: current } = await project();
    const entries: { shotId: string; name: string; original: null; current: null }[] = [];
    let size = 0;
    while (size < 8 * 1024 * 1024 - 1200 && entries.length < 9990) {
      entries.push({ shotId: 'history-' + entries.length, name: 'x'.repeat(820) + entries.length + '.tif', original: null, current: null });
      size = Buffer.byteLength(JSON.stringify({ version: 1, projectId: current.id, entries }));
    }
    expect(size).toBeLessThan(8 * 1024 * 1024);
    await fs.writeFile(path.join(root, '.storyboard-flow', 'tiff-output.json'), JSON.stringify({ version: 1, projectId: current.id, entries }));
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'near-limit.png', [51, 52, 53]);
    const result = await runtime.appendPending(current, { source: { kind: 'files', files: [file] }, operationId: 'op-budget' },
      { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('an over-budget append must not start');
    expect(result.error.message).toMatch(/8 MiB/);
    await expect(fs.lstat(path.join(root, 'Pending'))).rejects.toMatchObject({ code: 'ENOENT' });
    const after = JSON.parse(await fs.readFile(path.join(root, '.storyboard-flow', 'tiff-output.json'), 'utf8'));
    expect(after.add).toBeUndefined();
  }, 120_000);

/** Leave an incomplete journal with linked Pending outputs, as a crash would. */
async function interruptedAppend(root: string, current: ProjectV1, name: string, rgb: [number, number, number]) {
  const rawCodec = createTiffCodec(flowCodecOptions());
  const depot = await openFlowAssetDepot({ root, sessionId: 'interrupt', maxPixels: 16_000_000, maxPngBytes: 32 * 1024 * 1024 });
  if (!depot.ok) throw Error(depot.error.message);
  const store = createProjectStore();
  const output = await openFlowTiffSave(root, current.id, rawCodec);
  const readAsset: AssetReaderV1 = async id => { const r = await depot.value.read(id); if (!r.ok) throw Error(r.error.message); return r.value; };
  const file = await addSource(root, name, rgb);
  const plan = await preparePendingAdd(current, { kind: 'files', files: [file] }, { signal: new AbortController().signal }, { codec: codec(), depot: depot.value });
  const additions = plan.additions.map(addition => ({ shot: addition.shot, image: addition.image, dialogues: addition.dialogues, basis: addition.basis, original: { kind: 'output' as const } }));
  const realSave = async (project: ProjectV1) => { const saved = await store.saveCheckpoint(root, project, readAsset); if (!saved.ok) throw Error(saved.error.message); };
  let savedOnce = false;
  const access = {
    load: async () => {
      if (savedOnce) { savedOnce = false; throw Error('simulated interruption'); }
      const loaded = await store.loadCheckpoint(root);
      if (!loaded.ok) throw Error(loaded.error.message);
      return loaded.value.project;
    },
    save: async (project: ProjectV1) => { await realSave(project); savedOnce = true; }
  };
  await expect(output.appendPending(current, additions, readAsset, access, 'op-interrupt')).rejects.toThrow('simulated interruption');
  const journal = (await ledger(root)).add;
  expect(journal).toMatchObject({ complete: false });
  return journal;
}
