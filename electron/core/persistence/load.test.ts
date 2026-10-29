import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoreErrorCodeV1 } from '../../shared/refactorV1.js';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './index';
import { clone, readerFor, scene, storePaths } from './store.fixture';

const store = createProjectStore();

type Rejection = { name: string; change: (project: any) => void; code: CoreErrorCodeV1 };

const rejections: Rejection[] = [
  { name: 'an unknown top-level field', change: (p) => { p.colour = '#fff'; }, code: 'invalid-input' },
  { name: 'an unknown field inside a layer', change: (p) => { p.images['image-1'].layers[0].opacity2 = 1; }, code: 'invalid-input' },
  { name: 'another project schema', change: (p) => { p.schema = 'storyboard-flow.project.v2'; }, code: 'unsupported-version' },
  { name: 'another schema version', change: (p) => { p.version = 2; }, code: 'unsupported-version' },
  { name: 'a missing required field', change: (p) => { delete p.parkedShots; }, code: 'invalid-input' },
  { name: 'an id with an illegal character', change: (p) => { p.id = 'project scene'; }, code: 'invalid-input' },
  { name: 'a negative revision', change: (p) => { p.revision = -1; }, code: 'invalid-input' },
  { name: 'a fractional revision', change: (p) => { p.revision = 1.5; }, code: 'invalid-input' },
  { name: 'a duplicated shot id across active and parked', change: (p) => { p.parkedShots[0].id = 'shot-1'; }, code: 'invalid-input' },
  { name: 'a shot without an image', change: (p) => { p.shots[0].imageId = 'image-absent'; }, code: 'invalid-input' },
  { name: 'a dialogue on an unknown shot', change: (p) => { p.dialogues[0].shotId = 'shot-absent'; }, code: 'invalid-input' },
  { name: 'a duplicated dialogue id', change: (p) => { p.dialogues[1].id = p.dialogues[0].id; }, code: 'invalid-input' },
  { name: 'an image whose key is not its id', change: (p) => { p.images['image-renamed'] = p.images['image-2']; delete p.images['image-2']; }, code: 'invalid-input' },
  { name: 'an opacity outside [0,1]', change: (p) => { p.images['image-1'].layers[0].opacity = 1.5; }, code: 'invalid-input' },
  { name: 'an unsupported blend mode', change: (p) => { p.images['image-1'].layers[0].blendMode = 'overlay'; }, code: 'invalid-input' },
  { name: 'a layer smaller than its canvas', change: (p) => { p.images['image-1'].layers[0].width = 4; }, code: 'invalid-input' },
  { name: 'a layer with a different canvas size', change: (p) => { p.images['image-1'].layers[0].height = 9; }, code: 'invalid-input' },
  { name: 'an uppercase asset id', change: (p) => { p.images['image-1'].layers[0].assetId = 'A'.repeat(64); }, code: 'invalid-input' },
  { name: 'an asset id shaped like a path traversal', change: (p) => { p.images['image-1'].layers[0].assetId = `../../${'a'.repeat(58)}`; }, code: 'invalid-input' },
  { name: 'a short asset id', change: (p) => { p.images['image-1'].layers[0].assetId = 'abc'; }, code: 'invalid-input' },
  { name: 'an image with no layers', change: (p) => { p.images['image-1'].layers = []; }, code: 'invalid-input' },
  { name: 'a duplicated layer id', change: (p) => { p.images['image-1'].layers[1].id = p.images['image-1'].layers[0].id; }, code: 'invalid-input' },
  { name: 'a zero image dimension', change: (p) => { p.images['image-1'].width = 0; }, code: 'invalid-input' }
];

