import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { test, expect } from 'vitest';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { prepareImportStaging } from './importPreparation';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate';

// Real Main service, native permission adapter and OS EEXIST. Not Electron UI,
// TIFF conversion or process cold start; those require the separate runtime chain.
test.each([false, true])('new original-Main Import failure preserves exact candidate, cold continuation references retained source bytes only (new collision=%s)', async newCollision => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-continuation-'));
  const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json');
  const bitmapPath = '.storyboard-workbench/layers/s/a.png';
  await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true, mode: 0o700 });
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
  await fs.writeFile(path.join(root, bitmapPath), png, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), await sharp(png).tiff().toBuffer(), { mode: 0o600 });
  const project: any = { id: 'import-p', name: 'import', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: [{ id: 'a', kind: 'paint', bitmapPath, width: 2, height: 2 }] }], dialogues: [] };
  await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 });
  await fs.writeFile(path.join(root, 'storyboard-script.md'), serializeStoryboardScriptMarkdown(project), { mode: 0o600 });
  const incoming = path.join(root, 'incoming.png');
  await fs.writeFile(incoming, png, { mode: 0o600 });
  const candidate = path.join(root, '.storyboard-workbench/import-tmp/collision');
  await fs.mkdir(newCollision ? path.dirname(candidate) : candidate, { recursive: true, mode: 0o700 });
  const original = await Promise.all([metadata, incoming, path.join(root, 's.tiff'), path.join(root, bitmapPath)].map(f => fs.readFile(f)));
  const input: any = { ...project, shots: [...project.shots, { id: 'incoming', imagePath: incoming, fileName: 'incoming.png', sourceFileName: undefined, swb: { status: 'non-swb' }, layers: [{ id: 'layer-image', kind: 'image', bitmapPath: '.storyboard-workbench/layers/incoming/layer-image.png', width: 2, height: 2 }] }] };
  const options = { budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 }, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') };
  const frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame };
  const service = createPreparedWorkspaceSave(options), observed = await service.observeWorkspace(event, root);
  const payload = { folderPath: root, metadataPath: metadata, normalSave: true, normalSaveImageImport: true, project: input };

  const content = { projectRaw: input, sequence: 1, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: { unsettled: true, receipt: [], deletions: [], remainingScript: null } };
  const entry = { project, selectedShotIds: ['s'], fileNameSyncState: 'unsynced' };
  const capture = { ...observed, content, canvas: { hasUnsettledGesture: false, captures: [{ folderPath: root, shotId: 'incoming', liveLayers: [{ layerId: 'layer-image', dataUrl: 'data:image/png;base64,' + png.toString('base64') }] }] }, history: { undo: [entry], redo: [entry] }, selectedShotIds: ['s'], dirtyShotIds: [], fileNameSyncState: 'unsynced', workspaceSaveState: 'error' };
  // Existing stage and an unobserved failure are NOT a new Main registration.
  if(!newCollision)await expect(prepareImportStaging(candidate, async () => undefined)).rejects.toMatchObject({ code: 'EEXIST' });
  await expect(service.certifyRetainedSet(event, { slots: [capture] })).rejects.toThrow();
  await expect(service.ordinary(event, 'workspace:importSwbFormat', payload, [root, metadata], async () => {
    if(newCollision)await fs.mkdir(candidate, { mode: 0o700 });
    return prepareImportStaging(candidate, async () => { throw Error('must not start'); });
  })).rejects.toMatchObject({ code: 'EEXIST' });
  const missing = structuredClone(capture);
  missing.history.undo[0].project.shots[0].layers[0].bitmapPath = '.storyboard-workbench/layers/s/missing.png';
  await expect(service.certifyRetainedSet(event, { slots: [missing] })).rejects.toThrow();
  const unknownPixels: any = structuredClone(capture);
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  unknownPixels.history.undo[0].layerAssets = [{ bitmapPath, dataUrl: 'data:image/png;base64,' + blue.toString('base64') }];
  await expect(service.certifyRetainedSet(event, { slots: [unknownPixels] })).rejects.toThrow();
  expect(await service.certifyRetainedSet(event, { slots: [capture] })).toBe(true);
  const cold = createPreparedWorkspaceSave(options), coldObservation = await cold.observeWorkspace(event, root);
  const retained = await cold.readReadonly(root);
  expect(retained.projectRaw).toEqual(input);
  expect(retained.effectFacts).toMatchObject({ main: { schema: 'swb.image-import-failure.v1', acknowledged: false, preparation: { candidatePath: candidate, code: 'EEXIST', preparationStarted: false } } });
  expect(retained.assets.some(a => a.role === 'import-source/incoming.png')).toBe(true);
  expect(await cold.inspectPartialSaveContinuation(event, { binding: coldObservation.binding })).toMatchObject({ eligible: true });
  const begin = await cold.beginPartialSaveContinuation(event, { binding: coldObservation.binding });
  const edited: any = structuredClone(input); edited.shots[0].scriptText = 'new notes after Import failure';
  const result = await cold.persistPartialSaveContinuation(event, { session: begin.session, revision: begin.revision, projectRaw: edited, viewState: retained.viewState, desiredAssets: [] });
  expect(result.originalSaveAcknowledged).toBe(false);
  const continued = await cold.readReadonly(root);
  expect(continued.projectRaw).toEqual(edited);
  expect(continued.effectFacts).toEqual(retained.effectFacts);
  expect(continued.assets).toEqual(retained.assets);
  expect(continued.continuationState).toMatchObject({ stage: 'continued-editing', failedBase: { acknowledged: false } });
  const generations = await fs.readdir(path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations'), { recursive: true });
  const newContents: any[] = [];
  for (const file of generations.filter(f => f.endsWith('/content.json'))) newContents.push(JSON.parse(await fs.readFile(path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', file), 'utf8')));
  const tip = newContents.find(c => c.revision === result.revision);
  expect(tip.assets).toEqual([]); // no source recopied into the new generation
  expect(tip.scriptState.importSourceReference).toBeDefined();
  expect(await Promise.all([metadata, incoming, path.join(root, 's.tiff'), path.join(root, bitmapPath)].map(f => fs.readFile(f)))).toEqual(original);
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
  await expect(cold.acknowledge(event, { folderPath: root, nonce: (retained.continuationState as any).nonce, project: edited })).rejects.toThrow();
  await fs.writeFile(incoming, Buffer.from('changed'));
  expect(await cold.inspectPartialSaveContinuation(event, { binding: coldObservation.binding })).toMatchObject({ eligible: false });
}, 120000);
