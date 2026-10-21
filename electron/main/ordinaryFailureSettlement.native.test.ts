import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { copyLayerPng, mergeLayerDown, writeLayerPng } from './layerAssetService';
import { ProtectedLayerWriteError } from './protectedLayerFileWriter';

// Actual Main + ordinary producer + native permission writer. The callback only
// changes document identity after the real failed effect settles, before its
// rejection returns to Main. This is not an Electron reload lifecycle proof.
for (const producer of ['writePng', 'copyPng', 'mergeDown'] as const) {
  test(`before first Save ${producer} keeps native primary failure when original document settlement also fails`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-settlement-'));
    const sourceBitmapPath = '.storyboard-workbench/layers/s/source.png';
    const targetBitmapPath = '.storyboard-workbench/layers/s/target.png';
    const source = path.join(root, sourceBitmapPath), target = path.join(root, targetBitmapPath);
    const frame = {}, sender = { mainFrame: frame }, event: any = { sender, senderFrame: frame };
    const service = createPreparedWorkspaceSave({
      budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 },
      python: 'python3',
      script: path.resolve('scripts/recovery-content-permissions.py')
    });
    try {
      await fs.mkdir(path.dirname(source), { recursive: true, mode: 0o700 });
      const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
      const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
      await fs.writeFile(source, blue, { mode: 0o600 });
      await fs.writeFile(target, red, { mode: 0o400 });
      const before = await fs.lstat(target);
      await service.observeWorkspace(event, root);
      let primary: unknown;
      const effect = () => producer === 'writePng'
        ? writeLayerPng({ folderPath: root, bitmapPath: targetBitmapPath, dataUrl: 'data:image/png;base64,' + blue.toString('base64') })
        : producer === 'copyPng'
          ? copyLayerPng({ folderPath: root, sourceBitmapPath, targetBitmapPath })
          : mergeLayerDown({ folderPath: root, sourceBitmapPath, targetBitmapPath, width: 2, height: 2, sourceOpacity: 1, targetOpacity: 1, sourceBlendMode: 'normal', targetBlendMode: 'normal' });
      const failure = await service.ordinary(event, 'layers:' + producer, { folderPath: root }, [source, target], async () => {
        try { return await effect(); }
        catch (error) { primary = error; service.invalidateDocument(sender); throw error; }
      }).catch(error => error);
      expect(primary).toBeInstanceOf(ProtectedLayerWriteError);
      expect(primary).toMatchObject({ effect: 'refused', filePath: target, retainedTemporary: null });
      expect(await fs.readFile(target)).toEqual(red);
      expect(await fs.readFile(source)).toEqual(blue);
      const after = await fs.lstat(target);
      expect([after.dev, after.ino, after.mode, after.nlink]).toEqual([before.dev, before.ino, before.mode, before.nlink]);
      await expect(fs.lstat(path.join(root, '.storyboard-workbench/workspace-recovery-v1'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(failure).toBe(primary);
      expect(failure).toMatchObject({ effect: 'refused', filePath: target, retainedTemporary: null, settlementError: expect.stringContaining('incarnation changed') });
      expect(failure.message).toContain('PNG_REFUSED');
      await expect(service.observeWorkspace(event, root)).rejects.toThrow('incarnation changed');
    } finally {
      // Only this owned synthetic fixture; no production cleanup or force quit.
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120000);
}
