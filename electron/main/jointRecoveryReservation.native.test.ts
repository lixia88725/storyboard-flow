import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { waitForNativeWorkersSettled } from './nativeWorkerSettlement';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { fixtureAttributeBytes } from './nativeAttributeMeter.fixture';

// Real project+native-origin accounting; callback is the declared synthetic
// storage-effect seam, not a provenance/permission certificate or GUI test.
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'joint-reservation-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'joint-reservation-data-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const key = await originWorkspaceKey(root), folder = path.join(userData, 'workspace-origin-v1', key);
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python: 'python3', script: path.resolve('scripts/recovery-origin-permissions.py') });
  // Independent fixture baseline now includes the actual metadata container.
  const metadataAttributes = fixtureAttributeBytes(path.join(root, '.storyboard-workbench'));
  return { root, userData, folder, accounting, metadataAttributes };
};
const emptyResidueAttributes = async (f: Awaited<ReturnType<typeof fixture>>) => {
  await fs.mkdir(f.folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(f.folder, 'partial'), '', { mode: 0o600 });
  return f.metadataAttributes + fixtureAttributeBytes(path.dirname(f.folder)) + fixtureAttributeBytes(f.folder) + fixtureAttributeBytes(path.join(f.folder, 'partial'));
};

// Explicitly accept only the refusal this scenario intentionally exercises.
// This never changes the rejected request, measured overrun, or later guards.
const handleExpectedFailure = (pattern: RegExp) => async (error: unknown) => {
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toMatch(pattern);
};

