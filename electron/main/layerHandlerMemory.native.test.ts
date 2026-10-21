import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { createLayerAppHandlers } from './layerAppRuntime.js';
import { createControlledMemoryBudget } from './controlledMemory.js';
import { MAIN_MEMORY_BUDGET_BYTES, MAIN_MEMORY_JSON, MAIN_MEMORY_PRESSURE } from './memoryPolicy.js';

test('the layer IPC handlers refuse an unfundable write before any layer-file effect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'layer-handler-memory-'));
  const relative = '.storyboard-workbench/layers/s/a.png';
  const file = path.join(root, relative);
  const old = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const next = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'green' } }).png().toBuffer();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, old, { mode: 0o600 });

  const handlers = createLayerAppHandlers({ memoryBudget: createControlledMemoryBudget(1) });
  await expect(handlers.writePng({
    folderPath: root,
    bitmapPath: relative,
    dataUrl: 'data:image/png;base64,' + next.toString('base64'),
  })).rejects.toMatchObject({ code: 'RAM_ADMISSION' });

  expect(await fs.readFile(file)).toEqual(old);
});

test('the production memory policy is a valid finite admission policy', () => {
  expect(() => createControlledMemoryBudget(
    MAIN_MEMORY_BUDGET_BYTES,
    { policy: MAIN_MEMORY_PRESSURE },
    MAIN_MEMORY_JSON,
  )).not.toThrow();
  expect(MAIN_MEMORY_PRESSURE.operationHeadroomBytes).toBeLessThan(MAIN_MEMORY_PRESSURE.rssBytes);
  expect(MAIN_MEMORY_PRESSURE.minimumFreeBytes).toBeGreaterThan(0);
  expect(MAIN_MEMORY_JSON.maximumNesting).toBeGreaterThanOrEqual(81);
});
