import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { test, expect } from 'vitest';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate';

// Actual Main/preparation/certifier/native storage seam. The original Save
// callback models a settled exception with no user-file effects, not the TIFF
// encoder or actual Electron Close/editable cold lifecycle.
test('Main retains a newly contributing 0400 layer after completed 0600 history and certifies its failed Save Close capture', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepared-partitions-'));
  const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json');
  const bitmapPath = '.storyboard-workbench/layers/s/a.png';
  await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true, mode: 0o700 });
  const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.writeFile(path.join(root, bitmapPath), red, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), await sharp(red).tiff({ compression: 'none' }).toBuffer(), { mode: 0o600 });
  const project: any = { id: 'policy-p', name: 'policy', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: [{ id: 'a', kind: 'paint', bitmapPath, width: 2, height: 2 }] }], dialogues: [] };
  const persist = async () => {
    await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 });
    await fs.writeFile(path.join(root, 'storyboard-script.md'), serializeStoryboardScriptMarkdown(project), { mode: 0o600 });
    return {};
  };
  await persist();
  const frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame };
  const options = { budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 }, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') };
  const service = createPreparedWorkspaceSave(options), observation = await service.observeWorkspace(event, root);
  const content = { projectRaw: project, sequence: 1, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: { receipt: [], deletions: [], remainingScript: null, unsettled: false } };
  const payload = { folderPath: root, metadataPath: metadata, normalSave: true, project, recoveryContent: content };
  const prepared = await service.run(event, payload, async () => ({ project, normalSaveOutputs: [] }));
  await service.persist(event, { ...payload, recoverySaveNonce: prepared.recoverySaveNonce }, persist);
  await service.acknowledge(event, { folderPath: root, nonce: prepared.recoverySaveNonce, project });
  const oldNs = path.join(root, '.storyboard-workbench/workspace-recovery-v1/namespace.json');
  const before = await fs.readFile(oldNs), previousJSON = await fs.readFile(metadata);
  const strictPath = '.storyboard-workbench/layers/s/strict.png';
  await fs.writeFile(path.join(root, strictPath), blue, { mode: 0o400 });
  const changed = structuredClone(project);
  changed.shots[0].layers.push({ id: 'strict', kind: 'paint', bitmapPath: strictPath, width: 2, height: 2 });
  const nextContent = { ...content, projectRaw: changed, sequence: 2, assetRevision: 1 };
  let calls = 0;
  await expect(service.run(event, { ...payload, project: changed, recoveryContent: nextContent }, async () => {
    calls++;
    const retained = await service.readReadonly(root);
    expect(retained.projectRaw).toEqual(changed);
    expect(retained.assets.find(a => a.role === 'original/s/strict')?.sourceDataUrl).toBe('data:image/png;base64,' + blue.toString('base64'));
    throw new Error('settled synthetic Save failure');
  })).rejects.toThrow('settled synthetic Save failure');
  expect(calls).toBe(1);
  const capture = { ...observation, content: nextContent, canvas: { hasUnsettledGesture: false, captures: [] }, history: { undo: [], redo: [] }, selectedShotIds: ['s'], dirtyShotIds: ['s'], fileNameSyncState: 'synced', workspaceSaveState: 'error' };
  expect(await service.certifyRetainedSet(event, { slots: [capture] })).toBe(true);
  const cold = createPreparedWorkspaceSave(options), retained = await cold.readReadonly(root);
  expect(retained.projectRaw).toEqual(changed);
  expect((retained.viewState as any).history).toEqual(capture.history);
  expect(retained.continuationState).toMatchObject({ stage: 'failed', notExecutable: true });
  expect(JSON.stringify(retained.effectFacts)).toContain('settled synthetic Save failure');
  expect(await fs.readFile(oldNs)).toEqual(before);
  expect(await fs.readFile(metadata)).toEqual(previousJSON);
  expect((await fs.stat(path.join(root, strictPath))).mode & 0o777).toBe(0o400);
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
}, 120000);

