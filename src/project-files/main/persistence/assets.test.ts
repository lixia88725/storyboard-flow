import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetReaderV1, ImageDocumentV1, ProjectV1 } from '../../../platform/contracts/refactorV1.js';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import { createProjectStore } from '.';
import { imageOf, layerOf, picture, readerFor, scene, sha256, shotOf, storePaths, type Picture } from './store.fixture.ts';

const store = createProjectStore();

const singleShotProject = (source: Picture, layer: Partial<{ width: number; height: number }> = {}): ProjectV1 => ({
  schema: 'storyboard-flow.project',
  version: 1,
  id: 'project-single',
  revision: 1,
  name: 'single',
  shots: [shotOf('shot-1', 'image-1')],
  parkedShots: [],
  dialogues: [],
  images: {
    'image-1': imageOf('image-1', [source], {
      width: layer.width ?? source.width,
      height: layer.height ?? source.height,
      layers: [layerOf('layer-1', source, { width: layer.width ?? source.width, height: layer.height ?? source.height })]
    }) as ImageDocumentV1
  }
});

const readerOf = (bytes: Buffer): AssetReaderV1 => async () => bytes;

describe('asset admission checks', () => {
  it('rejects bytes that do not hash to the id the manifest names', async () => {
    const root = await temporaryWorkspace('persistence-hash-');
    const source = await picture(30);
    const project = singleShotProject(source);
    const saved = await store.saveCheckpoint(root, project, readerOf(await picture(90).then((other) => other.bytes)));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect(saved.error.message).toContain(source.id);
    // Nothing was published.
    await expect(fs.stat(storePaths(root).manifest)).rejects.toThrow();
  });

  it('reports an unreadable asset as missing-asset', async () => {
    const root = await temporaryWorkspace('persistence-reader-throws-');
    const project = singleShotProject(await picture(30));
    const saved = await store.saveCheckpoint(root, project, async () => {
      throw new Error('the caller lost the buffer');
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('missing-asset');
    expect(saved.error.message).toContain('the caller lost the buffer');
  });

  it('rejects a reader that does not return bytes, and one that returns nothing', async () => {
    const root = await temporaryWorkspace('persistence-reader-shape-');
    const project = singleShotProject(await picture(30));
    const wrongType = await store.saveCheckpoint(root, project, (async () => 'not bytes') as unknown as AssetReaderV1);
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.error.code).toBe('invalid-input');

    const empty = await store.saveCheckpoint(root, project, readerOf(Buffer.alloc(0)));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('conflict');
  });

  it('rejects a non-PNG image even when its bytes match the claimed id', async () => {
    const root = await temporaryWorkspace('persistence-not-png-');
    const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    const source: Picture = { id: sha256(jpeg), width: 8, height: 6, bytes: jpeg };
    const saved = await store.saveCheckpoint(root, singleShotProject(source), readerOf(jpeg));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
    expect(saved.error.message).toContain('not PNG');
  });

  it('rejects a truncated PNG whose header still parses', async () => {
    const root = await temporaryWorkspace('persistence-truncated-');
    const full = await picture(45);
    const truncated = full.bytes.subarray(0, 48);
    const source: Picture = { id: sha256(truncated), width: full.width, height: full.height, bytes: Buffer.from(truncated) };
    const saved = await store.saveCheckpoint(root, singleShotProject(source), readerOf(source.bytes));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
  });

  it('rejects a PNG whose decoded dimensions contradict the layer descriptor', async () => {
    const root = await temporaryWorkspace('persistence-dimensions-');
    const source = await picture(45);
    const project = singleShotProject(source, { width: 10, height: 10 });
    const saved = await store.saveCheckpoint(root, project, readerOf(source.bytes));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
    expect(saved.error.message).toContain('declares 10x10');
  });

  it('re-checks the dimensions of an already stored asset against the current claim', async () => {
    const root = await temporaryWorkspace('persistence-reused-dimensions-');
    const source = await picture(45);
    expect((await store.saveCheckpoint(root, singleShotProject(source), readerOf(source.bytes))).ok).toBe(true);

    // Same bytes, same id, but the descriptor now claims a larger canvas: the hash
    // proves the bytes are unchanged, not that the claim is true.
    const grown = singleShotProject(source, { width: 10, height: 10 });
    grown.revision = 2;
    const saved = await store.saveCheckpoint(root, grown, readerOf(source.bytes));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
    expect(saved.error.message).toContain('declares 10x10');

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project.revision).toBe(1);
    expect(loaded.value.project.images['image-1'].width).toBe(source.width);
    expect(loaded.value.project.images['image-1'].layers[0].width).toBe(source.width);
  });

  it('rejects two references to one stored asset that declare different sizes', async () => {
    const root = await temporaryWorkspace('persistence-two-references-');
    const source = await picture(45);

    // Revision 1 stores the blob through a 8x6 image.
    expect((await store.saveCheckpoint(root, singleShotProject(source), readerOf(source.bytes))).ok).toBe(true);

    // Revision 2 references the same blob from a 10x10 image as well.
    const mixed = singleShotProject(source);
    mixed.revision = 2;
    mixed.images['image-2'] = imageOf('image-2', [source], {
      width: 10,
      height: 10,
      layers: [layerOf('layer-1', source, { width: 10, height: 10 })]
    });
    mixed.shots.push(shotOf('shot-2', 'image-2'));

    const saved = await store.saveCheckpoint(root, mixed, readerOf(source.bytes));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');

    const head = JSON.parse(await fs.readFile(storePaths(root).manifest, 'utf8')) as { revision: number };
    expect(head.revision).toBe(1);
  });

  it('rejects a hash-named non-PNG blob that is already present in a fresh store', async () => {
    const root = await temporaryWorkspace('persistence-present-non-png-');
    const paths = storePaths(root);
    const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    const source: Picture = { id: sha256(jpeg), width: 8, height: 6, bytes: jpeg };

    // The blob exists and its bytes match its name, but it is not a PNG.
    await fs.mkdir(paths.assets, { recursive: true });
    await fs.writeFile(path.join(paths.assets, `${source.id}.png`), jpeg);

    const saved = await store.saveCheckpoint(root, singleShotProject(source), readerOf(jpeg));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
    expect((await fs.readFile(path.join(paths.assets, `${source.id}.png`))).equals(jpeg)).toBe(true);
  });

  it('load reports a deleted asset file as missing-asset', async () => {
    const root = await temporaryWorkspace('persistence-missing-asset-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const assetId = [...assets.keys()][1];
    await fs.rm(path.join(storePaths(root).assets, `${assetId}.png`));

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('missing-asset');
    expect(loaded.error.message).toContain(assetId);
  });

  it('load never hands back tampered asset bytes', async () => {
    const root = await temporaryWorkspace('persistence-tampered-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const assetId = [...assets.keys()][2];
    const assetFile = path.join(storePaths(root).assets, `${assetId}.png`);
    const tampered = Buffer.concat([Buffer.from([1, 2, 3]), (await fs.readFile(assetFile)).subarray(3)]);
    await fs.writeFile(assetFile, tampered);

    await expect(loaded.value.readAsset(assetId)).rejects.toMatchObject({ code: 'conflict' });
    // Untouched assets still read normally.
    const other = [...assets.keys()][0];
    expect(Buffer.from(await loaded.value.readAsset(other)).equals(assets.get(other)!)).toBe(true);
  });

  it('the loaded reader is bound to the checkpoint: unknown or malformed ids are refused', async () => {
    const root = await temporaryWorkspace('persistence-reader-binding-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    await expect(loaded.value.readAsset('a'.repeat(64))).rejects.toMatchObject({ code: 'not-found' });
    await expect(loaded.value.readAsset('../project.json')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
