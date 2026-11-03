import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import { createProjectStore } from '.';
import { pendingRootCount, withRootLock } from './lock';
import { canonicalJson } from './canonicalJson';
import { clone, readerFor, scene, storePaths } from './store.fixture.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const store = createProjectStore();

describe('concurrent saves and caller-owned input', () => {
  it('serializes two stores writing the same root, including across store instances', async () => {
    const root = await temporaryWorkspace('persistence-serialize-');
    const { project, assets } = await scene();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first: typeof project = clone(project);
    const second = clone(project);
    second.revision = 2;

    const slowReader = async (id: string) => {
      order.push('first');
      await gate;
      return assets.get(id)!;
    };
    const fastReader = async (id: string) => {
      order.push('second');
      return assets.get(id)!;
    };

    const a = createProjectStore();
    const b = createProjectStore();
    const firstSave = a.saveCheckpoint(root, first, slowReader);
    // Let the first save reach its asset read and hold the root queue.
    await wait(60);
    expect(pendingRootCount()).toBe(1);
    const secondSave = b.saveCheckpoint(root, second, fastReader);
    await wait(60);
    // While the first save is in flight the second has not read an asset yet.
    expect(order).toEqual(['first']);
    expect(pendingRootCount()).toBe(1);

    release();
    const [one, two] = await Promise.all([firstSave, secondSave]);
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    if (one.ok && two.ok) {
      expect(one.value.revision).toBe(1);
      expect(two.value.revision).toBe(2);
    }
    expect(order).toEqual(['first', 'first', 'first', 'first', 'first', 'second', 'second', 'second', 'second', 'second']);
    await wait(10);
    expect(pendingRootCount()).toBe(0);

    const loaded = await b.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.project.revision).toBe(2);
  });

  it('allows an asset writer between checkpoint assets without waiting for head publication', async () => {
    const root = await fs.realpath(await temporaryWorkspace('persistence-interleave-'));
    const { project, assets } = await scene();
    const order: string[] = [];
    let write: Promise<void> | undefined;
    const saved = await store.saveCheckpoint(root, project, async id => {
      order.push('read');
      if (!write) write = withRootLock(root, async () => { order.push('writer'); });
      return assets.get(id)!;
    });
    await write;
    expect(saved.ok).toBe(true);
    expect(order.slice(0, 3)).toEqual(['read', 'writer', 'read']);
  });

  it('does not serialize independent roots', async () => {
    const rootA = await temporaryWorkspace('persistence-parallel-a-');
    const rootB = await temporaryWorkspace('persistence-parallel-b-');
    const { project, assets } = await scene();
    const arrived: string[] = [];
    let barrierRelease!: () => void;
    const barrier = new Promise<void>((resolve) => {
      barrierRelease = resolve;
    });
    const readerAt = (name: string) => async (id: string) => {
      if (!arrived.includes(name)) {
        arrived.push(name);
        if (arrived.length === 2) barrierRelease();
        // Both roots must be able to read at the same time; a queue shared across
        // roots would leave this waiting until the timeout below.
        await Promise.race([barrier, wait(2000)]);
      }
      return assets.get(id)!;
    };

    const [a, b] = await Promise.all([
      createProjectStore().saveCheckpoint(rootA, clone(project), readerAt('a')),
      createProjectStore().saveCheckpoint(rootB, clone(project), readerAt('b'))
    ]);
    expect(arrived.sort()).toEqual(['a', 'b']);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    await wait(10);
    expect(pendingRootCount()).toBe(0);
  });

  it('acknowledges the submitted checkpoint even when the caller mutates it mid-save', async () => {
    const root = await temporaryWorkspace('persistence-snapshot-');
    const { project, assets } = await scene();
    const submitted = canonicalJson(project);
    let mutated = false;

    const reader = async (id: string) => {
      if (!mutated) {
        mutated = true;
        // The caller keeps editing the object it handed over.
        project.name = 'MUTATED AFTER SUBMIT';
        project.revision = 99;
        project.shots.push({ id: 'shot-late', imageId: 'image-1', name: 'late', scriptText: 'late' });
        project.images['image-1'].layers[0].opacity = 0.25;
      }
      return assets.get(id)!;
    };

    const saved = await store.saveCheckpoint(root, project, reader);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value).toEqual({ projectId: 'project-scene', revision: 1, manifestPath: storePaths(root).manifest });
    expect(await fs.readFile(storePaths(root).manifest, 'utf8')).toBe(`${submitted}\n`);

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project.revision).toBe(1);
    expect(loaded.value.project.name).toBe('故事板 · Storyboard ✂️');
    expect(loaded.value.project.shots).toHaveLength(2);
    expect(loaded.value.project.images['image-1'].layers[0].opacity).toBe(1);
  });

  it('shows a reader either the previous or the new head, never a partial one', async () => {
    const root = await temporaryWorkspace('persistence-read-during-save-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const second = clone(project);
    second.revision = 2;
    second.name = 'second checkpoint';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = async (id: string) => {
      await gate;
      return assets.get(id)!;
    };
    const pending = store.saveCheckpoint(root, second, slow);
    await wait(60);

    const during = await store.loadCheckpoint(root);
    expect(during.ok).toBe(true);
    if (during.ok) expect(during.value.project).toEqual(project);

    release();
    expect((await pending).ok).toBe(true);
    const after = await store.loadCheckpoint(root);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.project).toEqual(second);
  });

  it('stores a private copy of the bytes the reader hands out', async () => {
    const root = await temporaryWorkspace('persistence-bytes-copy-');
    const { project, assets } = await scene();
    const ids = [...assets.keys()].sort();
    const originals = new Map(ids.map((id) => [id, Buffer.from(assets.get(id)!)]));
    let calls = 0;

    const reader = async (id: string) => {
      calls += 1;
      if (calls === 2) {
        // Mutate the buffer handed out for the first asset after it was returned.
        const shared = assets.get(ids[0])!;
        shared[shared.length - 1] = shared[shared.length - 1] ^ 0xff;
      }
      return assets.get(id)!;
    };

    expect((await store.saveCheckpoint(root, project, reader)).ok).toBe(true);
    const stored = await fs.readFile(path.join(storePaths(root).assets, `${ids[0]}.png`));
    expect(stored.equals(originals.get(ids[0])!)).toBe(true);
  });
});
