import {test, expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';

// Real service/native store; synthetic Save callback models a successful rename
// and persistence followed by missing Owner ACK. This is not GUI coverage.
test('post-persist pre-ACK Close retains the actual renamed Project without granting Save success or writer rights', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'persisted-close-'));
  const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json');
  const png = path.join(root, '.storyboard-workbench/layers/s/l.png');
  const before = path.join(root, 'new-shot.tiff'), after = path.join(root, 'named-shot.tiff');
  await fs.mkdir(path.dirname(png), {recursive: true, mode: 0o700});
  const bytes = await sharp({create: {width: 2, height: 2, channels: 4, background: 'blue'}}).png().toBuffer();
  const tiff = await sharp(bytes).tiff().toBuffer();
  await fs.writeFile(png, bytes, {mode: 0o600});
  await fs.writeFile(before, tiff, {mode: 0o600});
  const original = {id: 'p', name: 'p', shots: [{id: 's', order: 0, imagePath: before, fileName: 'new-shot.tiff', swb: {status: 'owned', canvasWidth: 2, canvasHeight: 2}, layers: [{id: 'l', kind: 'image', width: 2, height: 2, bitmapPath: path.relative(root, png)}]}], dialogues: []};
  await fs.writeFile(metadata, JSON.stringify(original), {mode: 0o600});
  const project = {...original, shots: [{...original.shots[0], imagePath: after, fileName: 'named-shot.tiff'}]};
  const content = (p: unknown) => ({projectRaw: p, sequence: 2, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: {receipt: [], deletions: [], remainingScript: null, unsettled: false}});
  const frame = {}, event: any = {sender: {mainFrame: frame}, senderFrame: frame};
  const options = {budget: {bytes: 1048576, records: 1000, assets: 32, jsonDepth: 80}, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py')};
  const service = createPreparedWorkspaceSave(options);
  const payload = {folderPath: root, metadataPath: metadata, normalSave: true, project, recoveryContent: content(original), renamePlan: [{shotId: 's', fromPath: before, temporaryPath: path.join(root, '.storyboard-renaming-s.tiff'), finalPath: after, finalFileName: 'named-shot.tiff'}]};
  const result = await service.run(event, payload, async () => {await fs.rename(before, after); return {project, normalSaveOutputs: []};});
  await service.persist(event, {...payload, recoverySaveNonce: result.recoverySaveNonce}, async () => {
    await fs.writeFile(metadata, `${JSON.stringify(project, null, 2)}\n`);
    await fs.writeFile(path.join(root, 'storyboard-script.md'), serializeStoryboardScriptMarkdown(project as any), {mode: 0o600});
    return {};
  });
  const capture = {folderPath: root, content: {...content(project), effectFacts: {...content(project).effectFacts, unsettled: true, error: {message: 'ACK not received'}}}, canvas: {hasUnsettledGesture: false, captures: []}, history: {undo: [], redo: []}, selectedShotIds: ['s'], dirtyShotIds: ['s'], fileNameSyncState: 'unsynced', workspaceSaveState: 'error'};
  await expect(service.certifyRetained(event, capture)).resolves.toBe(true);
  const cold: any = await createPreparedWorkspaceSave(options).readReadonly(root);
  expect(cold.projectRaw).toEqual(project);
  expect(cold.effectFacts.owner.error.message).toBe('ACK not received');
  expect(cold.continuationState.stage).toBe('persisted');
  expect(cold.continuationState.notExecutable).toBe(true);
  expect(cold.effectFacts.state).not.toBe('completed-binding-persist-ack');
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
  expect(await fs.readFile(after)).toEqual(tiff);
  expect(await fs.readFile(png)).toEqual(bytes);
  await expect(service.certifyRetained(event, {...capture, content: content(original)})).rejects.toThrow();
  await expect(service.certifyRetained({...event, senderFrame: {}}, capture)).rejects.toThrow();
}, 30000);
