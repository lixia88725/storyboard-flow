import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting';
import sharp from 'sharp';
import { fixtureAttributeBytes } from './nativeAttributeMeter.fixture';

test('real native origin residues participate in store quota before any project capture effect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-joint-project-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-joint-appdata-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const r = await fs.lstat(root, { bigint: true }), m = await fs.lstat(path.join(root, '.storyboard-workbench'), { bigint: true });
  // Independent literal record layout for the v1 workspace address; exact IDs
  // include birth time so inode reuse is not treated as an original incarnation.
  const key = createHash('sha256').update(JSON.stringify(['swb.workspace-origin-address.v1', root, String(r.dev), String(r.ino), String(r.birthtimeNs), String(m.dev), String(m.ino), String(m.birthtimeNs)])).digest('hex');
  const folder = path.join(userData, 'workspace-origin-v1', key);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, 'unfinished-origin'), Buffer.alloc(4096, 1), { mode: 0o600 });
  const budget = { bytes: 4096, records: 100, assets: 8, jsonDepth: 80 };
  const native = createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  let reads = 0;
  const scan = createOriginWorkspaceAccounting({ userData: () => { reads++; return userData; }, python: 'python3', script: path.resolve('scripts/recovery-origin-permissions.py') });
  expect(reads).toBe(0);
  // Content permission is deliberately a no-op port in this quota-only store
  // seam; external FD traversal/accounting is real native, not substituted.
  const store = createWorkspaceRecoveryStore({ budget, authorize: async () => {}, accounting: scan });
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  const offer = { revision: 'quota-negative', projectRaw: {}, viewState: {}, scriptState: {}, effectFacts: {}, continuationState: {}, assets: [], requiredAssetIds: [] };
  await expect(store.retain(caller, root, offer)).rejects.toThrow('budget');
  expect(reads).toBeGreaterThan(0);
  expect(await fs.readdir(path.join(root, '.storyboard-workbench'))).toEqual([]);
  expect((await fs.stat(path.join(folder, 'unfinished-origin'))).size).toBe(4096);
  expect(await fs.readdir(folder)).toEqual(['unfinished-origin']);
  // Each query executes the same original native adapter; no permission cache.
  const actual = 4096 + fixtureAttributeBytes(path.dirname(folder)) + fixtureAttributeBytes(folder) + fixtureAttributeBytes(path.join(folder, 'unfinished-origin'));
  expect(await native.request({ phase: 'inventory', userData, workspaceKey: key, byteLimit: actual, recordLimit: 100 })).toMatchObject({ bytes: actual, records: 2 });
}, 120000);

test('legacy readonly store inspection cannot publish across a changed real outside inventory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-readonly-project-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-readonly-appdata-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const r = await fs.lstat(root, { bigint: true }), m = await fs.lstat(path.join(root, '.storyboard-workbench'), { bigint: true });
  const key = createHash('sha256').update(JSON.stringify(['swb.workspace-origin-address.v1', root, String(r.dev), String(r.ino), String(r.birthtimeNs), String(m.dev), String(m.ino), String(m.birthtimeNs)])).digest('hex');
  const folder = path.join(userData, 'workspace-origin-v1', key), outside = path.join(folder, 'unsealed');
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(outside, 'a', { mode: 0o600 });
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python: 'python3', script: path.resolve('scripts/recovery-origin-permissions.py') });
  let mutate = false;
  // Phase-authored fixture: admit the approved creation metadata peak, so this
  // test still reaches its outside-inventory mutation (assertions unchanged).
  const store = createWorkspaceRecoveryStore({ budget: { bytes: 524288, records: 100, assets: 8, jsonDepth: 80 }, accounting,
    // Native project-content policy is a disclosed port; outside observation is
    // real native. Mutation is an actual new byte, not a manufactured digest.
    authorize: async request => { if (mutate && request.phase === 'readback') { mutate = false; await fs.appendFile(outside, 'b'); } }
  });
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  await store.retain(caller, root, { revision: 'readonly-joint', projectRaw: {}, viewState: {}, scriptState: {}, effectFacts: {}, continuationState: {}, assets: [], requiredAssetIds: [] });
  expect((await store.inspectReadonly(root)).state).toBe('protectedReadable');
  mutate = true;
  expect(await store.inspectReadonly(root)).toMatchObject({ state: 'protectedUninspectable', issue: expect.stringContaining('Joint recovery inventory changed') });
  expect(await fs.readFile(outside, 'utf8')).toBe('ab');
}, 120000);

test.each(['one', 'batch'] as const)('legacy %s asset read cannot publish across an outside change after its initial inspection', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-asset-window-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-asset-userdata-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const r = await fs.lstat(root, { bigint: true }), m = await fs.lstat(path.join(root, '.storyboard-workbench'), { bigint: true });
  const key = createHash('sha256').update(JSON.stringify(['swb.workspace-origin-address.v1', root, String(r.dev), String(r.ino), String(r.birthtimeNs), String(m.dev), String(m.ino), String(m.birthtimeNs)])).digest('hex');
  const folder = path.join(userData, 'workspace-origin-v1', key), outside = path.join(folder, 'unsealed');
  await fs.mkdir(folder, { recursive: true, mode: 0o700 }); await fs.writeFile(outside, 'a', { mode: 0o600 });
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python: 'python3', script: path.resolve('scripts/recovery-origin-permissions.py') });
  let mutate = false, reads = 0;
  const store = createWorkspaceRecoveryStore({ budget: { bytes: 524288, records: 100, assets: 8, jsonDepth: 80 }, accounting,
    authorize: async request => { if (mutate && request.phase === 'readback' && request.path.endsWith('/assets/pixels.bin') && ++reads === 2) { mutate = false; await fs.appendFile(outside, 'b'); } }
  });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  const ack = await store.retain(caller, root, { revision: 'asset-window', projectRaw: {}, viewState: {}, scriptState: {}, effectFacts: {}, continuationState: {}, assets: [{ assetId: 'pixels', role: 'test', bytes, width: 2, height: 2, encoding: 'png' }], requiredAssetIds: ['pixels'] });
  mutate = true;
  await expect(mode === 'one' ? store.readAsset(root, ack.generationId, 'pixels') : store.readAssets(root, ack.generationId)).rejects.toThrow('Joint recovery inventory changed');
  expect(await fs.readFile(outside, 'utf8')).toBe('ab');
}, 120000);
