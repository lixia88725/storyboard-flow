import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './index';
import { canonicalJson } from './canonicalJson';
import { clone, dialogueOf, readerFor, scene, storePaths } from './store.fixture';

const store = createProjectStore();

describe('asset reuse, idempotency and revision conflicts', () => {
  it('does not overwrite a reused asset and verifies its existing bytes', async () => {
    const root = await temporaryWorkspace('persistence-reuse-');
    const { project, assets } = await scene();
    const assetId = [...assets.keys()][0];
    const assetFile = path.join(storePaths(root).assets, `${assetId}.png`);

    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const first = await fs.stat(assetFile, { bigint: true });

    const second = clone(project);
    second.revision = 2;
    second.shots[1].scriptText = '第二个版本';
    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(2);

    // Same blob, same identity, same modification time: nothing was rewritten.
    const after = await fs.stat(assetFile, { bigint: true });
    expect(after.ino).toBe(first.ino);
    expect(after.mtimeNs).toBe(first.mtimeNs);
    expect((await fs.readFile(assetFile)).equals(assets.get(assetId)!)).toBe(true);
    expect(await fs.readdir(storePaths(root).assets)).toHaveLength(5);
  });

  it('reports a corrupt existing blob as a conflict and never repairs it by overwriting', async () => {
    const root = await temporaryWorkspace('persistence-corrupt-blob-');
    const { project, assets } = await scene();
    const assetId = [...assets.keys()][0];
    const assetFile = path.join(storePaths(root).assets, `${assetId}.png`);
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const corrupt = Buffer.from(await fs.readFile(assetFile));
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1] ^ 0xff;
    await fs.writeFile(assetFile, corrupt);

    const second = clone(project);
    second.revision = 2;
    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect(saved.error.message).toContain(assetId);

    // The corrupt file is retained as found; the manifest still names revision 1.
    expect((await fs.readFile(assetFile)).equals(corrupt)).toBe(true);
    const manifest = JSON.parse(await fs.readFile(storePaths(root).manifest, 'utf8')) as { revision: number };
    expect(manifest.revision).toBe(1);
    expect(await fs.readdir(storePaths(root).versions)).toEqual(['1.json']);
  });

  it('treats the same revision with the same content as a no-op', async () => {
    const root = await temporaryWorkspace('persistence-idempotent-');
    const { project, assets } = await scene();
    const paths = storePaths(root);

    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const manifestBefore = await fs.stat(paths.manifest, { bigint: true });
    const versionBefore = await fs.stat(path.join(paths.versions, '1.json'), { bigint: true });

    const repeat = await store.saveCheckpoint(root, clone(project), readerFor(assets));
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.value).toEqual({ projectId: 'project-scene', revision: 1, manifestPath: paths.manifest });

    const manifestAfter = await fs.stat(paths.manifest, { bigint: true });
    expect(manifestAfter.ino).toBe(manifestBefore.ino);
    expect(manifestAfter.mtimeNs).toBe(manifestBefore.mtimeNs);
    expect((await fs.stat(path.join(paths.versions, '1.json'), { bigint: true })).mtimeNs).toBe(versionBefore.mtimeNs);
    expect(await fs.readFile(paths.manifest, 'utf8')).toBe(canonicalJson(project) + '\n');
  });

  it('rejects a stale revision after a newer checkpoint was published', async () => {
    const root = await temporaryWorkspace('persistence-stale-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const newer = clone(project);
    newer.revision = 2;
    expect((await store.saveCheckpoint(root, newer, readerFor(assets))).ok).toBe(true);

    const stale = clone(project);
    stale.revision = 1;
    stale.name = 'older attempt';
    const saved = await store.saveCheckpoint(root, stale, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect(saved.error.message).toContain('stale');

    const head = JSON.parse(await fs.readFile(storePaths(root).manifest, 'utf8')) as { revision: number; name: string };
    expect(head.revision).toBe(2);
    expect(head.name).toBe(project.name);
  });

  it('rejects different content published under an already used revision', async () => {
    const root = await temporaryWorkspace('persistence-same-revision-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const different = clone(project);
    different.name = 'different content at the same revision';
    different.dialogues.push(dialogueOf('dialogue-extra', 'shot-2', '额外的台词'));
    const saved = await store.saveCheckpoint(root, different, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect(saved.error.message).toContain('different content');

    const loaded = await store.loadCheckpoint(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project).toEqual(project);
  });

  it('rejects a different project id at the same root', async () => {
    const root = await temporaryWorkspace('persistence-other-project-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    const other = clone(project);
    other.id = 'project-other';
    other.revision = 2;
    const saved = await store.saveCheckpoint(root, other, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect(saved.error.message).toContain('project-scene');

    const head = JSON.parse(await fs.readFile(storePaths(root).manifest, 'utf8')) as { id: string };
    expect(head.id).toBe('project-scene');
  });

  it('treats a version record as immutable: re-recording a revision with other bytes conflicts', async () => {
    const root = await temporaryWorkspace('persistence-version-immutable-');
    const { project, assets } = await scene();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);

    // Simulate a retained record for revision 2 written by an interrupted attempt.
    const versions = storePaths(root).versions;
    const planted = Buffer.from('{"retained":"other"}\n', 'utf8');
    await fs.writeFile(path.join(versions, '2.json'), planted);

    const second = clone(project);
    second.revision = 2;
    const saved = await store.saveCheckpoint(root, second, readerFor(assets));
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe('conflict');
    expect((await fs.readFile(path.join(versions, '2.json'))).equals(planted)).toBe(true);
    // Assets created for the refused revision are retained, correct and untouched;
    // the head still points at revision 1.
    const head = JSON.parse(await fs.readFile(storePaths(root).manifest, 'utf8')) as { revision: number };
    expect(head.revision).toBe(1);
  });
});
