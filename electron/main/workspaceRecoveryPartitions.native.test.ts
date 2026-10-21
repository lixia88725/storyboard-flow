import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { createWorkspaceRecoveryPartitions } from './workspaceRecoveryPartitions';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4zyD3HwAFPAIdh7bqkQAAAABJRU5ErkJggg==', 'base64');
const budget = { bytes: 1048576, records: 2000, assets: 32, jsonDepth: 80 };
const caller = { sender: {}, frame: {}, window: {}, document: {} };
const offer = (revision: string) => ({ revision, projectRaw: {}, viewState: {}, scriptState: { original: { metadataBytes: Buffer.from('{}').toString('base64'), scriptBytes: null } }, effectFacts: [], continuationState: {}, assets: [{ assetId: 'pixels', bytes: png, role: 'desired', width: 1, height: 1, encoding: 'png' }], requiredAssetIds: ['pixels'] });

test('same-mode new contributors retain their own native certificate across a fresh reader without rewriting v1', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-same-mode-contributors-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const a = path.join(root, 'a.png'), b = path.join(root, 'b.png');
  await fs.writeFile(a, png, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(b, png, { flag: 'wx', mode: 0o600 });
  const native = () => createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-content-permissions.py'), () => budget.bytes);
  const session = native();
  await session.run(async () => {
    const original = (await session.request({ phase: 'capturePolicy', sources: [a], sourceByteLimit: budget.bytes })).sourcePolicy;
    await createWorkspaceRecoveryStore({ budget, sourcePolicy: original, authorize: async request => { await session.request({ ...request, sourcePolicy: original, sourceByteLimit: budget.bytes }); } }).retain(caller, root, offer('old'));
  });
  const ns = path.join(root, '.storyboard-workbench/workspace-recovery-v1/namespace.json');
  const oldBytes = await fs.readFile(ns), oldStat = await fs.lstat(ns);
  const next = native();
  const contributors = await next.run(async () => {
    const sourcePolicy = (await next.request({ phase: 'capturePolicy', sources: [a, b], sourceByteLimit: budget.bytes })).sourcePolicy;
    await createWorkspaceRecoveryPartitions({ budget, sourcePolicy, authorize: async request => { await next.request({ ...request, sourceByteLimit: budget.bytes }); } }).retain(caller, root, offer('same-mode-new-source'));
    return sourcePolicy;
  });
  const cold = native();
  await cold.run(async () => {
    const state = await createWorkspaceRecoveryPartitions({ budget, authorize: async request => { await cold.request({ ...request, sourceByteLimit: budget.bytes }); } }).inspectReadonly(root);
    expect(state.state).toBe('protectedReadable');
    expect(state.content).toMatchObject({ version: 2, sourcePolicy: { expected: { mode: 0o600 }, observed: expect.arrayContaining(contributors.observed) } });
    expect(state.ack?.revision).toBe('same-mode-new-source');
  });
  expect(await fs.readFile(ns)).toEqual(oldBytes);
  const untouched = await fs.lstat(ns);
  expect([untouched.ino, untouched.mode, untouched.uid, untouched.gid, untouched.ctimeMs]).toEqual([oldStat.ino, oldStat.mode, oldStat.uid, oldStat.gid, oldStat.ctimeMs]);
}, 120000);

test('native validates v1 at 0600 and stricter v2 at 0400 in the same operation and fresh reader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-partitions-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const a = path.join(root, 'a.png'), b = path.join(root, 'b.png');
  await fs.writeFile(a, png, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(b, png, { flag: 'wx', mode: 0o400 });
  const native = () => createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-content-permissions.py'), () => budget.bytes);
  const session = native();
  const strict = await session.run(async () => {
    const wide = (await session.request({ phase: 'capturePolicy', sources: [a], sourceByteLimit: budget.bytes })).sourcePolicy;
    const strict = (await session.request({ phase: 'capturePolicy', sources: [a, b], sourceByteLimit: budget.bytes })).sourcePolicy;
    const old = createWorkspaceRecoveryStore({ budget, sourcePolicy: wide, authorize: async request => { await session.request({ ...request, sourcePolicy: wide, sourceByteLimit: budget.bytes }); } });
    const first = await old.retain(caller, root, offer('old'));
    const oldNs = path.join(root, '.storyboard-workbench/workspace-recovery-v1/namespace.json');
    const before = await fs.readFile(oldNs), originalStat = await fs.lstat(oldNs);
    const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: strict, authorize: async request => { await session.request({ ...request, sourceByteLimit: budget.bytes }); } });
    const ack = await store.retain(caller, root, offer('strict'));
    const state = await store.inspectReadonly(root);
    expect(state.ack?.generationId).toBe(ack.generationId);
    expect(state.ack?.generationId).not.toBe(first.generationId);
    expect(await store.readAsset(root, ack.generationId, 'pixels')).toEqual(png);
    expect(await fs.readFile(oldNs)).toEqual(before);
    const unchanged = await fs.lstat(oldNs);
    expect([unchanged.ino, unchanged.mode, unchanged.uid, unchanged.gid, unchanged.ctimeMs]).toEqual([originalStat.ino, originalStat.mode, originalStat.uid, originalStat.gid, originalStat.ctimeMs]);
    const partitions = path.join(root, '.storyboard-workbench/workspace-recovery-v2/policies');
    const names = await fs.readdir(partitions);
    expect(names).toHaveLength(1);
    const newNs = await fs.lstat(path.join(partitions, names[0], 'namespace.json'));
    expect(newNs.mode & 0o777).toBe(0o400);
    expect(newNs.uid).toBe(process.getuid!());
    return strict;
  });
  const cold = native();
  await cold.run(async () => {
    const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: strict, authorize: async request => { await cold.request({ ...request, sourceByteLimit: budget.bytes }); } });
    const state = await store.inspectReadonly(root);
    expect(state.state).toBe('protectedReadable');
    expect(state.ack?.revision).toBe('strict');
    expect(await store.readAsset(root, state.ack!.generationId, 'pixels')).toEqual(png);
    const forged = structuredClone(strict); forged.observed[0][1].links = 2;
    const names = await fs.readdir(path.join(root, '.storyboard-workbench/workspace-recovery-v2/policies'));
    const content = path.join(root, '.storyboard-workbench/workspace-recovery-v2/policies', names[0], 'operations', state.ack!.operationId, 'generations', state.ack!.generationId, 'content.json');
    await expect(cold.request({ path: content, root, phase: 'readback', sources: [], sourcePolicy: forged, sourceByteLimit: budget.bytes })).rejects.toThrow(/source|certified/);
  });
  const main = createPreparedWorkspaceSave({ budget, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') });
  expect((await main.readReadonly(root)).revision).toBe('strict');
}, 120000);
