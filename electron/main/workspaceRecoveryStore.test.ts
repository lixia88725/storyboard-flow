import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4zyD3HwAFPAIdh7bqkQAAAABJRU5ErkJggg==', 'base64');

test('retains latest raw content and exact asset bytes without rewriting original workspace files', async () => {
  const root = await fs.mkdtemp(path.resolve('fixture-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  await fs.writeFile(path.join(root, 'original.bin'), Buffer.from('original version'));
  const authorize = async () => {}; // Synthetic test certificate only; not production permissions.
  const store = createWorkspaceRecoveryStore({ authorize, budget: { bytes: 100000, records: 100, assets: 10, jsonDepth: 20 } });
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  const offer = { revision: 'owner:2', projectRaw: { pendingBake: { unsupported: 'retain me' }, text: 'P2' }, viewState: { selected: 'shot-A', dirty: ['shot-A'] }, scriptState: { input: { state: 'absent' } }, effectFacts: [{ effect: 'unknown', dependenciesComplete: false }], continuationState: { remaining: ['persist'] }, assets: [{ assetId: 'pixels', bytes: png, role: 'desired', width: 1, height: 1, encoding: 'png' }], requiredAssetIds: ['pixels'] };
  const ack = await store.retain(caller, root, offer);
  expect(ack.revision).toBe('owner:2');
  const cold = await createWorkspaceRecoveryStore({ authorize, budget: { bytes: 100000, records: 100, assets: 10, jsonDepth: 20 } }).inspectReadonly(root);
  expect(cold.state).toBe('protectedReadable');
  expect(cold.content?.projectRaw).toEqual(offer.projectRaw);
  expect(await store.readAsset(root, ack.generationId, 'pixels')).toEqual(png);
  expect(await fs.readFile(path.join(root, 'original.bin'), 'utf8')).toBe('original version');
});

const previousPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNg0Pj/HwADegInV9T7/gAAAABJRU5ErkJggg==', 'base64');
const budget = { bytes: 100000, records: 100, assets: 10, jsonDepth: 20 };
const caller = { sender: {}, frame: {}, window: {}, document: {} };
const authorize = async () => {};
const offer = (revision = 'owner:1') => ({ revision, projectRaw: { text: revision }, viewState: { selected: 'A' }, scriptState: { input: { state: 'unobserved' } }, effectFacts: [{ effect: 'unknown' }], continuationState: { pending: true }, assets: [{ assetId: 'pixels', bytes: revision.endsWith(':2') ? png : previousPNG, role: 'desired', width: 1, height: 1, encoding: 'png' }], requiredAssetIds: ['pixels'] });
const fixture = async () => { const root = await fs.mkdtemp(path.resolve('fixture-')); await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 }); return root; };

test('an operation with no generation cannot disappear behind a valid old tip', async () => {
  const root = await fixture(); const store = createWorkspaceRecoveryStore({ authorize, budget });
  const ack = await store.retain(caller, root, offer());
  const base = path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations');
  const old = JSON.parse(await fs.readFile(path.join(base, ack.operationId, 'operation.json'), 'utf8'));
  await fs.mkdir(path.join(base, 'orphan'));
  await fs.mkdir(path.join(base, 'orphan/generations'));
  await fs.writeFile(path.join(base, 'orphan/operation.json'), JSON.stringify({ ...old, operationId: 'orphan' }));
  expect((await store.inspectReadonly(root)).state).not.toBe('protectedReadable');
});

for (const phase of ['created', 'written', 'closed', 'linked', 'sourceReleased', 'readback'] as const) {
  test(`partial new asset publication at ${phase} preserves old exact generation and original bytes`, async () => {
    const root = await fixture(); const store = createWorkspaceRecoveryStore({ authorize, budget });
    const old = await store.retain(caller, root, offer('owner:1'));
    const oldDir = path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', old.operationId, 'generations', old.generationId);
    const original = await fs.readFile(path.join(oldDir, 'assets/pixels.bin'));
    const failing = createWorkspaceRecoveryStore({ authorize, budget, fault: async (at, file) => { if (at === phase && file.includes('/assets/')) throw new Error(`fault-${phase}`); } });
    await expect(failing.retain(caller, root, offer('owner:2'))).rejects.toThrow(`fault-${phase}`);
    expect(await fs.readFile(path.join(oldDir, 'assets/pixels.bin'))).toEqual(original);
    const cold = await createWorkspaceRecoveryStore({ authorize, budget }).inspectReadonly(root);
    expect(cold.state).not.toBe('protectedReadable');
  });
}

test('permission refusal happens before any content byte write; no chmod/xattr fallback', async () => {
  const root = await fixture(); let created: string | undefined;
  const store = createWorkspaceRecoveryStore({ budget, authorize: async request => { if (request.phase === 'beforeBytes') { created = request.path; throw new Error('uncertified restriction'); } } });
  await expect(store.retain(caller, root, offer())).rejects.toThrow('uncertified restriction');
  expect((await fs.stat(created!)).size).toBe(0);
});

test('missing configuration and accumulated budget fail before a new namespace/effect', async () => {
  const root = await fixture();
  await expect(createWorkspaceRecoveryStore({}).retain(caller, root, offer())).rejects.toThrow('Recovery unavailable');
  await expect(createWorkspaceRecoveryStore({ authorize, budget: { ...budget, bytes: 20 } }).retain(caller, root, offer())).rejects.toThrow('budget');
  expect(await fs.readdir(path.join(root, '.storyboard-workbench'))).toEqual([]);
  const store = createWorkspaceRecoveryStore({ authorize, budget }); await store.retain(caller, root, offer());
  const base = path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations');
  const before = await fs.readdir(base);
  const small = createWorkspaceRecoveryStore({ authorize, budget: { ...budget, records: 10 } });
  await expect(small.retain(caller, root, offer('owner:2'))).rejects.toThrow('budget');
  expect(await fs.readdir(base)).toEqual(before);
});

