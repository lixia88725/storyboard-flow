import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { createWorkspaceRecoveryPartitions } from './workspaceRecoveryPartitions';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4zyD3HwAFPAIdh7bqkQAAAABJRU5ErkJggg==', 'base64');
const budget = { bytes: 100000, records: 200, assets: 10, jsonDepth: 20 };
const caller = { sender: {}, frame: {}, window: {}, document: {} };
const policy = (mode: number) => ({ schema: 'swb.finite-source-policy', version: 1, expected: { uid: process.getuid!(), gid: process.getgid!(), mode, flags: 0, xattrs: {} }, observed: [['synthetic-policy-source', {}]] });
const offer = (revision: string) => ({ revision, projectRaw: { text: revision }, viewState: {}, scriptState: {}, effectFacts: [], continuationState: {}, assets: [{ assetId: 'pixels', bytes: png, role: 'desired', width: 1, height: 1, encoding: 'png' }], requiredAssetIds: ['pixels'] });

test('whole-chain verification reads every capture twice in one bounded batch, without caching native permissions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-verify-chain-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const calls: string[] = [];
  let refuse = false;
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), authorize: async request => {
    calls.push(`${request.phase}:${request.path}`);
    if (refuse) throw new Error('fresh native refusal');
  } });
  await store.retain(caller, root, offer('first'));
  const last = await store.retain(caller, root, offer('second'));
  calls.length = 0;
  expect((await store.inspectReadonly(root)).state).toBe('protectedReadable');
  const onePass = [...calls].sort();
  calls.length = 0;
  const result = await store.verifyCapturesReadonly(root);
  expect(result).toMatchObject({ state: 'protectedReadable', ack: last });
  expect(calls.sort()).toEqual([...onePass, ...onePass].sort());
  refuse = true;
  await expect(store.verifyCapturesReadonly(root)).rejects.toThrow();
});

// Real on-disk store topology/bytes. This synthetic permission port does NOT
// establish native metadata policy; the native adapter is checked separately.
test('batch asset readback sandwiches the whole chain twice, not another nested whole-chain reader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-batch-assets-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const calls: string[] = [];
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), authorize: async request => { calls.push(`${request.phase}:${request.path}`); } });
  await store.retain(caller, root, offer('first'));
  const last = await store.retain(caller, root, offer('second'));
  calls.length = 0;
  await store.inspectReadonly(root);
  const onePass = [...calls];
  calls.length = 0;
  expect(await store.readAssets(root, last.generationId)).toEqual(new Map([['pixels', png]]));
  const selected = `readback:${path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', last.operationId, 'generations', last.generationId, 'assets/pixels.bin')}`;
  expect(calls.sort()).toEqual([...onePass, ...onePass, selected].sort());
});

test.each(['historical bytes', 'unknown inventory', 'between-pass inventory'] as const)('batch certification still refuses %s', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-verify-refuse-'));
  const metadata = path.join(root, '.storyboard-workbench');
  await fs.mkdir(metadata, { mode: 0o700 });
  let armed = false, passes = 0;
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), authorize: async request => {
    if (armed && request.path === metadata && request.phase === 'directory' && ++passes === 2) {
      await fs.utimes(path.join(metadata, 'workspace-recovery-v1/namespace.json'), new Date(1000), new Date(1000));
    }
  } });
  const first = await store.retain(caller, root, offer('first'));
  await store.retain(caller, root, offer('second'));
  const base = path.join(metadata, 'workspace-recovery-v1');
  if (mode === 'historical bytes') await fs.writeFile(path.join(base, 'operations', first.operationId, 'generations', first.generationId, 'assets/pixels.bin'), Buffer.from('corrupt'));
  if (mode === 'unknown inventory') await fs.writeFile(path.join(base, 'unknown.json'), '{}');
  armed = mode === 'between-pass inventory';
  await expect(store.verifyCapturesReadonly(root)).rejects.toThrow();
});

test('historical readback uses the complete batch boundary and only the exact original reference', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-batch-historical-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const calls: string[] = [];
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), authorize: async request => { calls.push(`${request.phase}:${request.path}`); } });
  const first = await store.retain(caller, root, offer('first'));
  await store.retain(caller, root, offer('second'));
  const captures = await store.inspectCapturesReadonly(root);
  const original = captures.find(c => c.ack.generationId === first.generationId)!;
  calls.length = 0;
  await store.inspectReadonly(root);
  const onePass = [...calls];
  calls.length = 0;
  const retained = await store.readCapture(root, original.reference);
  expect(retained.content.projectRaw).toEqual({ text: 'first' });
  expect(retained.assets).toEqual(new Map([['pixels', png]]));
  const selected = `readback:${path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', first.operationId, 'generations', first.generationId, 'assets/pixels.bin')}`;
  expect(calls.sort()).toEqual([...onePass, ...onePass, selected].sort());
  await expect(store.readCapture(root, { ...original.reference, sealDigest: '0'.repeat(64) })).rejects.toThrow();
});

