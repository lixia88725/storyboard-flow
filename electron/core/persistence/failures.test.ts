import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './index';
import { setFaultInjector } from './faults';
import { clone, layerOf, picture, readerFor, scene, storePaths } from './store.fixture';

const store = createProjectStore();

// Real directory permissions are the failure mechanism; Windows does not express
// "cannot create an entry in this directory" that way, so those cases skip there
// (documented in DELIVERY.md as untested Windows behaviour).
const posixOnly = it.skipIf(process.platform === 'win32');

const mode = async (target: string): Promise<number> => (await fs.stat(target)).mode & 0o777;

afterEach(() => {
  setFaultInjector(undefined);
});

describe('failures during a checkpoint write', () => {
  posixOnly('a read-only version directory fails the save and leaves the previous checkpoint usable', async () => {
    const root = await temporaryWorkspace('persistence-ro-versions-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const second = clone(project);
    second.revision = 2;
    await fs.chmod(paths.versions, 0o500);
    try {
      const saved = await store.saveCheckpoint(root, second, readerFor(assets));
      expect(saved.ok).toBe(false);
      if (saved.ok) return;
      expect(saved.error.code).toBe('io-failure');
      expect(saved.error.message).toContain('versions');
      // Permissions were reported, never repaired by chmod-ing the directory.
      expect(await mode(paths.versions)).toBe(0o500);
    } finally {
      await fs.chmod(paths.versions, 0o700);
    }

    expect(await fs.readdir(paths.versions)).toEqual(['1.json']);
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.project).toEqual(project);
  });

  posixOnly('a read-only asset directory fails the save before any metadata is published', async () => {
    const root = await temporaryWorkspace('persistence-ro-assets-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    // A new asset in revision 2 has to be created in the read-only directory.
    const fresh = await picture(7);
    const second = clone(project);
    second.revision = 2;
    second.images['image-2'].layers[0] = layerOf('layer-1', fresh);
    const withFresh = new Map(assets).set(fresh.id, fresh.bytes);

    await fs.chmod(paths.assets, 0o500);
    try {
      const saved = await store.saveCheckpoint(root, second, readerFor(withFresh));
      expect(saved.ok).toBe(false);
      if (saved.ok) return;
      expect(saved.error.code).toBe('io-failure');
      expect(await mode(paths.assets)).toBe(0o500);
    } finally {
      await fs.chmod(paths.assets, 0o700);
    }

    expect(await fs.readdir(paths.assets)).toHaveLength(5);
    expect(await fs.readdir(paths.versions)).toEqual(['1.json']);
    const head = JSON.parse(await fs.readFile(paths.manifest, 'utf8')) as { revision: number };
    expect(head.revision).toBe(1);
  });

  posixOnly('a read-only store directory fails head publication but keeps the version record it already wrote', async () => {
    const root = await temporaryWorkspace('persistence-ro-store-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const before = await fs.readFile(paths.manifest);

    const second = clone(project);
    second.revision = 2;
    await fs.chmod(paths.store, 0o500);
    try {
      const saved = await store.saveCheckpoint(root, second, readerFor(assets));
      expect(saved.ok).toBe(false);
      if (saved.ok) return;
      expect(saved.error.code).toBe('io-failure');
      expect(await mode(paths.store)).toBe(0o500);
    } finally {
      await fs.chmod(paths.store, 0o700);
    }

    // The immutable version record of the failed attempt is retained, the head is
    // untouched, and no temporary file was left behind by the refused publish.
    expect((await fs.readdir(paths.versions)).sort()).toEqual(['1.json', '2.json']);
    expect((await fs.readFile(paths.manifest)).equals(before)).toBe(true);
    expect((await fs.readdir(paths.store)).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.project.revision).toBe(1);

    // The retained record makes the retry a normal save rather than a conflict.
    const retried = await store.saveCheckpoint(root, second, readerFor(assets));
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.revision).toBe(2);
  });

  it('reports a failure injected between writing the head file and replacing the manifest', async () => {
    const root = await temporaryWorkspace('persistence-inject-replace-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const before = await fs.readFile(paths.manifest);

    const second = clone(project);
    second.revision = 2;
    setFaultInjector((point) => {
      if (point === 'beforeHeadReplace') throw new Error('injected stop before rename');
    });

    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    setFaultInjector(undefined);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('io-failure');
    expect(saved.error.message).toContain('injected stop before rename');
    expect(saved.error.message).toContain('previous checkpoint is unchanged');

    // No receipt, no new head, no leftover temporary file, version record retained.
    expect((await fs.readFile(paths.manifest)).equals(before)).toBe(true);
    expect((await fs.readdir(paths.store)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect((await fs.readdir(paths.versions)).sort()).toEqual(['1.json', '2.json']);
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.project.revision).toBe(1);
  });

  it('reports a failure injected before the head file is written at all', async () => {
    const root = await temporaryWorkspace('persistence-inject-write-');
    const { project, assets } = await scene();
    const paths = storePaths(root);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const second = clone(project);
    second.revision = 2;
    setFaultInjector((point) => {
      if (point === 'beforeHeadWrite') throw new Error('injected stop before head write');
    });
    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    setFaultInjector(undefined);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('io-failure');

    expect(await fs.readdir(paths.store)).toEqual(['assets', 'project.json', 'versions']);
    expect((await fs.readdir(paths.versions)).sort()).toEqual(['1.json', '2.json']);
    const head = JSON.parse(await fs.readFile(paths.manifest, 'utf8')) as { revision: number };
    expect(head.revision).toBe(1);
  });

  it('keeps assets already stored when a later asset in the same save cannot be read', async () => {
    const root = await temporaryWorkspace('persistence-partial-assets-');
    const { project, assets } = await scene();
    const failing: typeof assets = new Map(assets);
    let calls = 0;
    const reader = async (id: string) => {
      calls += 1;
      if (calls > 1) throw new Error('device unplugged');
      const bytes = failing.get(id);
      if (!bytes) throw new Error('missing');
      return bytes;
    };

    const saved = await store.saveCheckpoint(root, project, reader);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('missing-asset');
    await expect(fs.stat(storePaths(root).manifest)).rejects.toThrow();
    expect(await fs.readdir(storePaths(root).versions)).toEqual([]);
    // Assets admitted before the failure stay: immutable, correct and reusable.
    expect(await fs.readdir(storePaths(root).assets)).toHaveLength(1);
  });
});