// Partial-Save continuation is a distinct capability: a readable archive is not
// sufficient and the existing ordinary writer must remain protected throughout.
const partialContinuationFixture = async (approvedFailure: boolean) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partial-save-continuation-'));
  const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json');
  const bitmapPath = '.storyboard-workbench/layers/s/a.png';
  await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true, mode: 0o700 });
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
  await fs.writeFile(path.join(root, bitmapPath), png, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), await sharp(png).tiff().toBuffer(), { mode: 0o600 });
  const project: any = { id: 'partial-p', name: 'partial', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: [{ id: 'a', kind: 'paint', bitmapPath, width: 2, height: 2 }] }], dialogues: [] };
  await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 });
  await fs.writeFile(path.join(root, 'storyboard-script.md'), serializeStoryboardScriptMarkdown(project), { mode: 0o600 });
  const frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame };
  const options = { budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 }, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') };
  const service = createPreparedWorkspaceSave(options);
  const content = { projectRaw: project, sequence: 1, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: { receipt: [], deletions: [], remainingScript: null, unsettled: false } };
  const failure = { code: approvedFailure ? 'SAVE_RECOVERY_INCOMPLETE' : 'UNAPPROVED_FAILURE', publicationOrCleanup: 'started', metadata: 'unknown', recoveryIncomplete: true, message: 'synthetic partial metadata publication' };
  const originalObservation = await service.observeWorkspace(event, root);
  await expect(service.run(event, { folderPath: root, metadataPath: metadata, normalSave: true, project, recoveryContent: content }, async () => ({ ok: false, error: failure }))).resolves.toEqual({ ok: false, error: failure });
  const entry = { project, selectedShotIds: ['s'], fileNameSyncState: 'unsynced' };
  await service.certifyRetainedSet(event, { slots: [{ ...originalObservation, content, canvas: { hasUnsettledGesture: false, captures: [] }, history: { undo: [entry], redo: [entry] }, selectedShotIds: ['s'], dirtyShotIds: ['s'], fileNameSyncState: 'unsynced', workspaceSaveState: 'error' }] });
  const retained = await service.readReadonly(root);
  expect(retained.continuationState).toMatchObject({ stage: 'failed', notExecutable: true });
  const cold = createPreparedWorkspaceSave(options), observed = await cold.observeWorkspace(event, root);
  return { root, bitmapPath, png, event, cold, observed, retained };
};

test('readable unapproved failed capture cannot mint a partial-Save continuation capability', async () => {
  const { root, bitmapPath, event, cold, observed, retained } = await partialContinuationFixture(false);
  const before = await fs.readFile(path.join(root, bitmapPath));
  // An unapproved failure is not a partial Save. Merely
  // recognizing the error text must never expose the user-facing edit entry.
  await expect((cold as any).inspectPartialSaveContinuation(event, { binding: observed.binding })).resolves.toMatchObject({ eligible: false });
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
  expect(await fs.readFile(path.join(root, bitmapPath))).toEqual(before);
  expect(await cold.readReadonly(root)).toEqual(retained);
}, 120000);

test('partial Save continuation eligibility freshly authenticates exact failure inventory without retiring its Root', async () => {
  const { root, bitmapPath, event, cold, observed, retained } = await partialContinuationFixture(true);
  await expect((cold as any).inspectPartialSaveContinuation(event, { binding: observed.binding })).resolves.toMatchObject({ eligible: true, revision: retained.revision });
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
  expect(await cold.readReadonly(root)).toEqual(retained);
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.writeFile(path.join(root, bitmapPath), blue);
  await expect((cold as any).inspectPartialSaveContinuation(event, { binding: observed.binding })).resolves.toMatchObject({ eligible: false });
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
}, 120000);

test('explicit partial continuation writes only new generations and cannot acknowledge or overwrite the failed Save', async () => {
  const { root, bitmapPath, png, event, cold, observed, retained } = await partialContinuationFixture(true);
  const begin = await cold.beginPartialSaveContinuation(event, { binding: observed.binding });
  expect(begin.originalSaveAcknowledged).toBe(false);
  expect(begin.recovery).toEqual(retained);
  const project: any = structuredClone(retained.projectRaw);project.name = 'continued project';
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const payload = { session: begin.session, revision: begin.revision, projectRaw: project, viewState: retained.viewState, desiredAssets: [{ shotId: 's', layerId: 'a', dataUrl: 'data:image/png;base64,' + blue.toString('base64') }] };
  const result = await cold.persistPartialSaveContinuation(event, payload);
  expect(result.originalSaveAcknowledged).toBe(false);
  expect(result.revision).not.toBe(begin.revision);
  const continued = await cold.readReadonly(root);
  expect(continued.projectRaw).toEqual(project);
  expect(continued.effectFacts).toEqual(retained.effectFacts);
  expect(continued.viewState).toEqual(retained.viewState);
  expect(continued.continuationState).toMatchObject({ stage: 'continued-editing', notExecutable: true, failedBase: { nonce: (retained.continuationState as any).nonce, p1: (retained.continuationState as any).p1, acknowledged: false } });
  expect(continued.assets.find(a => a.role === 'continued/s/a')?.sourceDataUrl).toBe(payload.desiredAssets[0].dataUrl);
  expect(await fs.readFile(path.join(root, bitmapPath))).toEqual(png);
  await expect(cold.persistPartialSaveContinuation(event, payload)).rejects.toThrow('revision');
  const closeCapture = { slots: [], partialContinuation: { ...payload, revision: result.revision } };
  expect(await cold.certifyRetainedSet(event, closeCapture)).toBe(true);
  await expect(cold.certifyRetainedSet(event, { ...closeCapture, partialContinuation: { ...closeCapture.partialContinuation, projectRaw: { ...project, name: 'unpersisted edit' } } })).rejects.toThrow();
  await expect(cold.acknowledge(event, { folderPath: root, nonce: (retained.continuationState as any).nonce, project })).rejects.toThrow('stage');
  await expect(assertPhysicalWorkspaceWriterTargets([root])).rejects.toThrow('protected');
  cold.invalidateDocument(event.sender);
  await expect(cold.persistPartialSaveContinuation(event, { ...payload, revision: result.revision })).rejects.toThrow('incarnation');
}, 120000);