test('unknown terminal scope cannot reuse a reservation and only actual exit permits fresh physical reconciliation', async () => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f), budget = { bytes: 12 + attributes, records: 100, assets: 8, jsonDepth: 80 };
  const script = path.join(f.root, 'slow-close.py'), marker = path.join(f.root, 'terminal');
  await fs.writeFile(script, `import atexit,time,signal\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ndef finish():\n time.sleep(0.3)\n with open(${JSON.stringify(marker)},'w') as f:f.write('terminal')\natexit.register(finish)\ndef authorize(r):return {'authorized':True}\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', script, () => 65536, { requestTimeoutMs: 1000, closeTimeoutMs: 20 });
  try {
    await expect(f.accounting.reserve(f.root, budget, 6, 3, async () => {
      await fs.mkdir(f.folder, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(f.folder, 'partial'), 'abcd', { mode: 0o600 });
      await native.request({});
    })).rejects.toThrow('unknown');
    let started = false;
    await expect(f.accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow('unknown');
    expect(started).toBe(false);
  } finally { await waitForNativeWorkersSettled(); }
  expect(await fs.readFile(marker, 'utf8')).toBe('terminal');
  expect((await f.accounting(f.root, budget)).bytes).toBe(4 + attributes);
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('abcd');
}, 120000);

test('project capture must honor the same allocator refusal before any namespace effect', async () => {
  // Phase-authored fixture needs creation headroom to reach the allocator port.
  const f = await fixture(), budget = { bytes: 524288, records: 100, assets: 8, jsonDepth: 80 };
  let claims = 0;
  f.accounting.reserve = async () => { claims++; throw new Error('Synthetic joint reservation refused'); };
  const store = createWorkspaceRecoveryStore({ accounting: f.accounting, budget, authorize: async () => {} });
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  await expect(store.retain(caller, f.root, { revision: 'shared', projectRaw: {}, viewState: {}, scriptState: {}, effectFacts: {}, continuationState: {}, assets: [], requiredAssetIds: [] })).rejects.toThrow('joint reservation refused');
  expect(claims).toBe(1);
  expect(await fs.readdir(path.join(f.root, '.storyboard-workbench'))).toEqual([]);
}, 120000);

test('nested same-workspace reservation cannot borrow the still-spendable parent claim', async () => {
  const f = await fixture(), budget = { bytes: 10 + f.metadataAttributes, records: 100, assets: 8, jsonDepth: 80 };
  let started = false;
  await f.accounting.reserve(f.root, budget, 6, 2, async () => {
    await expect(f.accounting.reserve(f.root, budget, 5, 1, async () => { started = true; }, handleExpectedFailure(/reservation|budget/i))).rejects.toThrow(/reservation|budget/i);
    expect(started).toBe(false);
  });
  expect(await fs.readdir(f.userData)).toEqual([]);
}, 120000);

test('joint peak reservation refuses before the callback or registry creation', async () => {
  const f = await fixture(), budget = { bytes: 20 + f.metadataAttributes, records: 100, assets: 8, jsonDepth: 80 };
  let started = false;
  await expect(f.accounting.reserve(f.root, budget, 21, 3, async () => { started = true; })).rejects.toThrow('budget');
  expect(started).toBe(false);
  expect(await fs.readdir(f.userData)).toEqual([]);
}, 120000);

test('one shared scope charges materialized origin bytes only once and retains unused peak until actual scope settlement', async () => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f), budget = { bytes: 12 + attributes, records: 100, assets: 8, jsonDepth: 80 };
  await f.accounting.run(async () => {
    await f.accounting.reserve(f.root, budget, 6, 3, async () => {
      await fs.mkdir(f.folder, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(f.folder, 'partial'), 'abcd', { mode: 0o600 });
      // Its own allowance isn't added to its materialized bytes during its
      // operation. Foreign/unspent reservations still consume shared capacity.
      expect((await f.accounting(f.root, budget)).bytes).toBe(4 + attributes);
    });
    expect((await f.accounting(f.root, budget)).bytes).toBe(6 + attributes);
    let started = false;
    await expect(f.accounting.reserve(f.root, budget, 7, 1, async () => { started = true; }, handleExpectedFailure(/budget/))).rejects.toThrow('budget');
    expect(started).toBe(false);
  });
  expect((await f.accounting(f.root, budget)).bytes).toBe(4 + attributes);
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('abcd');
}, 120000);

// Public allocator seam, real native inventory and a declared storage-fault port.
test('a finished worker cannot wash an observed over-claim into a fresh spending allowance', async () => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f), budget = { bytes: 6 + attributes, records: 100, assets: 8, jsonDepth: 80 };
  await expect(f.accounting.reserve(f.root, budget, 2, 1, async () => {
    await fs.writeFile(path.join(f.folder, 'partial'), 'abcd', { mode: 0o600 });
  })).rejects.toThrow('materialization exceeded peak');
  await waitForNativeWorkersSettled();
  let started = false;
  await expect(f.accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
  expect(started).toBe(false);
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('abcd');
}, 120000);

// Getter failure is a declared Main locator-observation fault, not a fake native
// inventory result. Restoration enables the genuine complete census again.
test.each(['within-peak', 'over-peak'] as const)('worker exit with an unknown census requires fresh %s reconciliation before new spending', async kind => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f), budget = { bytes: 12 + attributes, records: 100, assets: 8, jsonDepth: 80 };
  let unavailable = false;
  const accounting = createOriginWorkspaceAccounting({ userData: () => { if (unavailable) throw new Error('Synthetic accounting observation unavailable'); return f.userData; }, python: 'python3', script: path.resolve('scripts/recovery-origin-permissions.py') });
  await expect(accounting.reserve(f.root, budget, kind === 'within-peak' ? 6 : 2, 1, async () => {
    await fs.writeFile(path.join(f.folder, 'partial'), 'abcd', { mode: 0o600 });
    unavailable = true;
    throw new Error('Original storage failure remains primary');
  })).rejects.toThrow('Original storage failure remains primary');
  await waitForNativeWorkersSettled();
  await expect(accounting(f.root, budget)).rejects.toThrow('observation unavailable');
  unavailable = false;
  let started = false;
  if (kind === 'over-peak') {
    await expect(accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
    expect(started).toBe(false);
  } else {
    expect((await accounting(f.root, budget)).bytes).toBe(4 + attributes);
    await accounting.reserve(f.root, budget, 1, 1, async () => { started = true; });
    expect(started).toBe(true);
  }
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('abcd');
}, 120000);

test('a first delayed over-peak observation stays protected even after the synthetic footprint shrinks', async () => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f), budget = { bytes: 12 + attributes, records: 100, assets: 8, jsonDepth: 80 };
  let unavailable = false;
  const accounting = createOriginWorkspaceAccounting({ userData: () => { if (unavailable) throw new Error('Synthetic census unavailable'); return f.userData; }, python: 'python3', script: path.resolve('scripts/recovery-origin-permissions.py') });
  await expect(accounting.reserve(f.root, budget, 2, 1, async () => {
    await fs.writeFile(path.join(f.folder, 'partial'), 'abcd', { mode: 0o600 });
    unavailable = true;
    throw new Error('Original storage failure');
  })).rejects.toThrow('Original storage failure');
  await waitForNativeWorkersSettled();
  unavailable = false;
  let started = false;
  await expect(accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
  expect(started).toBe(false);
  // Declared synthetic storage actor, NOT a product cleanup/recovery action.
  await fs.truncate(path.join(f.folder, 'partial'), 1);
  await expect(accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
  expect(started).toBe(false);
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('a');
}, 120000);

test('a complete joint over-cap census cannot be washed away by later synthetic cleanup', async () => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f);
  const project = path.join(f.root, '.storyboard-workbench/workspace-recovery-v1');
  await fs.mkdir(project, { mode: 0o700 });
  await fs.writeFile(path.join(project, 'partial'), Buffer.alloc(128, 1), { mode: 0o600 });
  const projectAttributes = fixtureAttributeBytes(project) + fixtureAttributeBytes(path.join(project, 'partial'));
  const budget = { bytes: 128 + attributes + projectAttributes + 4, records: 100, assets: 8, jsonDepth: 80 };
  await expect(f.accounting.reserve(f.root, budget, 2, 1, async () => {
    // Each scanner remains within its input limit; only the complete, stable,
    // incarnation-checked joint total exceeds the shared workspace cap.
    await fs.writeFile(path.join(f.folder, 'partial'), 'abcdef', { mode: 0o600 });
  })).rejects.toThrow('joint recovery workspace budget exceeded');
  await waitForNativeWorkersSettled();
  // This is an explicitly owned synthetic actor, never product cleanup/GC.
  await fs.truncate(path.join(f.folder, 'partial'), 1);
  let started = false;
  await expect(f.accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
  expect(started).toBe(false);
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('a');
  expect((await fs.stat(path.join(project, 'partial'))).size).toBe(128);
}, 120000);

test.each(['active', 'already-reconciled', 'live-sibling'] as const)('a caught complete over-cap observation remains sticky through %s scope settlement', async state => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f);
  const project = path.join(f.root, '.storyboard-workbench/workspace-recovery-v1');
  await fs.mkdir(project, { mode: 0o700 });
  await fs.writeFile(path.join(project, 'partial'), Buffer.alloc(128, 1), { mode: 0o600 });
  const projectAttributes = fixtureAttributeBytes(project) + fixtureAttributeBytes(path.join(project, 'partial'));
  const budget = { bytes: 128 + attributes + projectAttributes + 4, records: 100, assets: 8, jsonDepth: 80 };
  const observeThenShrink = async () => {
    await fs.writeFile(path.join(f.folder, 'partial'), 'abcdef', { mode: 0o600 });
    await expect(f.accounting(f.root, budget)).rejects.toThrow('joint recovery workspace budget exceeded');
    // Owned synthetic storage actor: swallowing an error or shrinking data is
    // not permission for the allocator to forget the measured overrun.
    await fs.truncate(path.join(f.folder, 'partial'), 1);
  };
  await f.accounting.run(async () => {
    if (state === 'active') {
      await expect(f.accounting.reserve(f.root, budget, 2, 1, observeThenShrink, handleExpectedFailure(/materialization|reconciliation/))).rejects.toThrow(/materialization|reconciliation/);
    } else {
      await f.accounting.reserve(f.root, budget, 2, 1, async () => {
        await fs.writeFile(path.join(f.folder, 'partial'), 'a', { mode: 0o600 });
      });
      await observeThenShrink();
      if (state === 'live-sibling') {
        let started = false;
        await expect(f.accounting.reserve(f.root, budget, 1, 1, async () => { started = true; }, handleExpectedFailure(/materialization|reconciliation/))).rejects.toThrow(/materialization|reconciliation/);
        expect(started).toBe(false);
      }
    }
  });
  await waitForNativeWorkersSettled();
  let started = false;
  await expect(f.accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
  expect(started).toBe(false);
  expect(await fs.readFile(path.join(f.folder, 'partial'), 'utf8')).toBe('a');
  expect((await fs.stat(path.join(project, 'partial'))).size).toBe(128);
}, 120000);

// Additional guard coverage: the joint limit is also a record limit. These
// first-green cases protect the same public lifecycle, not a claimed new RED.
test.each(['active', 'already-reconciled'] as const)('a caught complete joint record overrun stays protected through %s settlement', async state => {
  const f = await fixture(), attributes = await emptyResidueAttributes(f);
  const project = path.join(f.root, '.storyboard-workbench/workspace-recovery-v1');
  await fs.mkdir(project, { mode: 0o700 });
  await fs.writeFile(path.join(project, 'partial'), Buffer.alloc(128, 1), { mode: 0o600 });
  const budget = { bytes: 128 + attributes + 8192, records: 6, assets: 8, jsonDepth: 80 };
  const extras = ['one', 'two', 'three'].map(name => path.join(f.folder, name));
  const observeThenShrink = async () => {
    for (const file of extras) await fs.writeFile(file, '', { mode: 0o600 });
    // project=2, origin=5; each scanner is below 6, their joint total is 7.
    await expect(f.accounting(f.root, budget)).rejects.toThrow('joint recovery workspace budget exceeded');
    for (const file of extras) await fs.unlink(file); // Owned synthetic actor only.
  };
  await f.accounting.run(async () => {
    if (state === 'active') {
      await expect(f.accounting.reserve(f.root, budget, 4096, 1, observeThenShrink, handleExpectedFailure(/materialization|reconciliation/))).rejects.toThrow(/materialization|reconciliation/);
    } else {
      await f.accounting.reserve(f.root, budget, 4096, 1, async () => {});
      await observeThenShrink();
    }
  });
  let started = false;
  await expect(f.accounting.reserve(f.root, budget, 1, 1, async () => { started = true; })).rejects.toThrow(/materialization|reconciliation/);
  expect(started).toBe(false);
  // Quarantining this Root must not turn a sibling workspace into the same
  // failure or make its safe spending require retiring the failed workspace.
  const sibling = await fs.mkdtemp(path.join(os.tmpdir(), 'joint-reservation-sibling-'));
  await fs.mkdir(path.join(sibling, '.storyboard-workbench'), { mode: 0o700 });
  await f.accounting.reserve(sibling, { ...budget, records: 100 }, 1, 1, async () => { started = true; });
  expect(started).toBe(true);
  expect((await fs.stat(path.join(project, 'partial'))).size).toBe(128);
}, 120000);
