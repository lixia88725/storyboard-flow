import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectV1 } from '../../shared/refactorV1.js';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './index';
import { canonicalJson, canonicalUtf8 } from './canonicalJson';
import { clone, imageOf, listTree, picture, readJson, readerFor, scene, shotOf, storePaths } from './store.fixture';

const store = createProjectStore();

describe('checkpoint format on a real temporary project folder', () => {
  it('publishes immutable assets, the version record and the manifest, then reopens the exact checkpoint', async () => {
    const root = await temporaryWorkspace('persistence-roundtrip-');
    const { project, assets } = await scene();
    const paths = storePaths(root);

    const saved = await store.saveCheckpoint(root, project, readerFor(assets));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value).toEqual({ projectId: 'project-scene', revision: 1, manifestPath: paths.manifest });

    // Layout: one PNG per distinct asset id, one version record, one manifest.
    const tree = await listTree(paths.store);
    const expectedAssets = [...assets.keys()].map((id) => `assets/${id}.png`).sort();
    expect(tree.filter((entry) => entry.startsWith('assets/'))).toEqual(expectedAssets);
    expect(tree).toContain('versions/1.json');
    expect(tree).toContain('project.json');
    // No temporary file survives a successful save.
    expect(tree.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);

    // The manifest is exactly the submitted ProjectV1, canonical UTF-8 JSON.
    const manifestBytes = await fs.readFile(paths.manifest);
    expect(manifestBytes.equals(canonicalUtf8(project))).toBe(true);
    expect(await readJson(paths.manifest)).toEqual(project);
    // The version record is the same manifest bytes for that revision.
    expect((await fs.readFile(path.join(paths.versions, '1.json'))).equals(manifestBytes)).toBe(true);

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project).toEqual(project);

    // Every encoded PNG survives byte for byte, including the retained,
    // unreferenced image-4 and the asset shared by image-3 and image-4.
    for (const [id, bytes] of assets) {
      const read = await loaded.value.readAsset(id);
      expect(Buffer.from(read).equals(bytes)).toBe(true);
      const stored = await fs.readFile(path.join(paths.assets, `${id}.png`));
      expect(stored.equals(bytes)).toBe(true);
    }
    expect(await fs.readdir(paths.assets)).toHaveLength(5);
  });

  it('keeps Unicode text exactly, without normalization or escaping surprises', async () => {
    const root = await temporaryWorkspace('persistence-unicode-');
    const { project, assets } = await scene();
    // A lone surrogate and a decomposed sequence must come back unchanged: text is
    // not repaired on the way to disk or back.
    const tricky = 'e\u0301 \ud800 🎬 「引用」 \u0000 tab\tend';
    const submitted = clone(project);
    submitted.name = tricky;
    submitted.shots[0].scriptText = tricky;
    submitted.dialogues[0].text = tricky;

    expect((await store.saveCheckpoint(root, submitted, readerFor(assets))).ok).toBe(true);
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project.name).toBe(tricky);
    expect(loaded.value.project.shots[0].scriptText).toBe(tricky);
    expect(loaded.value.project.dialogues[0].text).toBe(tricky);
  });

  it('writes identical bytes for the same logical project regardless of key order', async () => {
    const first = await temporaryWorkspace('persistence-canonical-a-');
    const second = await temporaryWorkspace('persistence-canonical-b-');
    const { project, assets } = await scene();

    // Same document, keys inserted in the opposite order at every level.
    const reordered = JSON.parse(canonicalJson(project), (key, value) => value) as typeof project;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse()) as typeof project;
    shuffled.shots = reordered.shots.map((shot) => Object.fromEntries(Object.entries(shot).reverse()) as typeof shot);

    expect((await store.saveCheckpoint(first, project, readerFor(assets))).ok).toBe(true);
    expect((await store.saveCheckpoint(second, shuffled, readerFor(assets))).ok).toBe(true);
    const one = await fs.readFile(storePaths(first).manifest);
    const two = await fs.readFile(storePaths(second).manifest);
    expect(one.equals(two)).toBe(true);
  });

  it('round-trips an empty project without asking for any asset', async () => {
    const root = await temporaryWorkspace('persistence-empty-');
    const paths = storePaths(root);
    const empty: ProjectV1 = {
      schema: 'storyboard-flow.project',
      version: 1,
      id: 'project-empty',
      revision: 0,
      name: '',
      shots: [],
      parkedShots: [],
      dialogues: [],
      images: {}
    };
    const saved = await store.saveCheckpoint(root, empty, async () => {
      throw new Error('an empty project must not request an asset');
    });
    expect(saved.ok).toBe(true);
    expect(await fs.readdir(paths.assets)).toEqual([]);
    expect(await fs.readdir(paths.versions)).toEqual(['0.json']);

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project).toEqual(empty);
  });

  it('keeps legal image ids that collide with Object prototype keys', async () => {
    const root = await temporaryWorkspace('persistence-reserved-ids-');
    const paths = storePaths(root);
    const [proto, ctor, str] = await Promise.all([picture(20), picture(70), picture(120)]);
    // `__proto__` must be an own entry, not the object prototype; a literal would
    // set the prototype here, so the fixture builds the record the way JSON does.
    const images = Object.fromEntries([
      ['__proto__', imageOf('__proto__', [proto])],
      ['constructor', imageOf('constructor', [ctor])],
      ['toString', imageOf('toString', [str], { revision: 2 })]
    ]);
    const project: ProjectV1 = {
      schema: 'storyboard-flow.project',
      version: 1,
      id: 'project-reserved',
      revision: 1,
      name: 'reserved ids',
      shots: [shotOf('shot-a', '__proto__', { name: 'prototype shot' })],
      parkedShots: [shotOf('shot-b', 'constructor')],
      dialogues: [],
      images
    };
    const assets = new Map([
      [proto.id, proto.bytes],
      [ctor.id, ctor.bytes],
      [str.id, str.bytes]
    ]);
    const expectedIds = ['__proto__', 'constructor', 'toString'];

    const saved = await store.saveCheckpoint(root, project, readerFor(assets));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    // On disk every id is an own key of the manifest.
    const manifest = (await readJson(paths.manifest)) as { images: Record<string, unknown> };
    expect(Object.keys(manifest.images).sort()).toEqual(expectedIds);
    expect(Object.hasOwn(manifest.images, '__proto__')).toBe(true);
    expect(manifest.images['__proto__']).toEqual(imageOf('__proto__', [proto]));

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.keys(loaded.value.project.images).sort()).toEqual(expectedIds);
    expect(loaded.value.project.images['__proto__']).toEqual(imageOf('__proto__', [proto]));
    expect(loaded.value.project.images['constructor']).toEqual(imageOf('constructor', [ctor]));
    expect(loaded.value.project.images['toString']).toEqual(imageOf('toString', [str], { revision: 2 }));
    // Shots that reference those ids still resolve after the round trip.
    expect(loaded.value.project.shots[0].imageId).toBe('__proto__');
    expect(loaded.value.project.parkedShots[0].imageId).toBe('constructor');
  });

  it('touches nothing outside the store directory: no TIFF, no legacy metadata, no user data', async () => {
    const root = await temporaryWorkspace('persistence-isolation-');
    const { project, assets } = await scene();
    const paths = storePaths(root);

    // Decoys a real project folder would hold.
    const legacy = path.join(root, '.storyboard-flow');
    await fs.mkdir(legacy);
    const legacyFile = path.join(legacy, 'storyboard.project.json');
    const tiff = path.join(root, 'frame-0001.tif');
    const notes = path.join(root, 'notes.txt');
    await fs.writeFile(legacyFile, '{"legacy":true}');
    await fs.writeFile(tiff, Buffer.from([0x49, 0x49, 0x2a, 0x00, 0xde, 0xad]));
    await fs.writeFile(notes, 'keep me');

    const before = {
      legacy: await fs.stat(legacyFile, { bigint: true }),
      tiff: await fs.stat(tiff, { bigint: true }),
      notes: await fs.stat(notes, { bigint: true })
    };

    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) await loaded.value.readAsset([...assets.keys()][0]);

    expect(await fs.readFile(legacyFile, 'utf8')).toBe('{"legacy":true}');
    expect([...(await fs.readFile(tiff))]).toEqual([0x49, 0x49, 0x2a, 0x00, 0xde, 0xad]);
    expect(await fs.readFile(notes, 'utf8')).toBe('keep me');
    for (const [name, beforeStat] of Object.entries(before)) {
      const after = name === 'legacy'
        ? await fs.stat(legacyFile, { bigint: true })
        : name === 'tiff'
          ? await fs.stat(tiff, { bigint: true })
          : await fs.stat(notes, { bigint: true });
      expect(after.mtimeNs).toBe(beforeStat.mtimeNs);
      expect(after.ino).toBe(beforeStat.ino);
    }

    const outside = (await listTree(root)).filter(
      (entry) =>
        entry !== '.storyboard-flow' &&
        !entry.startsWith('.storyboard-flow/checkpoints/') &&
        entry !== '.storyboard-flow/checkpoints' &&
        entry !== '.storyboard-flow/storyboard.project.json' &&
        !['notes.txt', 'frame-0001.tif'].includes(entry)
    );
    expect(outside).toEqual([]);
    expect(await fs.readdir(paths.assets)).toHaveLength(5);
  });
});
