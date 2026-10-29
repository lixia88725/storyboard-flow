import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { currentPlatformKind, linkExclusive, replaceFile, syncDirectory } from './index';

describe('platform filesystem primitives', () => {
  it('flushes a directory on POSIX and reports the skip where the OS cannot', async () => {
    const root = await temporaryWorkspace('platform-fsync-');
    const result = await syncDirectory(root);
    expect(result).toBe(currentPlatformKind === 'win32' ? 'skipped' : 'synced');

    // As win32 there is no filesystem access at all, so a missing path is fine.
    await expect(syncDirectory(path.join(root, 'does-not-exist'), 'win32')).resolves.toBe('skipped');
  });

  it('links a new name and never replaces an existing one', async () => {
    const root = await temporaryWorkspace('platform-link-');
    const source = path.join(root, 'source.bin');
    const target = path.join(root, 'target.bin');
    await fs.writeFile(source, 'immutable');

    await linkExclusive(source, target);
    expect(await fs.readFile(target, 'utf8')).toBe('immutable');
    const linked = await fs.stat(target, { bigint: true });
    const original = await fs.stat(source, { bigint: true });
    expect(linked.ino).toBe(original.ino);

    await expect(linkExclusive(source, target)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(target, 'utf8')).toBe('immutable');
  });

  it('replaces a name atomically and never writes through a symbolic link', async () => {
    const root = await temporaryWorkspace('platform-replace-');
    const target = path.join(root, 'head.json');
    const temp = path.join(root, 'head.tmp');
    await fs.writeFile(target, 'old');
    await fs.writeFile(temp, 'new');
    await replaceFile(temp, target);
    expect(await fs.readFile(target, 'utf8')).toBe('new');
    await expect(fs.stat(temp)).rejects.toThrow();

    // A planted link at the target is replaced as an entry; its target is untouched.
    const outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, 'do not touch');
    const linkedTarget = path.join(root, 'linked.json');
    await fs.symlink(outside, linkedTarget);
    const replacement = path.join(root, 'replacement.tmp');
    await fs.writeFile(replacement, 'replacement');
    await replaceFile(replacement, linkedTarget);
    const entry = await fs.lstat(linkedTarget);
    expect(entry.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(linkedTarget, 'utf8')).toBe('replacement');
    expect(await fs.readFile(outside, 'utf8')).toBe('do not touch');
  });
});
