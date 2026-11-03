import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import { createProjectStore } from '.';
import { readerFor, scene } from './store.fixture.ts';

it('stores checkpoints in the Flow namespace without changing runtime or historical data', async () => {
  const root = await temporaryWorkspace('flow-naming-');
  const { project, assets } = await scene();
  // Historical decoys are preservation evidence, not active naming aliases.
  const preserved = [
    '.storyboard-flow/storyboard.project.json',
    '.storyboard-flow-project/.source-folder.json',
    '.storyboard-workbench/storyboard.project.json',
    '.storyboard-flow-v2/project.json'
  ];
  for (const file of preserved) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), `preserve:${file}`);
  }
  const store = createProjectStore();
  const saved = await store.saveCheckpoint(root, project, readerFor(assets));
  expect(saved).toMatchObject({ ok: true, value: { manifestPath: path.join(root, '.storyboard-flow/checkpoints/project.json') } });
  const loaded = await store.loadCheckpoint(root);
  expect(loaded.ok).toBe(true);
  if (loaded.ok) expect(loaded.value.project).toEqual(project);
  for (const file of preserved) expect(await fs.readFile(path.join(root, file), 'utf8')).toBe(`preserve:${file}`);
});

it('refuses a linked product namespace before creating a checkpoint through it', async () => {
  const root = await temporaryWorkspace('flow-naming-link-');
  const outside = root + '-outside';
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, '.storyboard-flow'), 'dir');
  const { project, assets } = await scene();
  const store = createProjectStore();
  expect(await store.saveCheckpoint(root, project, readerFor(assets)))
    .toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(await store.loadCheckpoint(root)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(await fs.readdir(outside)).toEqual([]);
});
