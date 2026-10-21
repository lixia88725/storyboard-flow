import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { copyLayerPng, writeLayerPng } from './layerAssetService';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

const options = { budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 }, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') };
// Main/native/certifier seam only. Actual Electron lifecycle and editable cold
// adoption are not implied. All fixtures deliberately remain as failure evidence.
async function fixture(service: ReturnType<typeof createPreparedWorkspaceSave>, event: any, producer = 'writePng') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-preservation-'));
  const bitmapPath = '.storyboard-workbench/layers/s/a.png', sourceBitmapPath = '.storyboard-workbench/layers/s/b.png';
  const target = path.join(root, bitmapPath), source = path.join(root, sourceBitmapPath);
  const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, red, { mode: 0o400 }); await fs.writeFile(source, blue, { mode: 0o600 });
  const project: any = { id: 'p-' + producer, name: producer, shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: [{ id: 'a', kind: 'paint', bitmapPath, width: 2, height: 2 }, { id: 'b', kind: 'paint', bitmapPath: sourceBitmapPath, width: 2, height: 2 }] }], dialogues: [] };
  await fs.writeFile(project.shots[0].imagePath, await sharp(red).tiff().toBuffer(), { mode: 0o600 });
  const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json');
  await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 });
  await fs.writeFile(path.join(root, 'storyboard-script.md'), serializeStoryboardScriptMarkdown(project), { mode: 0o600 });
  const observation = await service.observeWorkspace(event, root);
  const run = () => service.ordinary(event, 'layers:' + producer, { folderPath: root }, [source, target], () => producer === 'writePng'
    ? writeLayerPng({ folderPath: root, bitmapPath, dataUrl: 'data:image/png;base64,' + blue.toString('base64') })
    : copyLayerPng({ folderPath: root, sourceBitmapPath, targetBitmapPath: bitmapPath })).catch(error => error);
  const failure = await run(); expect(failure.effect).toBe('refused');
  const history = { undo: [{ project, selectedShotIds: ['s'], fileNameSyncState: 'synced', layerAssets: [{ bitmapPath, dataUrl: 'data:image/png;base64,' + red.toString('base64') }] }], redo: [] };
  const capture = { ...observation, content: { projectRaw: project, sequence: 1, assetRevision: 1, desiredAssets: [{ folderPath: root, bitmapPath, shotId: 's', layerId: 'a', dataUrl: 'data:image/png;base64,' + blue.toString('base64') }], retainedAssetIntents: [], effectFacts: { unsettled: true, error: String(failure), receipt: [], deletions: [], remainingScript: null } }, canvas: { hasUnsettledGesture: false, captures: [] }, history, selectedShotIds: ['s'], dirtyShotIds: ['s'], fileNameSyncState: 'synced', workspaceSaveState: 'error' };
  return { root, target, source, bitmapPath, red, blue, metadata, project, capture, run };
}
const caller = () => { const frame = {}, sender = { mainFrame: frame }; return { sender, senderFrame: frame } as any; };

test('refused before-first-Save write and copy preserve both Roots, original failure, History and strict source policy without minting ACK', async () => {
  const event = caller(), service = createPreparedWorkspaceSave(options);
  const a = await fixture(service, event), b = await fixture(service, event, 'copyPng');
  await expect(service.certifyRetainedSet(event, { slots: [b.capture] })).rejects.toThrow('Hidden unfinished');
  expect(await service.certifyRetainedSet(event, { slots: [a.capture, b.capture] })).toBe(true);
  const cold = createPreparedWorkspaceSave(options);
  for (const f of [a, b]) {
    const retained = await cold.readReadonly(f.root);
    expect(retained.projectRaw).toEqual(f.project);
    expect((retained.viewState as any).history).toEqual(f.capture.history);
    expect((retained.effectFacts as any).main.operations).toEqual([expect.objectContaining({ state: 'failed', nativeRefusal: true, failure: expect.objectContaining({ effect: 'refused', retainedTemporary: null }) })]);
    expect(retained.continuationState).toMatchObject({ notExecutable: true, stage: 'failed' });
    expect(await fs.readFile(f.target)).toEqual(f.red);
    expect((await fs.stat(f.target)).mode & 0o777).toBe(0o400);
    const ns = JSON.parse(await fs.readFile(path.join(f.root, '.storyboard-workbench/workspace-recovery-v1/namespace.json'), 'utf8'));
    expect(ns.sourcePolicy.expected.mode).toBe(0o400);
    await expect(service.acknowledge(event, { folderPath: f.root, nonce: (retained.continuationState as any).nonce, project: f.project })).rejects.toThrow();
  }
}, 120000);

for (const change of ['bytes', 'identity', 'history', 'document', 'extra-effect'] as const) {
  test(`ordinary preservation rejects ${change} mismatch without creating a recovery namespace`, async () => {
    const event = caller(), service = createPreparedWorkspaceSave(options), f = await fixture(service, event);
    if (change === 'bytes') await fs.writeFile(f.source, f.red);
    if (change === 'identity') { await fs.rename(f.source, f.source + '.retained'); await fs.writeFile(f.source, f.blue, { mode: 0o600 }); }
    if (change === 'history') f.capture.history.undo[0].layerAssets[0].dataUrl = 'data:image/png;base64,' + f.blue.toString('base64');
    if (change === 'document') service.invalidateDocument(event.sender);
    if (change === 'extra-effect') await service.ordinary(event, 'layers:writePng', { folderPath: f.root }, [f.source], () => writeLayerPng({ folderPath: f.root, bitmapPath: '.storyboard-workbench/layers/s/b.png', dataUrl: 'data:image/png;base64,' + f.blue.toString('base64') }));
    await expect(service.certifyRetainedSet(event, { slots: [f.capture] })).rejects.toThrow();
    expect(await fs.readFile(f.target)).toEqual(f.red);
    await expect(fs.lstat(path.join(f.root, '.storyboard-workbench/workspace-recovery-v1'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120000);
}
