import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { readLayerPng } from './layerAssetService.js';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory.js';

const tight = () => createControlledMemoryBudget(16 * 1024 * 1024, {
  policy: { rssBytes: 1, externalBytes: 1, heapBytes: 1, minimumFreeBytes: 0, operationHeadroomBytes: 0 },
});

test('reading a layer PNG is refused before the base64 text is built when the live system is over its limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'layer-read-memory-'));
  const relative = '.storyboard-workbench/layers/s/a.png';
  const file = path.join(root, relative);
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: 'green' } }).png().toBuffer();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, png, { mode: 0o600 });

  await expect(
    withControlledMemory(tight(), () => readLayerPng({ folderPath: root, bitmapPath: relative })),
  ).rejects.toMatchObject({ code: 'RAM_ADMISSION' });
});

test('a roomy budget still returns the exact original data URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'layer-read-roomy-'));
  const relative = '.storyboard-workbench/layers/s/a.png';
  const file = path.join(root, relative);
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, png, { mode: 0o600 });

  const url = await withControlledMemory(
    createControlledMemoryBudget(16 * 1024 * 1024, {
      policy: { rssBytes: 8 * 1024 * 1024 * 1024, externalBytes: 8 * 1024 * 1024 * 1024, heapBytes: 8 * 1024 * 1024 * 1024, minimumFreeBytes: 0, operationHeadroomBytes: 0 },
    }),
    () => readLayerPng({ folderPath: root, bitmapPath: relative }),
  );
  expect(url).toBe('data:image/png;base64,' + png.toString('base64'));
});

test('a missing layer PNG still resolves to undefined without a memory refusal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'layer-read-missing-'));
  await expect(
    withControlledMemory(tight(), () => readLayerPng({ folderPath: root, bitmapPath: '.storyboard-workbench/layers/s/none.png' })),
  ).resolves.toBeUndefined();
});