test('Main source certification runs inside the same two-pass whole-chain boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-source-boundary-'));
  const metadata = path.join(root, '.storyboard-workbench');
  await fs.mkdir(metadata, { mode: 0o700 });
  const calls: string[] = [];
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), authorize: async request => { calls.push(`${request.phase}:${request.path}`); } });
  const first = await store.retain(caller, root, offer('first'));
  const last = await store.retain(caller, root, offer('second'));
  const original = (await store.inspectCapturesReadonly(root)).find(c => c.ack.generationId === first.generationId)!;
  calls.length = 0;
  await store.inspectReadonly(root);
  const onePass = [...calls];
  calls.length = 0;
  let checked = 0;
  const result = await store.verifyCapturesReadonly(root, async verified => {
    checked++;
    expect(calls).toEqual(onePass);
    expect(verified.state.ack).toEqual(last);
    expect(verified.captures.find(c => c.reference.sealDigest === first.sealDigest)).toMatchObject({ reference: original.reference, content: { projectRaw: { text: 'first' } } });
  });
  expect(checked).toBe(1);
  expect(result.ack).toEqual(last);
  expect(calls.sort()).toEqual([...onePass, ...onePass].sort());
  await expect(store.verifyCapturesReadonly(root, async () => { throw new Error('source unknown'); })).rejects.toThrow('source unknown');
  await expect(store.verifyCapturesReadonly(root, async () => {
    await fs.utimes(path.join(metadata, 'workspace-recovery-v1/namespace.json'), new Date(1000), new Date(1000));
  })).rejects.toThrow('history changed');
});

test('Main source and selected bytes share one revocable two-pass certification boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-source-assets-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const calls: string[] = [];
  let refuse = false;
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), authorize: async request => {
    calls.push(`${request.phase}:${request.path}`);
    if (refuse) throw new Error('fresh selected refusal');
  } });
  const first = await store.retain(caller, root, offer('first'));
  const last = await store.retain(caller, root, offer('second'));
  calls.length = 0;
  await store.inspectReadonly(root);
  const onePass = [...calls];
  calls.length = 0;
  let escaped: (() => Promise<Map<string, Buffer>>) | undefined;
  await store.verifyCapturesReadonly(root, async verified => {
    const selected = verified.captures.find(c => c.ack.generationId === first.generationId)!;
    expect(verified.state.ack).toEqual(last);
    expect(await verified.readAssets(selected.reference)).toEqual(new Map([['pixels', png]]));
    await expect(verified.readAssets({ ...selected.reference, sealDigest: '0'.repeat(64) })).rejects.toThrow();
    escaped = () => verified.readAssets(selected.reference);
  });
  const selected = `readback:${path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', first.operationId, 'generations', first.generationId, 'assets/pixels.bin')}`;
  expect(calls.sort()).toEqual([...onePass, ...onePass, selected].sort());
  await expect(escaped!()).rejects.toThrow('closed');
  await expect(store.verifyCapturesReadonly(root, async verified => {
    refuse = true;
    await verified.readAssets(verified.captures[0].reference);
  })).rejects.toThrow('fresh selected refusal');
});

test('a stricter complete capture appends after unchanged v1 and a fresh reader finds that global tip', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-chain-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const old = createWorkspaceRecoveryStore({ budget, sourcePolicy: policy(0o600), authorize: async () => {} });
  const first = await old.retain(caller, root, offer('old'));
  const base = path.join(root, '.storyboard-workbench/workspace-recovery-v1');
  const paths = ['namespace.json', `operations/${first.operationId}/operation.json`, `operations/${first.operationId}/generations/${first.generationId}/content.json`, `operations/${first.operationId}/generations/${first.generationId}/sealed.json`, `operations/${first.operationId}/generations/${first.generationId}/assets/pixels.bin`];
  const before = await Promise.all(paths.map(file => fs.readFile(path.join(base, file))));
  const store = createWorkspaceRecoveryPartitions({ sourcePolicy: policy(0o400), budget, authorize: async () => {} });
  const second = await store.retain(caller, root, offer('stricter'));
  expect(second.generationId).not.toBe(first.generationId);
  const cold = await createWorkspaceRecoveryPartitions({ sourcePolicy: policy(0o400), budget, authorize: async () => {} }).inspectReadonly(root);
  expect(cold.state).toBe('protectedReadable');
  expect(cold.content?.projectRaw).toEqual({ text: 'stricter' });
  expect(await store.readAsset(root, second.generationId, 'pixels')).toEqual(png);
  for (let i = 0; i < paths.length; i++) expect(await fs.readFile(path.join(base, paths[i]))).toEqual(before[i]);
});

