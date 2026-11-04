import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createImageProject } from './createImageProject';
import { openFlowAssetDepot } from './persistence/depot';
import { createTiffCodec } from './formats/index.js';
import { createPresentationCodec } from './formats/presentation.js';
import { flowCodecOptions } from '../../platform/main/flowRuntimePaths.js';
import { preparePendingAdd, pendingNameBasis } from './appendPendingImages';
import type { ProjectV1 } from '../../platform/contracts/refactorV1.js';

const codec = () => createPresentationCodec(createTiffCodec(flowCodecOptions()));
const solid = (r: number, g: number, b: number) => sharp({ create: { width: 4, height: 3, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();

async function project(): Promise<{ root: string; project: ProjectV1 }> {
  const root = await temporaryWorkspace('flow-pending-prep-');
  const sources = path.join(root, 'sources');
  await fs.mkdir(sources);
  await fs.writeFile(path.join(sources, 'one.png'), await solid(10, 20, 30));
  await fs.writeFile(path.join(sources, 'two.png'), await solid(40, 50, 60));
  const { root: created } = await createImageProject({
    source: { kind: 'folder', folder: sources }, destinationParent: root, folderName: 'Proj', name: 'Proj',
    naming: { sceneCode: 'S01', artistName: 'Li', version: '1' }
  }, { signal: new AbortController().signal });
  const { createProjectStore } = await import('./persistence/index.js');
  const loaded = await createProjectStore().loadCheckpoint(created);
  if (!loaded.ok) throw Error(loaded.error.message);
  return { root: created, project: loaded.value.project };
}

async function depotFor(root: string) {
  const depot = await openFlowAssetDepot({ root, sessionId: 'prep', maxPixels: 16_000_000, maxPngBytes: 32 * 1024 * 1024 });
  if (!depot.ok) throw Error(depot.error.message);
  return depot.value;
}

describe('preparePendingAdd', () => {
  it('converts selected images in natural order and appends them after existing Pending boards', async () => {
    const { root, project: current } = await project();
    const folder = path.join(root, 'add');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, '2.png'), await solid(1, 2, 3));
    await fs.writeFile(path.join(folder, '10.png'), await solid(4, 5, 6));
    const plan = await preparePendingAdd(current, { kind: 'folder', folder }, { signal: new AbortController().signal }, { codec: codec(), depot: await depotFor(root) });
    expect(plan.project.parkedShots).toHaveLength(2);
    expect(plan.project.parkedShots.map(shot => shot.name)).toEqual(['2', '10']);
    expect(plan.project.revision).toBe(current.revision);
    expect(plan.additions.map(add => add.basis)).toEqual(['2', '10']);
    // Existing boards keep their identity and order; the append is at the end.
    expect(plan.project.shots).toEqual(current.shots);
    expect(plan.project.images[current.shots[0].imageId]).toEqual(current.images[current.shots[0].imageId]);
    expect(plan.additions.every(add => add.original.kind === 'output')).toBe(true);
  }, 60_000);

  it('keeps TIFF layers/text and preserves the source bytes as the original', async () => {
    const { root, project: current } = await project();
    const tiff = path.join(root, 'Panel_01.tif');
    await fs.copyFile(path.join(root, await firstTiff(root)), tiff);
    const before = await fs.readFile(tiff);
    const plan = await preparePendingAdd(current, { kind: 'files', files: [tiff] }, { signal: new AbortController().signal }, { codec: codec(), depot: await depotFor(root) });
    expect(plan.additions).toHaveLength(1);
    const addition = plan.additions[0];
    expect(addition.basis).toBe('Panel_01');
    expect(addition.original.kind).toBe('source');
    if (addition.original.kind === 'source') expect(addition.original.digest).toBe((await import('node:crypto')).createHash('sha256').update(before).digest('hex'));
    expect(addition.image.layers.length).toBe(1);
    expect((await fs.readFile(tiff)).equals(before)).toBe(true);
  }, 60_000);

  it('uses one confirmation for defects and leaves the project untouched when cancelled', async () => {
    const { root, project: current } = await project();
    const folder = path.join(root, 'bad');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'broken.png'), 'not an image');
    await fs.writeFile(path.join(folder, 'ok.png'), await solid(7, 8, 9));
    const seen: unknown[] = [];
    await expect(preparePendingAdd(current, { kind: 'folder', folder },
      { signal: new AbortController().signal, decideIssues: async issues => { seen.push(...issues); return 'cancel'; } },
      { codec: codec(), depot: await depotFor(root) })).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { file: string }).file).toContain('broken.png');
    expect(current.parkedShots).toHaveLength(0);
  }, 60_000);

  it('refuses without a confirmation handler and never writes a Pending leaf', async () => {
    const { root, project: current } = await project();
    const folder = path.join(root, 'bad2');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'broken.png'), 'not an image');
    await expect(preparePendingAdd(current, { kind: 'folder', folder }, { signal: new AbortController().signal }, { codec: codec(), depot: await depotFor(root) }))
      .rejects.toThrow('need confirmation');
    await expect(fs.lstat(path.join(root, 'Pending'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('honours an abort before reading any source', async () => {
    const { root, project: current } = await project();
    const controller = new AbortController();
    controller.abort();
    const folder = path.join(root, 'add-abort');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'a.png'), await solid(1, 1, 1));
    await expect(preparePendingAdd(current, { kind: 'folder', folder }, { signal: controller.signal }, { codec: codec(), depot: await depotFor(root) }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect((await fs.readdir(root)).some(name => name === 'Pending')).toBe(false);
  }, 60_000);

  it('sanitizes unsafe basenames and falls back to image', () => {
    expect(pendingNameBasis('  a:b? .png')).toBe('a_b');
    expect(pendingNameBasis('...png')).toBe('image');
    expect(pendingNameBasis('.hidden.tif')).toBe('hidden');
    expect(pendingNameBasis('A very  long   name.png')).toBe('A_very_long_name');
  });
});

async function firstTiff(root: string): Promise<string> {
  const name = (await fs.readdir(root)).find(entry => entry.endsWith('_0010.tif'));
  if (!name) throw Error('fixture has no active TIFF');
  return name;
}
