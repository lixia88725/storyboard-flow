import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createImageProject } from './createImageProject';

// Simulate the native publication succeeding and the following directory flush
// failing. The creation must judge the outcome by the destination's identity and
// retain it, never report "nothing was created" or try to remove it.
vi.mock('../../platform/main/platform/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../platform/main/platform/index.js')>();
  return { ...actual, publishDirectoryExclusive: async (source: string, target: string) => {
    await actual.publishDirectoryExclusive(source, target);
    throw new Error('simulated directory flush failure');
  } };
});

describe('createImageProject publication durability', () => {
  it('retains the destination when the rename succeeded but the flush failed', async () => {
    const root = await temporaryWorkspace('flow-publish-flush-');
    const sources = path.join(root, 'sources');
    const destination = path.join(root, 'out');
    await fs.mkdir(sources);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(sources, 'one.png'),
      await sharp({ create: { width: 4, height: 3, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer());
    const target = path.join(destination, 'Durable');
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Durable', name: 'Durable',
        naming: { sceneCode: 'S01', artistName: 'Li', version: '1' } },
      { signal: new AbortController().signal })).rejects.toThrow(/retained at/i);
    // The rename happened: the project exists and is owned, not a leftover stage.
    expect((await fs.readdir(destination)).sort()).toEqual(['Durable']);
    expect(await fs.readFile(path.join(target, '.storyboard-flow', 'checkpoints', 'project.json'), 'utf8')).toContain('Durable');
    expect((await fs.readdir(target)).some(name => name.endsWith('_0010.tif'))).toBe(true);
  }, 60_000);
});
