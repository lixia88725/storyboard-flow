import { test, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { allocateTemporaryWorkspace, temporaryWorkspace } from '../../../test/temporaryWorkspace';

const automaticContainers: string[] = [];
afterAll(async () => {
  for (const folder of automaticContainers) await expect(fs.lstat(folder)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('successful test cleanup includes root, sibling copies and aliases in a canonical temp container', async () => {
  const root = await temporaryWorkspace('gate-fixture-');
  automaticContainers.push(path.dirname(root));
  expect(await fs.realpath(root)).toBe(root);
  expect(root.startsWith(process.cwd() + path.sep)).toBe(false);
  await fs.writeFile(path.join(root, 'source.txt'), 'synthetic');
  await fs.cp(root, root + '-copy', { recursive: true });
  await fs.symlink(root, root + '-alias');
});

test('cleanup does not follow an alias to another scope; a failed test retains its evidence', async () => {
  const kept = await allocateTemporaryWorkspace('gate-clean-');
  const failed = await allocateTemporaryWorkspace('gate-v2-partial-');
  try {
    const original = path.join(kept.root, 'original.txt');
    await fs.writeFile(original, 'preserve');
    await fs.symlink(kept.root, path.join(failed.root, 'external-alias'));
    await fs.writeFile(path.join(failed.root, 'failure.json'), '{"failed":true}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await failed.finish(true); expect(warn).toHaveBeenCalledWith(expect.stringContaining(failed.container)); }
    finally { warn.mockRestore(); }
    expect(await fs.readFile(path.join(failed.root, 'failure.json'), 'utf8')).toBe('{"failed":true}');
    await failed.finish(false);
    expect(await fs.readFile(original, 'utf8')).toBe('preserve');
    await expect(fs.lstat(failed.container)).rejects.toMatchObject({code:'ENOENT'});
  } finally { await failed.finish(false); await kept.finish(false); }
});

test('an unsafe prefix cannot allocate arbitrary paths', async () => {
  await expect(allocateTemporaryWorkspace('../gate-')).rejects.toThrow('simple name');
});


test('a temporary-directory override inside the checkout is refused before creating a fixture', async () => {
  const before = await fs.readdir(process.cwd());
  const temp = vi.spyOn(os, 'tmpdir').mockReturnValue(process.cwd());
  try { await expect(allocateTemporaryWorkspace('gate-clean-')).rejects.toThrow('outside the source checkout'); }
  finally { temp.mockRestore(); }
  expect(await fs.readdir(process.cwd())).toEqual(before);
});