test('hard record quota reserves the publication source alias before any namespace growth', async () => {
  const root = await fixture();
  const store = createWorkspaceRecoveryStore({ authorize, budget: { ...budget, records: 10 } });
  await expect(store.retain(caller, root, offer())).rejects.toThrow('budget');
  expect(await fs.readdir(path.join(root, '.storyboard-workbench'))).toEqual([]);
});

test('latest is unique content-parent chain, alias reads preserve physical binding and raw unknown facts', async () => {
  const root = await fixture(), store = createWorkspaceRecoveryStore({ authorize, budget });
  const first = await store.retain(caller, root, offer('owner:99'));
  const second = await store.retain(caller, root, offer('new-incarnation:1'));
  const alias = `${root}-alias`; await fs.symlink(root, alias);
  const cold = await store.inspectReadonly(alias);
  expect(cold.state).toBe('protectedReadable'); expect(cold.ack?.generationId).toBe(second.generationId);
  expect(cold.content?.parent?.generationId).toBe(first.generationId);
  expect(cold.content?.effectFacts).toEqual([{ effect: 'unknown' }]);
});

test('copied physical root, corrupt assets, source hardlink and unknown namespace stay failclosed', async () => {
  for (const change of ['copied', 'corrupt', 'hardlink', 'unknown'] as const) {
    const root = await fixture(), store = createWorkspaceRecoveryStore({ authorize, budget });
    const ack = await store.retain(caller, root, offer());
    const base = path.join(root, '.storyboard-workbench/workspace-recovery-v1');
    const asset = path.join(base, 'operations', ack.operationId, 'generations', ack.generationId, 'assets/pixels.bin');
    let target = root;
    if (change === 'copied') { target = `${root}-copy`; await fs.cp(root, target, { recursive: true }); }
    if (change === 'corrupt') await fs.writeFile(asset, Buffer.from('changed'));
    if (change === 'hardlink') await fs.link(asset, `${asset}.alias`);
    if (change === 'unknown') { const ns = JSON.parse(await fs.readFile(path.join(base, 'namespace.json'), 'utf8')); await fs.writeFile(path.join(base, 'namespace.json'), JSON.stringify({ ...ns, version: 999 })); }
    expect((await store.inspectReadonly(target)).state).not.toBe('protectedReadable');
  }
});

test('a new owned RAM generation can be certified while an old orphan stays protected and untouched', async () => {
  const root = await fixture(), store = createWorkspaceRecoveryStore({ authorize, budget });
  const first = await store.retain(caller, root, offer('owner:1'));
  const base = path.join(root, '.storyboard-workbench/workspace-recovery-v1');
  await fs.writeFile(path.join(base, 'orphan.json'), '{"unrecognized":"do not delete"}');
  const before = await fs.readFile(path.join(base, 'orphan.json'));
  const second = await store.retain(caller, root, offer('owner:2'));
  expect(second.revision).toBe('owner:2');
  const cold = await store.inspectReadonly(root);
  expect(cold.state).toBe('protectedIncomplete');
  expect(cold.content?.projectRaw).toEqual({ text: 'owner:2' });
  expect(cold.content?.parent?.generationId).toBe(first.generationId);
  expect(await store.readAsset(root, second.generationId, 'pixels')).toEqual(png);
  expect(await fs.readFile(path.join(base, 'orphan.json'))).toEqual(before);
});

test('a failed owned generation without its seal can be followed by a new captured RAM generation', async () => {
  const root = await fixture(), store = createWorkspaceRecoveryStore({ authorize, budget });
  await store.retain(caller, root, offer('owner:1'));
  const failing = createWorkspaceRecoveryStore({ authorize, budget, fault: async (phase, file) => { if (phase === 'written' && file.includes('/assets/')) throw new Error('partial owned generation'); } });
  await expect(failing.retain(caller, root, offer('owner:2'))).rejects.toThrow('partial owned generation');
  const next = await store.retain(caller, root, offer('owner:3'));
  expect(next.revision).toBe('owner:3');
  expect((await store.inspectReadonly(root)).state).toBe('protectedIncomplete');
  expect((await store.inspectReadonly(root)).content?.projectRaw).toEqual({ text: 'owner:3' });
});

test('live seal readback failure with identical actual disk still permits same cold readonly content, not retirement', async () => {
  const root = await fixture();
  const failing = createWorkspaceRecoveryStore({ authorize, budget, fault: async (phase, file) => { if (phase === 'readback' && file.endsWith('/sealed.json')) throw new Error('live ACK not delivered'); } });
  await expect(failing.retain(caller, root, offer())).rejects.toThrow('live ACK not delivered');
  const cold = await createWorkspaceRecoveryStore({ authorize, budget }).inspectReadonly(root);
  expect(cold.state).toBe('protectedReadable');
  expect(cold.content?.projectRaw).toEqual({ text: 'owner:1' });
  // This content-only slice never returns writable/completed; R1 effect retirement is not implemented.
});

test('nonexecuting asset reader rejects executable/opaque format and invalid raster before sidecar creation', async () => {
  for (const encoding of ['exe', 'png']) {
    const root = await fixture(), store = createWorkspaceRecoveryStore({ authorize, budget });
    const invalid = offer(); invalid.assets[0] = { ...invalid.assets[0], encoding, bytes: Buffer.from('MZnot-an-image') };
    await expect(store.retain(caller, root, invalid)).rejects.toThrow();
    expect(await fs.readdir(path.join(root, '.storyboard-workbench'))).toEqual([]);
  }
});
