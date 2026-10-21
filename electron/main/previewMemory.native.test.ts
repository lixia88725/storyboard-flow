import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MemoryAdmissionError, createControlledMemoryBudget, withControlledMemory } from './controlledMemory.js';
import { createPreview } from './previewService.js';

const makeImage = async (directory: string): Promise<string> => {
  const file = path.join(directory, 'source.tiff');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).tiff().toFile(file);
  return file;
};

const makeRoot = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), 'preview-memory-'));

describe('preview encode admission', () => {
  it('refuses the encode before any cache file exists when the budget cannot fund the decode', async () => {
    const root = await makeRoot();
    const image = await makeImage(root);
    const previewRoot = path.join(root, 'previews');
    const budget = createControlledMemoryBudget(1);

    await expect(withControlledMemory(budget, () => createPreview(image, previewRoot)))
      .rejects.toBeInstanceOf(MemoryAdmissionError);

    // The refusal happens inside the operation: no preview file, no staging root.
    await expect(stat(path.join(previewRoot, 'previews'))).rejects.toThrow();
    expect(await readdir(previewRoot)).toEqual([]);
    expect(budget.usage().usedBytes).toBe(0);
  });

  it('creates the preview when the budget funds the decode and releases the quote afterwards', async () => {
    const root = await makeRoot();
    const image = await makeImage(root);
    const previewRoot = path.join(root, 'previews');
    const budget = createControlledMemoryBudget(1024 * 1024);

    const previewPath = await withControlledMemory(budget, () => createPreview(image, previewRoot));

    const metadata = await sharp(await readFile(previewPath)).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(48);
    // The transient quote is cancelled; only real adopted backings may remain.
    expect(budget.usage().pendingBytes).toBe(0);
  });

  it('keeps working outside an explicit budget inside the test environment', async () => {
    const root = await makeRoot();
    const image = await makeImage(root);

    const previewPath = await createPreview(image, path.join(root, 'previews'));

    expect((await stat(previewPath)).isFile()).toBe(true);
  });
});
