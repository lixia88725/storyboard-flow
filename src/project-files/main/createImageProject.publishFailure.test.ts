import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createImageProject } from './createImageProject';

const captured = vi.hoisted(() => ({ identity: undefined as { dev: bigint; ino: bigint } | undefined }));

// Simulate the native publication succeeding and the following directory flush
// failing. The creation must judge the outcome by the destination's identity and
// retain it, never report "nothing was created" or try to remove it.
vi.mock('../../platform/main/platform/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../platform/main/platform/index.js')>();
  return { ...actual, publishDirectoryExclusive: async (source: string, target: string, identity?: { dev: bigint; ino: bigint }) => {
    captured.identity = identity;
    await actual.publishDirectoryExclusive(source, target, identity);
    throw new Error('simulated directory flush failure');
  } };
});

describe('createImageProject publication durability', () => {
  it('passes the creation identity to the native publication and retains the result', async () => {
    const root = await temporaryWorkspace('flow-publish-flush-');
    const sources = path.join(root, 'sources');
    const destination = path.join(root, 'out');
    await fs.mkdir(sources);
    await fs.mkdir(destination);
    const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    for (const name of ['one.png', 'two.png']) await fs.writeFile(path.join(sources, name), png);
    let stageIdentity: { dev: bigint; ino: bigint } | undefined;
    const target = path.join(destination, 'Durable');
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Durable', name: 'Durable',
        naming: { sceneCode: 'S01', artistName: 'Li', version: '1' } },
      { signal: new AbortController().signal,
        onProgress: ({ done, phase }) => {
          if (done !== 1 || phase !== 'write') return;
          const stage = readdirSync(destination).find(name => name.startsWith('.flow-create-'));
          if (!stage) return;
          const entry = lstatSync(path.join(destination, stage), { bigint: true });
          stageIdentity = { dev: entry.dev, ino: entry.ino };
        } })).rejects.toThrow(/retained at/i);
    // The native helper must receive the identity captured when the stage was made.
    expect(stageIdentity).toBeDefined();
    expect(captured.identity).toEqual(stageIdentity);
    // The rename happened: the project exists and is owned, not a leftover stage.
    expect((await fs.readdir(destination)).sort()).toEqual(['Durable']);
    expect(await fs.readFile(path.join(target, '.storyboard-flow', 'checkpoints', 'project.json'), 'utf8')).toContain('Durable');
    expect((await fs.readdir(target)).some(name => name.endsWith('_0010.tif'))).toBe(true);
  }, 60_000);

  it('refuses a native publication whose source was swapped after the identity capture', async () => {
    const root = await temporaryWorkspace('flow-publish-swap-');
    const source = path.join(root, 'stage');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ours.txt'), 'ours');
    const identity = await fs.lstat(source, { bigint: true });
    await fs.rename(source, source + '-moved');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'foreign.txt'), 'foreign');
    const actual = await vi.importActual<typeof import('../../platform/main/platform/index.js')>('../../platform/main/platform/index.js');
    await expect(actual.publishDirectoryExclusive(source, path.join(root, 'target'), { dev: identity.dev, ino: identity.ino }))
      .rejects.toThrow(/identity changed before publication/);
    // Nothing moved: the replacement and the original stage are both untouched.
    await expect(fs.lstat(path.join(root, 'target'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(source, 'foreign.txt'), 'utf8')).toBe('foreign');
    expect(await fs.readFile(path.join(source + '-moved', 'ours.txt'), 'utf8')).toBe('ours');
  }, 30_000);
});
