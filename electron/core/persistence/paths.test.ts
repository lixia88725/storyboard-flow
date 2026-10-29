import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './index';
import { clone, readerFor, scene, storePaths } from './store.fixture';

const store = createProjectStore();

const sibling = (root: string, suffix: string): string => path.join(path.dirname(root), `${path.basename(root)}${suffix}`);

describe('root and store path policy', () => {
  it('refuses a relative, missing, non-directory or aliased root', async () => {
    const root = await temporaryWorkspace('persistence-root-policy-');
    const { project, assets } = await scene();
    const projectFolder = path.join(root, 'project');
    await fs.mkdir(projectFolder);

    const relative = await store.saveCheckpoint('project', project, readerFor(assets));
    expect(relative.ok).toBe(false);
    if (!relative.ok) expect(relative.error.code).toBe('invalid-input');

    const missing = await store.saveCheckpoint(path.join(root, 'absent'), project, readerFor(assets));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('invalid-input');
    const missingLoad = await store.loadCheckpoint(path.join(root, 'absent'));
    expect(missingLoad.ok).toBe(false);
    if (!missingLoad.ok) expect(missingLoad.error.code).toBe('not-found');

    const file = path.join(root, 'notes.txt');
    await fs.writeFile(file, 'x');
    const notDirectory = await store.saveCheckpoint(file, project, readerFor(assets));
    expect(notDirectory.ok).toBe(false);
    if (!notDirectory.ok) expect(notDirectory.error.code).toBe('invalid-input');
  });

  it('refuses a root that is a symbolic link or reached through an aliased directory', async () => {
    const root = await temporaryWorkspace('persistence-root-link-');
    const { project, assets } = await scene();
    const real = path.join(root, 'real');
    const inner = path.join(real, 'project');
    await fs.mkdir(inner, { recursive: true });
    const link = sibling(root, '-link');
    await fs.symlink(real, link, 'dir');

    const directSymlink = await store.saveCheckpoint(link, project, readerFor(assets));
    expect(directSymlink.ok).toBe(false);
    if (!directSymlink.ok) expect(directSymlink.error.code).toBe('invalid-input');

    // Not a link itself, but resolved through one: an alias the store will not bind.
    const aliased = await store.saveCheckpoint(path.join(link, 'project'), project, readerFor(assets));
    expect(aliased.ok).toBe(false);
    if (!aliased.ok) {
      expect(aliased.error.code).toBe('invalid-input');
      expect(aliased.error.message).toContain('alias');
    }

    // The canonical path is accepted.
    expect((await store.saveCheckpoint(inner, project, readerFor(assets))).ok).toBe(true);
  });

  it('refuses a store, asset or version directory that is a symbolic link and writes nothing through it', async () => {
    const root = await temporaryWorkspace('persistence-store-link-');
    const { project, assets } = await scene();
    const outside = sibling(root, '-outside');
    await fs.mkdir(outside);
    await fs.mkdir(path.dirname(storePaths(root).store));
    await fs.symlink(outside, storePaths(root).store, 'dir');

    const saved = await store.saveCheckpoint(root, project, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error.code).toBe('conflict');
    expect(await fs.readdir(outside)).toEqual([]);

    // Same for a linked assets directory inside a real store directory.
    const root2 = await temporaryWorkspace('persistence-assets-link-');
    await fs.mkdir(storePaths(root2).store, { recursive: true });
    await fs.symlink(outside, storePaths(root2).assets, 'dir');
    const saved2 = await store.saveCheckpoint(root2, project, readerFor(assets));
    expect(saved2.ok).toBe(false);
    if (!saved2.ok) expect(saved2.error.code).toBe('conflict');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('refuses to load assets through a directory that has been replaced by a link', async () => {
    const root = await temporaryWorkspace('persistence-assets-swap-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    // Same files, reached through a link outside the store: load must not follow it.
    const elsewhere = path.join(root, 'elsewhere');
    await fs.rename(paths.assets, elsewhere);
    await fs.symlink(elsewhere, paths.assets, 'dir');

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.code).toBe('conflict');
  });

  it('refuses a pre-existing asset, head or version entry that is a symbolic link', async () => {
    const root = await temporaryWorkspace('persistence-entry-link-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const outside = sibling(root, '-target.png');
    await fs.writeFile(outside, assets.get([...assets.keys()][0])!);
    const assetId = [...assets.keys()][0];
    const assetFile = path.join(paths.assets, `${assetId}.png`);
    await fs.rm(assetFile);
    await fs.symlink(outside, assetFile);

    const second = clone(project);
    second.revision = 2;
    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error.code).toBe('conflict');
    // The link target was never written through.
    expect((await fs.readFile(outside)).equals(assets.get(assetId)!)).toBe(true);
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.code).toBe('conflict');

    // A head that has become a link is refused by load and by save alike.
    const root3 = await temporaryWorkspace('persistence-head-link-');
    expect((await store.saveCheckpoint(root3, project, readerFor(assets))).ok).toBe(true);
    const headTarget = sibling(root3, '-head.json');
    await fs.rename(storePaths(root3).manifest, headTarget);
    await fs.symlink(headTarget, storePaths(root3).manifest);
    const headBytes = await fs.readFile(headTarget);
    const refusedSave = await store.saveCheckpoint(root3, project, readerFor(assets));
    expect(refusedSave.ok).toBe(false);
    if (!refusedSave.ok) expect(refusedSave.error.code).toBe('conflict');
    const refusedLoad = await store.loadCheckpoint(root3);
    expect(refusedLoad.ok).toBe(false);
    if (!refusedLoad.ok) expect(refusedLoad.error.code).toBe('conflict');
    expect((await fs.readFile(headTarget)).equals(headBytes)).toBe(true);
  });
});
