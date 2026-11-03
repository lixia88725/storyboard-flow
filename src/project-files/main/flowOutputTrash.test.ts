import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createOutputTrash, type OutputDeletion, type TrashItem } from './flowOutputTrash';

async function fixture() {
  const root = await temporaryWorkspace('flow-trash-');
  await fs.mkdir(path.join(root, '.storyboard-flow'));
  const file = path.join(root, 'owned.tif'), bytes = Buffer.from('synthetic TIFF fixture');
  await fs.writeFile(file, bytes);
  const identity = await fs.stat(root), digest = createHash('sha256').update(bytes).digest('hex');
  const sink = path.join(root, 'synthetic-trash'); await fs.mkdir(sink);
  const native = vi.fn(async (source: string) => { await fs.rename(source, path.join(sink, path.basename(source))); });
  const open = (adapter: TrashItem = native) => createOutputTrash(root, 'project', identity, async () => {
    const now = await fs.lstat(root);
    if (now.dev !== identity.dev || now.ino !== identity.ino) throw Error('root changed');
  }, adapter);
  const output = open(), intent = await output.prepare('owned.tif', 'active', digest);
  const staged = path.join(root, '.storyboard-flow/deletions', intent.token, 'owned.tif');
  return { root, file, bytes, sink, native, open, output, intent, staged };
}
describe('owned output Trash transaction', () => {
  it('persists dispatch before invoking Trash and acknowledges only after removal', async () => {
    const f = await fixture(), phases: string[] = [];
    f.native.mockImplementationOnce(async source => {
      expect(phases).toEqual(['ready', 'dispatching']);
      expect(source).toBe(f.staged);
      await fs.rename(source, path.join(f.sink, 'owned.tif'));
    });
    await f.output.settle('owned.tif', f.intent, async () => { phases.push(f.intent.phase); });
    expect(phases).toEqual(['ready', 'dispatching', 'confirmed']);
    expect(f.native).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path.join(f.sink, 'owned.tif'))).toEqual(f.bytes);
    await expect(fs.stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.output.hasPendingAcknowledgements()).toBe(false);
    await f.open().settle('owned.tif', f.intent, async () => {});
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('retains a rejected Trash attempt and retries after reopening without an unlink fallback', async () => {
    const f = await fixture(); f.native.mockRejectedValueOnce(Error('OS refused'));
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow('OS refused');
    expect(await fs.readFile(f.staged)).toEqual(f.bytes);
    expect(f.intent.phase).toBe('dispatching');
    await f.open().settle('owned.tif', structuredClone(f.intent), async () => {});
    expect(f.native).toHaveBeenCalledTimes(2);
  });
  it.each(['ready', 'dispatching'] as const)('retries a failed %s phase publication from the durable previous intent', async phase => {
    const f = await fixture(); let durable = structuredClone(f.intent);
    await expect(f.output.settle('owned.tif', f.intent, async () => {
      if (f.intent.phase === phase) throw Error('write failed');
      durable = structuredClone(f.intent);
    })).rejects.toThrow('write failed');
    expect(f.native).not.toHaveBeenCalled();
    expect(await fs.readFile(f.staged)).toEqual(f.bytes);
    await f.open().settle('owned.tif', durable, async () => {});
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('keeps a real OS ACK across confirmation write failure, refuses restart guesses and retries without redispatch', async () => {
    const f = await fixture(); let durable: OutputDeletion = structuredClone(f.intent);
    await expect(f.output.settle('owned.tif', f.intent, async () => {
      if (f.intent.phase === 'confirmed') throw Error('confirmation disk failure');
      durable = structuredClone(f.intent);
    })).rejects.toThrow('confirmation disk failure');
    expect(f.output.hasPendingAcknowledgements()).toBe(true);
    await expect(f.open().settle('owned.tif', structuredClone(durable), async () => {})).rejects.toThrow('unknown');
    expect(f.native).toHaveBeenCalledTimes(1);
    await f.output.settle('owned.tif', durable, async () => {});
    expect(f.output.hasPendingAcknowledgements()).toBe(false);
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('does not drop a nondurable ACK when retried with the same mutated confirmed intent', async () => {
    const f = await fixture();
    const fail = async () => { if (f.intent.phase === 'confirmed') throw Error('disk failure'); };
    await expect(f.output.settle('owned.tif', f.intent, fail)).rejects.toThrow('disk failure');
    await expect(f.output.settle('owned.tif', f.intent, fail)).rejects.toThrow('disk failure');
    expect(f.output.hasPendingAcknowledgements()).toBe(true);
    await f.output.settle('owned.tif', f.intent, async () => {});
    expect(f.output.hasPendingAcknowledgements()).toBe(false);
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('refuses missing staged content without interpreting disappearance as success', async () => {
    const f = await fixture(); f.native.mockRejectedValueOnce(Error('refused'));
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow();
    await fs.rename(f.staged, path.join(f.sink, 'externally-moved.tif'));
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow('unknown');
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it.each(['content', 'directory', 'symlink'] as const)('refuses %s replacement before a subsequent Trash dispatch', async kind => {
    const f = await fixture(); f.native.mockRejectedValueOnce(Error('refused'));
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow();
    if (kind === 'content') await fs.writeFile(f.staged, 'foreign');
    else {
      const dir = path.dirname(f.staged); await fs.rename(dir, dir + '-retained');
      if (kind === 'directory') { await fs.mkdir(dir); await fs.writeFile(f.staged, f.bytes); }
      else await fs.symlink(dir + '-retained', dir);
    }
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow();
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('does not accept a success response if the OS left the staged file in place', async () => {
    const f = await fixture(); f.native.mockResolvedValueOnce(undefined);
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow('without removing');
    expect(f.output.hasPendingAcknowledgements()).toBe(true);
    expect(await fs.readFile(f.staged)).toEqual(f.bytes);
    await expect(f.output.settle('owned.tif', f.intent, async () => {})).rejects.toThrow('reappeared');
    expect(f.native).toHaveBeenCalledTimes(1);
  });
});