describe('manifest validation', () => {
  for (const rejection of rejections) {
    it(`refuses ${rejection.name} without publishing anything`, async () => {
      const root = await temporaryWorkspace('persistence-reject-');
      const { project, assets } = await scene();
      const changed = clone(project);
      rejection.change(changed);

      const saved = await store.saveCheckpoint(root, changed, readerFor(assets));
      expect(saved.ok).toBe(false);
      if (saved.ok) return;
      expect(saved.error.code).toBe(rejection.code);
      expect(saved.error.message.length).toBeGreaterThan(0);
      // Validation runs before the root is touched.
      await expect(fs.stat(storePaths(root).store)).rejects.toThrow();
    });
  }

  it('refuses a value that is not an object, and a cyclic one', async () => {
    const root = await temporaryWorkspace('persistence-reject-shape-');
    const { assets } = await scene();
    const notObject = await store.saveCheckpoint(root, [] as never, readerFor(assets));
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.error.code).toBe('invalid-input');

    const cyclic: any = { schema: 'storyboard-flow.project' };
    cyclic.self = cyclic;
    const cyclicResult = await store.saveCheckpoint(root, cyclic, readerFor(assets));
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) expect(cyclicResult.error.code).toBe('invalid-input');
  });

  it('reports a manifest that is not JSON, not UTF-8 or not an object', async () => {
    const cases: { name: string; bytes: Buffer; code: CoreErrorCodeV1 }[] = [
      { name: 'not JSON', bytes: Buffer.from('{oops'), code: 'invalid-input' },
      { name: 'not UTF-8', bytes: Buffer.from([0x7b, 0xff, 0x7d]), code: 'invalid-input' },
      { name: 'an array', bytes: Buffer.from('[]'), code: 'invalid-input' },
      { name: 'an unsupported schema', bytes: Buffer.from('{"schema":"other","version":1}'), code: 'unsupported-version' },
      { name: 'an unsupported version', bytes: Buffer.from('{"schema":"storyboard-flow.project","version":7}'), code: 'unsupported-version' }
    ];
    for (const manifestCase of cases) {
      const root = await temporaryWorkspace('persistence-manifest-');
      const { project, assets } = await scene();
      expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
      await fs.writeFile(storePaths(root).manifest, manifestCase.bytes);

      const loaded = await store.loadCheckpoint(root);
      expect(loaded.ok, manifestCase.name).toBe(false);
      if (loaded.ok) continue;
      expect(loaded.error.code, manifestCase.name).toBe(manifestCase.code);
    }
  });

  it('reports no checkpoint at all as not-found', async () => {
    const root = await temporaryWorkspace('persistence-no-store-');
    const empty = await store.loadCheckpoint(root);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('not-found');

    await fs.mkdir(storePaths(root).store);
    const withoutManifest = await store.loadCheckpoint(root);
    expect(withoutManifest.ok).toBe(false);
    if (!withoutManifest.ok) expect(withoutManifest.error.code).toBe('not-found');
  });

  it('refuses two active shots that share one editable image, before any write', async () => {
    const root = await temporaryWorkspace('persistence-shared-image-');
    const { project, assets } = await scene();
    const shared = clone(project);
    shared.shots[1] = { ...shared.shots[1], imageId: shared.shots[0].imageId };

    const saved = await store.saveCheckpoint(root, shared, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
    expect(saved.error.message).toContain(shared.shots[0].imageId);
    // Rejected before the store directory is created.
    await expect(fs.stat(storePaths(root).store)).rejects.toThrow();
  });

  it('refuses an active and a parked shot that share one editable image', async () => {
    const root = await temporaryWorkspace('persistence-shared-image-parked-');
    const { project, assets } = await scene();
    const shared = clone(project);
    shared.parkedShots[0] = { ...shared.parkedShots[0], imageId: shared.shots[0].imageId };

    const saved = await store.saveCheckpoint(root, shared, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('invalid-input');
    expect(saved.error.message).toContain('shot-parked');
    expect(saved.error.message).toContain(shared.shots[0].imageId);

    // A retained image no shot owns stays legal: the scene keeps image-4 that way.
    const retained = clone(project);
    expect(retained.shots.some((shot) => shot.imageId === 'image-4')).toBe(false);
    expect(retained.parkedShots.some((shot) => shot.imageId === 'image-4')).toBe(false);
    const accepted = await store.saveCheckpoint(root, retained, readerFor(assets));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.revision).toBe(1);
  });

  it('refuses to overwrite a head it cannot read', async () => {
    const root = await temporaryWorkspace('persistence-corrupt-head-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const corrupt = Buffer.from('{"schema":"storyboard-flow.project"', 'utf8');
    await fs.writeFile(storePaths(root).manifest, corrupt);

    const second = clone(project);
    second.revision = 2;
    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect(saved.error.message).toContain('not a usable checkpoint');
    expect((await fs.readFile(storePaths(root).manifest)).equals(corrupt)).toBe(true);
  });

  it('does not require the retained history to be complete', async () => {
    const root = await temporaryWorkspace('persistence-history-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    // Removing a retained version record is not repaired or reported by load.
    await fs.rm(path.join(storePaths(root).versions, '1.json'));
    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project).toEqual(project);
  });
});
