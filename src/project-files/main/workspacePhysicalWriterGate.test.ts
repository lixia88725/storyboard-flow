import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate';

for (const namespace of ['workspace-recovery-v1', 'workspace-recovery-v2']) {
 test(`new writer refuses ${namespace} before effects, including aliases and child destinations`, async () => {
  const root = await temporaryWorkspace('flow-protected-root-');
  const clean = await temporaryWorkspace('flow-clean-root-');
  const marker = path.join(root, '.storyboard-flow', namespace);
  await fs.mkdir(marker, { recursive: true });
  const alias = path.join(clean, 'alias'); await fs.symlink(root, alias);
  for (const target of [root, alias, path.join(root, 'fresh', 'image.tif'), marker]) {
   await expect(assertPhysicalWorkspaceWriterTargets([target])).rejects.toThrow('protected');
  }
  await expect(assertPhysicalWorkspaceWriterTargets([clean, root])).rejects.toThrow('protected');
  expect(await fs.readdir(marker)).toEqual([]);
  await expect(assertPhysicalWorkspaceWriterTargets([clean])).resolves.toBeUndefined();
 });
}
test('unknown recovery marker and broken marker alias still refuse', async () => {
 const root = await temporaryWorkspace('flow-marker-');
 await fs.mkdir(path.join(root, '.storyboard-flow'));
 const marker = path.join(root, '.storyboard-flow/workspace-recovery-v2');
 await fs.writeFile(marker, 'unknown');
 await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
 await fs.unlink(marker); await fs.symlink(path.join(root, 'missing'), marker);
 await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
});
test('missing or relative writer targets refuse', async () => {
 await expect(assertPhysicalWorkspaceWriterTargets([])).rejects.toThrow();
 await expect(assertPhysicalWorkspaceWriterTargets(['relative'])).rejects.toThrow();
});