test('old captures consume the same workspace quota before any stricter partition is created', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-budget-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const old = createWorkspaceRecoveryStore({ budget, sourcePolicy: policy(0o600), authorize: async () => {} });
  await old.retain(caller, root, { ...offer('old'), projectRaw: { text: 'x'.repeat(12000) } });
  const count = async (dir: string): Promise<number> => {
    let bytes = 0;
    for (const name of await fs.readdir(dir)) {
      const file = path.join(dir, name), stat = await fs.lstat(file);
      bytes += stat.isDirectory() ? await count(file) : stat.size;
    }
    return bytes;
  };
  const oldBytes = await count(path.join(root, '.storyboard-workbench/workspace-recovery-v1'));
  const store = createWorkspaceRecoveryPartitions({ sourcePolicy: policy(0o400), budget: { ...budget, bytes: oldBytes + 32 }, authorize: async () => {} });
  await expect(store.retain(caller, root, offer('new'))).rejects.toThrow(/budget/i);
  expect(await count(path.join(root, '.storyboard-workbench/workspace-recovery-v1'))).toBe(oldBytes);
  await expect(fs.lstat(path.join(root, '.storyboard-workbench/workspace-recovery-v2'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['new sources', 'new facade', 'new caller', 'same facade changed observations', 'sender', 'frame', 'window', 'metadata replacement', 'Root replacement'] as const)('namespace-absent residue cannot authenticate original preparation from %s', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-no-namespace-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const original = policy(0o600);
  let refuse = true, bytesStarted = 0;
  const authorize = async (request: { path: string; phase: string }) => {
    if (request.phase === 'beforeBytes') {
      bytesStarted++;
      if (refuse && request.path.includes('/namespace.json.staging-')) throw new Error('namespace unpublished');
    }
  };
  const first = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: original, allowUnsealedStart: true, authorize });
  await expect(first.retain(caller, root, offer('original'))).rejects.toThrow('namespace unpublished');
  await expect(fs.lstat(path.join(root, '.storyboard-workbench/workspace-recovery-v1/namespace.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  refuse = false; bytesStarted = 0;
  if (mode === 'same facade changed observations') original.observed.push(['changed-in-place', {}]);
  if (mode === 'metadata replacement') {
    await fs.rename(path.join(root, '.storyboard-workbench'), path.join(root, 'original-metadata'));
    await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  }
  if (mode === 'Root replacement') {
    await fs.rename(root, root + '-original');
    await fs.mkdir(path.join(root, '.storyboard-workbench'), { recursive: true, mode: 0o700 });
  }
  const sourcePolicy = mode === 'new sources' ? { ...original, observed: [...original.observed, ['different-same-mode-source', {}]] } : original;
  const next = mode === 'new sources' || mode === 'new facade' ? createWorkspaceRecoveryPartitions({ budget, sourcePolicy, allowUnsealedStart: true, authorize }) : first;
  const nextCaller = mode === 'new caller' ? { ...caller, document: {} } : ['sender', 'frame', 'window'].includes(mode) ? { ...caller, [mode]: {} } : caller;
  await expect(next.retain(nextCaller, root, offer('not-original'))).rejects.toThrow();
  expect(bytesStarted).toBe(0);
  await expect(fs.lstat(path.join(root, '.storyboard-workbench/workspace-recovery-v1/namespace.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('the original live preparation can retain content after its own namespace publication failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-original-namespace-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  let refuse = true;
  const store = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: policy(0o600), allowUnsealedStart: true,
    authorize: async request => { if (refuse && request.phase === 'beforeBytes' && request.path.includes('/namespace.json.staging-')) throw new Error('namespace unpublished'); } });
  await expect(store.retain(caller, root, offer('original'))).rejects.toThrow('namespace unpublished');
  refuse = false;
  const ack = await store.retain(caller, root, offer('latest'));
  expect(await store.inspectReadonly(root)).toMatchObject({ state: 'protectedIncomplete', ack, content: { projectRaw: { text: 'latest' } } });
  const cold = createWorkspaceRecoveryPartitions({ budget, authorize: async () => {} });
  expect(await cold.inspectReadonly(root)).toMatchObject({ state: 'protectedIncomplete', content: { projectRaw: { text: 'latest' } } });
});

test('unsealed v1 continuation cannot discard a new same-mode contributor certificate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-partial-contributors-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const original = policy(0o600);
  const first = createWorkspaceRecoveryStore({ budget, sourcePolicy: original, authorize: async request => {
    if (request.phase === 'beforeBytes' && request.path.includes('/sealed.json.staging-')) throw new Error('synthetic seal refusal');
  } });
  await expect(first.retain(caller, root, offer('partial'))).rejects.toThrow('synthetic seal refusal');
  expect(await first.inspectReadonly(root)).toMatchObject({ state: 'protectedIncomplete' });
  expect((await first.inspectReadonly(root)).ack).toBeUndefined();
  const namespace = path.join(root, '.storyboard-workbench/workspace-recovery-v1/namespace.json');
  const unchanged = await fs.readFile(namespace);
  const added = { ...original, observed: [...original.observed, ['new-same-mode-source', {}]] };
  let bytesStarted = 0;
  const next = createWorkspaceRecoveryPartitions({ budget, sourcePolicy: added, allowUnsealedStart: true,
    authorize: async request => { if (request.phase === 'beforeBytes') bytesStarted++; } });
  await expect(next.retain(caller, root, offer('new-source'))).rejects.toThrow('Whole-workspace retention refused');
  expect(bytesStarted).toBe(0);
  expect(await fs.readFile(namespace)).toEqual(unchanged);
  await expect(fs.lstat(path.join(root, '.storyboard-workbench/workspace-recovery-v2'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a later broad source cannot widen retained strict content or its predecessor references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-no-widen-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  await createWorkspaceRecoveryPartitions({ sourcePolicy: policy(0o400), budget, authorize: async () => {} }).retain(caller, root, offer('strict'));
  const sourceModes: number[] = [];
  const broader = createWorkspaceRecoveryPartitions({ sourcePolicy: policy(0o600), budget, authorize: async request => {
    if (request.phase === 'beforeBytes') sourceModes.push((request.sourcePolicy as any).expected.mode);
  } });
  const ack = await broader.retain(caller, root, offer('later'));
  expect(sourceModes.length).toBeGreaterThan(0);
  expect(new Set(sourceModes)).toEqual(new Set([0o400]));
  expect((await broader.inspectReadonly(root)).ack?.generationId).toBe(ack.generationId);
});

for (const corruption of ['global-extra-field', 'global-empty-string', 'global-seal', 'unknown-partition']) test(`cold whole-workspace certification rejects ${corruption} rather than choosing a partition winner`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-corrupt-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  await createWorkspaceRecoveryStore({ budget, sourcePolicy: policy(0o600), authorize: async () => {} }).retain(caller, root, offer('old'));
  const store = createWorkspaceRecoveryPartitions({ sourcePolicy: policy(0o400), budget, authorize: async () => {} });
  const ack = await store.retain(caller, root, offer('strict'));
  const policies = path.join(root, '.storyboard-workbench/workspace-recovery-v2/policies'), names = await fs.readdir(policies);
  const generation = path.join(policies, names[0], 'operations', ack.operationId, 'generations', ack.generationId);
  if (corruption === 'unknown-partition') await fs.mkdir(path.join(policies, 'unrecognized'), { mode: 0o700 });
  else {
    const file = path.join(generation, 'content.json'), value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (corruption === 'global-extra-field') value.globalPrevious.extra = 'not-approved';
    if (corruption === 'global-empty-string') value.globalPrevious = '';
    if (corruption === 'global-seal') value.globalPrevious.sealDigest = '0'.repeat(64);
    const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(file, bytes);
    const seal = path.join(generation, 'sealed.json'), record = JSON.parse(await fs.readFile(seal, 'utf8'));
    record.contentDigest = createHash('sha256').update(bytes).digest('hex'); await fs.writeFile(seal, JSON.stringify(record));
  }
  expect((await store.inspectReadonly(root)).state).toBe('protectedUninspectable');
  await expect(store.readAssets(root, ack.generationId)).rejects.toThrow('whole-workspace');
  expect(await fs.readFile(path.join(generation, 'assets/pixels.bin'))).toEqual(png);
});

test('a malformed oversized namespace is rejected by the metadata bootstrap limit, not loaded under the 8GiB disk quota', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partition-bootstrap-budget-'));
  const metadata = path.join(root, '.storyboard-workbench'), base = path.join(metadata, 'workspace-recovery-v1');
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const r = await fs.lstat(root), m = await fs.lstat(metadata);
  const ns = { schema: 'swb.workspace-recovery-namespace', version: 1, binding: { root, rootIdentity: { dev: r.dev, ino: r.ino }, metadataIdentity: { dev: m.dev, ino: m.ino } }, sourcePolicy: policy(0o600), padding: 'x'.repeat(16 * 1024 * 1024) };
  await fs.writeFile(path.join(base, 'namespace.json'), JSON.stringify(ns));
  const store = createWorkspaceRecoveryPartitions({ budget: { ...budget, bytes: 8 * 1024 * 1024 * 1024 }, authorize: async () => {} });
  const state = await store.inspectReadonly(root);
  expect(state.state).toBe('protectedUninspectable');
  expect(state.issue).toContain('descriptor identity/budget');
});
