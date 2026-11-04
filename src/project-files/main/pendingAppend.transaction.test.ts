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
    const result = await runtime.appendPending(edited, { source: { kind: 'files', files: [file] } }, { signal: new AbortController().signal });
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
    const appended = await runtime.appendPending(current, { source: { kind: 'files', files: [file] } }, { signal: new AbortController().signal });
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
    await expect(output.appendPending(current, additions, readAsset, access)).rejects.toThrow('simulated interruption');
    const pendingFile = path.join(root, 'Pending', additions[0].basis + '.tif');
    expect(await fs.stat(pendingFile)).toBeTruthy();
    const journal = (await ledger(root)).add;
    expect(journal).toMatchObject({ complete: false });
    // The private staging name still proves ownership of the Pending link.
    const staged = path.join(root, '.storyboard-flow', 'pending-add', journal.token, journal.additions[0].staged);
    expect(await fs.stat(staged)).toBeTruthy();
    const reopened = await openFlowEditorRuntime(root);
    const recovered = await checkpoint(root);
    expect(recovered.parkedShots.map(shot => shot.id)).toEqual([plan.project.parkedShots[0].id]);
    expect((await ledger(root)).add).toMatchObject({ complete: true });
    expect((await reopened.folderStatus({ project: recovered, inspectDisk: true }))).toBe('current');
  }, 120_000);

  it('refuses to claim a Pending file when the private staged bytes are gone', async () => {
    const { root, project: current } = await project();
    const rawCodec = createTiffCodec(flowCodecOptions());
    const depot = await openFlowAssetDepot({ root, sessionId: 'tx2', maxPixels: 16_000_000, maxPngBytes: 32 * 1024 * 1024 });
    if (!depot.ok) throw Error(depot.error.message);
    const store = createProjectStore();
    const output = await openFlowTiffSave(root, current.id, rawCodec);
    const readAsset: AssetReaderV1 = async id => { const r = await depot.value.read(id); if (!r.ok) throw Error(r.error.message); return r.value; };
    const file = await addSource(root, 'orphan.png', [1, 2, 4]);
    const plan = await preparePendingAdd(current, { kind: 'files', files: [file] }, { signal: new AbortController().signal }, { codec: codec(), depot: depot.value });
    const additions = plan.additions.map(addition => ({ shot: addition.shot, image: addition.image, dialogues: addition.dialogues, basis: addition.basis, original: { kind: 'output' as const } }));
    const realSave = async (project: ProjectV1) => { const saved = await store.saveCheckpoint(root, project, readAsset); if (!saved.ok) throw Error(saved.error.message); };
    let savedOnce = false;
    const access = { load: async () => { if (savedOnce) { savedOnce = false; throw Error('simulated interruption'); } const loaded = await store.loadCheckpoint(root); if (!loaded.ok) throw Error(loaded.error.message); return loaded.value.project; }, save: async (project: ProjectV1) => { await realSave(project); savedOnce = true; } };
    await expect(output.appendPending(current, additions, readAsset, access)).rejects.toThrow('simulated interruption');
    const journal = (await ledger(root)).add;
    const pendingFile = path.join(root, 'Pending', additions[0].basis + '.tif');
    const bytes = await fs.readFile(pendingFile);
    // Remove only the private staging link: the Pending file remains, but it can no
    // longer be proven to belong to this transaction. Recovery must not adopt it.
    await fs.unlink(path.join(root, '.storyboard-flow', 'pending-add', journal.token, journal.additions[0].staged));
    await expect(openFlowEditorRuntime(root)).rejects.toThrow('Prepared Pending TIFF is unavailable');
    expect(await fs.readFile(pendingFile)).toEqual(bytes);
  }, 120_000);

  it('answers recover with the durable after without appending a second time', async () => {
    const { root, project: current } = await project();
    const runtime = await openFlowEditorRuntime(root);
    const file = await addSource(root, 'again.png', [9, 9, 9]);
    const first = await runtime.appendPending(current, { source: { kind: 'files', files: [file] } }, { signal: new AbortController().signal });
    if (!first.ok) throw Error(first.error.message);
    expect(first.ok).toBe(true);
    const entries = (await ledger(root)).entries.length;
    const second = await runtime.appendPending(first.value.project, { recover: true }, { signal: new AbortController().signal });
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
    const result = await runtime.appendPending(current, { source: { kind: 'folder', folder } },
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
    const appended = await runtime.appendPending(current, { source: { kind: 'files', files: [file] } }, { signal: new AbortController().signal });
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
});
