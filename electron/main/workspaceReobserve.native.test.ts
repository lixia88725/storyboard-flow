import { afterEach, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reobserve-'));
  roots.push(root);
  const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json');
  const png = path.join(root, '.storyboard-workbench/layers/s/a.png');
  await fs.mkdir(path.dirname(png), { recursive: true, mode: 0o700 });
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.writeFile(png, bytes, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), await sharp(bytes).tiff().toBuffer(), { mode: 0o600 });
  const project = { id: 'p', name: 'Re-observe', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 4, canvasHeight: 4 }, layers: [{ id: 'a', kind: 'paint', bitmapPath: '.storyboard-workbench/layers/s/a.png', width: 4, height: 4 }] }], dialogues: [] };
  await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 });
  return { root };
};

const service = () => createPreparedWorkspaceSave({
  budget: { bytes: 1048576, records: 2000, assets: 32, jsonDepth: 80 },
  python: 'python3',
  script: path.resolve('scripts/recovery-content-permissions.py')
} as any);

test('a reloaded document re-observes a clean workspace instead of being refused as changed', async () => {
  const { root } = await fixture();
  const save = service();
  const frame = {};
  const sender: any = { mainFrame: frame };
  const event: any = { sender, senderFrame: frame };

  const first = await save.observeWorkspace(event, root);
  expect(first.folderPath).toBe(await fs.realpath(root));

  // Exactly what main.ts does on a main-frame navigation (renderer reload).
  save.invalidateDocument(sender);

  const second = await save.observeWorkspace(event, root);
  expect(second.folderPath).toBe(first.folderPath);
  expect(second.binding).not.toBe(first.binding);
});
