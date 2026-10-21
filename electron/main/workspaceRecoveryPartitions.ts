import fs from 'node:fs/promises';
import { readSnapshotFile } from './snapshotFileRead.js';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { isDeepStrictEqual } from 'node:util';
import { createWorkspaceRecoveryStore, type RecoveryAuthorization, type RecoveryBudget, type RecoveryInspection, type RecoveryCaller, type RecoveryOffer } from './workspaceRecoveryStore.js';
import { withLayerFileOperation } from './layerFileOperationQueue.js';
import { certifyRecoveryCaptureChain, type RecoveryCaptureNode, type RecoveryCaptureReference } from './recoveryCaptureChain.js';
import { recoveryPolicyKey, intersectRecoveryPolicies } from './recoveryPolicyPartition.js';
import { scanRecoveryWorkspace } from './recoveryWorkspaceAccounting.js';
import { NATIVE_AUTHORIZATION_TRANSPORT_BYTES } from './nativeAuthorizationSession.js';
import type { ReservationFailureHandler } from './originWorkspaceAccounting.js';

export const createWorkspaceRecoveryPartitions = (options: {
  sourcePolicy?: unknown;
  // Main retains a live original offer before its first publication effect.
  // This permits content-only partial preservation, never cold writer retirement.
  allowUnsealedStart?: boolean;
  budget: RecoveryBudget;
  accounting?: typeof scanRecoveryWorkspace;
  authorize: (request: Parameters<RecoveryAuthorization>[0] & { sourcePolicy: unknown }) => Promise<void>;
}) => {
  type Store = ReturnType<typeof createWorkspaceRecoveryStore>;
  const accounting = options.accounting ?? scanRecoveryWorkspace;
  type Capture = NonNullable<RecoveryInspection['captures']>[number];
  type Verified = Capture & { store: Store; reference: RecoveryCaptureReference; sourcePolicy: any };
  // Historical source/identity facts, not cached native permission results.
  // Only an attempt admitted while the protocol was absent can mint this fact.
  const preparations = new Map<string, { identity: number[]; sourcePolicy: any; caller: RecoveryCaller }>();
  const makeStore = (sourcePolicy: any, partition?: string, globalPrevious: RecoveryCaptureReference | null = null, authorizationPolicy = sourcePolicy) => createWorkspaceRecoveryStore({
    sourcePolicy, partition, globalPrevious, capturePolicy: authorizationPolicy, budget: options.budget, allowUnsealedStart: options.allowUnsealedStart, accounting,
    authorize: request => options.authorize({ ...request, sourcePolicy: authorizationPolicy })
  });
  const exists = async (file: string) => {
    try { await fs.lstat(file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  };
  const directory = async (file: string) => {
    const stat = await fs.lstat(file);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file) throw new Error('Partition directory alias/type');
  };
  const preparationIdentity = async (root: string) => {
    const metadata = path.join(root, '.storyboard-workbench');
    await directory(root); await directory(metadata);
    const r = await fs.lstat(root), m = await fs.lstat(metadata);
    return [r.dev, r.ino, m.dev, m.ino];
  };
  const originalPreparation = async (root: string, caller?: RecoveryCaller) => {
    const original = preparations.get(root);
    if (!original || !isDeepStrictEqual(original.sourcePolicy, options.sourcePolicy) ||
      !isDeepStrictEqual(original.identity, await preparationIdentity(root)) ||
      caller && (['sender', 'frame', 'window', 'document'] as const).some(key => original.caller[key] !== caller[key])) return undefined;
    return original;
  };
  const bootstrap = async (root: string, file: string) => {
    // Bounded inert bootstrap only, followed by native certification and the
    // store's full reread/namespace/binding/schema/seal/assets verification.
    const before = await fs.lstat(file);
    if (!before.isFile() || before.nlink !== 1 || before.size > Math.min(options.budget.bytes, NATIVE_AUTHORIZATION_TRANSPORT_BYTES)) throw new Error('Partition descriptor identity/budget');
    const bytes = await readSnapshotFile(file, Math.min(options.budget.bytes, NATIVE_AUTHORIZATION_TRANSPORT_BYTES));
    const ns = JSON.parse(bytes.toString('utf8'));
    if (!ns.sourcePolicy || !Buffer.from(JSON.stringify(ns)).equals(bytes)) throw new Error('Noncanonical partition descriptor');
    await options.authorize({ path: file, root, phase: 'readback', sources: [], sourcePolicy: ns.sourcePolicy });
    return ns;
  };
  const inspectLocked = async (requested: string): Promise<{ state: RecoveryInspection; tip?: Verified; captures?: Verified[]; inventory?: Awaited<ReturnType<typeof scanRecoveryWorkspace>>; unsealed?: { sourcePolicy: any; partition?: string; missingNamespace?: boolean } }> => {
    try {
      const root = await fs.realpath(requested);
      if (root !== requested) throw new Error('Workspace partition alias');
      const metadata = path.join(root, '.storyboard-workbench');
      await directory(root); await directory(metadata);
      await options.authorize({ path: metadata, root, phase: 'directory', sources: [], sourcePolicy: options.sourcePolicy });
      const inventory = await accounting(root, options.budget);
      const nodes: RecoveryCaptureNode<Verified>[] = [];
      let incomplete = false;
      const unsealed: { sourcePolicy: any; partition?: string; missingNamespace?: boolean }[] = [];
      const inspectPartition = async (base: string, partition?: string) => {
        await directory(base);
        let ns: any;
        try { ns = await bootstrap(root, path.join(base, 'namespace.json')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.allowUnsealedStart || partition !== undefined || options.sourcePolicy === undefined) throw error;
          const original = await originalPreparation(root);
          if (!original) throw new Error('Missing namespace original preparation unavailable');
          const pending = await makeStore(original.sourcePolicy).inspectReadonly(root);
          if (pending.state !== 'protectedIncomplete' || pending.ack) throw new Error('Unsealed private preparation inventory not certifiable');
          incomplete = true; unsealed.push({ sourcePolicy: original.sourcePolicy, missingNamespace: true }); return;
        }
        if (ns.binding?.root !== root || (partition === undefined ? ns.version !== 1 : ns.version !== 2 || ns.policyKey !== partition || recoveryPolicyKey(ns.sourcePolicy) !== partition)) throw new Error('Partition descriptor address/binding');
        const store = makeStore(ns.sourcePolicy, partition), state = await store.inspectReadonly(root);
        if (!['protectedReadable', 'protectedIncomplete'].includes(state.state)) throw new Error(`Incomplete/uninspectable partition: ${state.state} ${state.issue ?? ''}`);
        incomplete ||= state.state !== 'protectedReadable';
        if (!state.captures?.length) { unsealed.push({ sourcePolicy: ns.sourcePolicy, partition }); return; }
        for (const capture of state.captures) {
          const sourcePolicy = partition === undefined ? ns.sourcePolicy : capture.content.sourcePolicy;
          if (partition !== undefined) await options.authorize({ path: path.join(base, 'operations', capture.ack.operationId, 'generations', capture.ack.generationId, 'content.json'), root, phase: 'readback', sources: [], sourcePolicy });
          const ref = (value: { operationId: string; generationId: string; sealDigest: string }): RecoveryCaptureReference => ({ format: partition === undefined ? 'v1' : 'v2', policyKey: partition ?? null, ...value });
          const reference = ref({ operationId: capture.ack.operationId, generationId: capture.ack.generationId, sealDigest: capture.ack.sealDigest });
          const localParent = capture.content.parent === null ? null : ref(capture.content.parent);
          nodes.push({ reference, globalPrevious: partition === undefined ? localParent : capture.content.globalPrevious!, localParent,
            value: { ...capture, store, reference, sourcePolicy } });
          if (nodes.length > options.budget.records) throw new Error('Workspace capture record budget');
        }
      };
      const v1 = path.join(metadata, 'workspace-recovery-v1');
      if (await exists(v1)) await inspectPartition(v1);
      const v2 = path.join(metadata, 'workspace-recovery-v2');
      if (await exists(v2)) {
        await directory(v2);
        await options.authorize({ path: v2, root, phase: 'directory', sources: [], sourcePolicy: options.sourcePolicy });
        if ((await fs.readdir(v2)).join(',') !== 'policies') throw new Error('Unknown/partial v2 container inventory');
        const policies = path.join(v2, 'policies'); await directory(policies);
        await options.authorize({ path: policies, root, phase: 'directory', sources: [], sourcePolicy: options.sourcePolicy });
        const names = await fs.readdir(policies);
        if (!names.length || names.length > options.budget.records) throw new Error('Unknown/partial partition inventory');
        for (const name of names) {
          if (!/^[a-f0-9]{64}$/.test(name)) throw new Error('Unknown recovery policy partition');
          await inspectPartition(path.join(policies, name), name);
        }
      }
      if (!nodes.length) {
        if ((await accounting(root, options.budget)).fingerprint !== inventory.fingerprint) throw new Error('Unsealed inventory changed during certification');
        return incomplete ? { state: { state: 'protectedIncomplete', issue: 'No sealed content; partial inventory remains protected' }, ...(unsealed.length === 1 ? { unsealed: unsealed[0] } : {}) } : { state: { state: 'protocolAbsent' } };
      }
      if (unsealed.length) throw new Error('Incomplete partition without a certified predecessor cannot establish a new global genesis');
      const terminal = certifyRecoveryCaptureChain(nodes), tip = terminal.value;
      const byIdentity = new Map(nodes.map(node => [JSON.stringify([node.reference.format, node.reference.policyKey, node.reference.operationId, node.reference.generationId]), node]));
      for (const node of nodes) if (node.globalPrevious !== null) {
        const p = node.globalPrevious, previous = byIdentity.get(JSON.stringify([p.format, p.policyKey, p.operationId, p.generationId]))!;
        if (recoveryPolicyKey(intersectRecoveryPolicies([node.value.sourcePolicy, previous.value.sourcePolicy])) !== recoveryPolicyKey(node.value.sourcePolicy)) throw new Error('Capture predecessor metadata restrictions widened');
      }
      // Earliest-to-latest only along the certified global predecessor chain;
      // filesystem traversal order is never an association or election rule.
      const captures: Verified[] = [];
      let cursor: RecoveryCaptureNode<Verified> | undefined = terminal;
      while (cursor) {
        captures.push(cursor.value);
        const p: RecoveryCaptureReference | null = cursor.globalPrevious;
        cursor = p === null ? undefined : byIdentity.get(JSON.stringify([p.format, p.policyKey, p.operationId, p.generationId]));
      }
      captures.reverse();
      if ((await accounting(root, options.budget)).fingerprint !== inventory.fingerprint) throw new Error('Whole-workspace inventory changed during certification');
      return { state: { state: incomplete ? 'protectedIncomplete' : 'protectedReadable', content: tip.content, ack: tip.ack, storagePolicy: tip.sourcePolicy }, tip, captures, inventory };
    } catch (error) { return { state: { state: 'protectedUninspectable', issue: String(error) } }; }
  };
  const retain = (caller: RecoveryCaller, root: string, offer: RecoveryOffer, onFailure?: ReservationFailureHandler) => withLayerFileOperation(async () => {
    const before = await inspectLocked(root);
    if (before.state.state === 'protocolAbsent' && options.allowUnsealedStart && options.sourcePolicy !== undefined) {
      if ((['sender', 'frame', 'window', 'document'] as const).some(key => !caller?.[key] || typeof caller[key] !== 'object')) throw new Error('Actual preparation caller required');
      if (preparations.has(root)) {
        if (!await originalPreparation(root, caller)) throw new Error('Original preparation identity changed');
      } else preparations.set(root, { identity: await preparationIdentity(root), sourcePolicy: structuredClone(options.sourcePolicy), caller: { ...caller } });
    }
    if (before.unsealed?.missingNamespace && !await originalPreparation(root, caller)) throw new Error('Original unsealed preparation caller changed');
    const unsealed = options.allowUnsealedStart && before.state.state === 'protectedIncomplete' && !before.tip && before.unsealed?.partition === undefined && before.unsealed !== undefined && isDeepStrictEqual(before.unsealed.sourcePolicy, options.sourcePolicy);
    if (!['protocolAbsent', 'protectedReadable'].includes(before.state.state) && !(before.state.state === 'protectedIncomplete' && before.tip) && !unsealed) throw new Error(`Whole-workspace retention refused: ${before.state.state} ${before.state.issue ?? ''}`);
    const sourcePolicy = intersectRecoveryPolicies([options.sourcePolicy, ...(before.tip ? [before.tip.sourcePolicy] : unsealed ? [before.unsealed!.sourcePolicy] : [])]);
    const policyKey = recoveryPolicyKey(sourcePolicy);
    // v1 has only its immutable namespace certificate. A new contributor needs
    // its own v2 capture certificate even when the resulting mode/key is equal.
    // Preserve v1 only for the original complete set of source observations.
    const legacy = before.state.state === 'protocolAbsent' || unsealed || before.tip?.reference.format === 'v1' && isDeepStrictEqual(before.tip.sourcePolicy, sourcePolicy);
    const partition = legacy ? undefined : policyKey;
    const descriptorPolicy = legacy && before.tip ? before.tip.sourcePolicy : unsealed ? before.unsealed!.sourcePolicy : sourcePolicy;
    const store = makeStore(descriptorPolicy, partition, before.tip?.reference ?? null, sourcePolicy);
    const ack = await store.retain(caller, root, offer, onFailure);
    const after = await inspectLocked(root);
    if (!['protectedReadable', 'protectedIncomplete'].includes(after.state.state) || after.tip?.reference.policyKey !== (partition ?? null) || after.state.ack?.generationId !== ack.generationId || after.state.ack.sealDigest !== ack.sealDigest) throw new Error(`Whole-workspace latest capture not certified: ${after.state.state} ${after.state.issue ?? ''}`);
    return ack;
  });
  const exactTip = async (root: string, generationId: string) => {
    const state = await inspectLocked(root);
    if (!['protectedReadable', 'protectedIncomplete'].includes(state.state.state) || state.tip?.ack.generationId !== generationId) throw new Error('Exact whole-workspace readable tip required');
    return state.tip;
  };
  const readCaptureAssets = async (root: string, capture: Verified) => {
    const namespace = capture.reference.format === 'v1' ? 'workspace-recovery-v1' : `workspace-recovery-v2/policies/${capture.reference.policyKey}`;
    const assets = new Map<string, Buffer>();
    for (const asset of capture.content.assets) {
      const file = path.join(root, '.storyboard-workbench', namespace, 'operations', capture.ack.operationId, 'generations', capture.ack.generationId, 'assets', asset.file);
      await options.authorize({ path: file, root, phase: 'readback', sources: [], sourcePolicy: capture.sourcePolicy });
      const bytes = await readSnapshotFile(file, options.budget.bytes);
      if (bytes.length !== asset.length || createHash('sha256').update(bytes).digest('hex') !== asset.digest) throw new Error('Retained asset changed during batch readback');
      assets.set(asset.assetId, bytes);
    }
    return assets;
  };
  const readSelectedCapture = async (root: string, before: Awaited<ReturnType<typeof inspectLocked>>, capture: Verified) => {
    if (!before.tip || !before.inventory || !['protectedReadable', 'protectedIncomplete'].includes(before.state.state)) throw new Error('Certified whole-workspace capture required');
    const assets = await readCaptureAssets(root, capture);
    // Both full passes include every asset's native restrictions and complete
    // raster decode. Selected bytes also have their own fresh native/FD/hash
    // readback, just without an additional recursive whole-chain inspection.
    const after = await inspectLocked(root);
    const reread = after.captures?.find(c => isDeepStrictEqual(c.reference, capture.reference));
    if (!reread || !after.inventory || !isDeepStrictEqual(capture.ack, reread.ack) || !isDeepStrictEqual(before.tip.ack, after.tip?.ack) ||
      before.state.state !== after.state.state || before.inventory.fingerprint !== after.inventory.fingerprint ||
      before.inventory.bytes !== after.inventory.bytes || before.inventory.records !== after.inventory.records) throw new Error('Whole-workspace capture or inventory changed during asset read');
    return { content: capture.content, ack: capture.ack, assets, storagePolicy: capture.sourcePolicy };
  };
  return {
    retain,
    inspectReadonly: (root: string) => withLayerFileOperation(async () => (await inspectLocked(root)).state),
    // Each inspectLocked performs native policy, inventory, schema/seal and
    // full encoded-byte/raster validation for EVERY capture. Sandwich the
    // entire chain once rather than recursively rescanning it per generation.
    // Nothing survives this serialized call as a permission/result cache.
    verifyCapturesReadonly: (root: string, check?: (verified: { state: RecoveryInspection; captures: Omit<Verified, 'store'>[]; readAssets: (reference: RecoveryCaptureReference) => Promise<Map<string, Buffer>> }) => Promise<void>) => withLayerFileOperation(async () => {
      const before = await inspectLocked(root);
      if (before.state.state !== 'protectedReadable' || !before.captures || !before.tip || !before.inventory) throw new Error('Certified whole-workspace historical chain required');
      // Main-private validation only, in this serialized call. Source/failure
      // checks are sandwiched by the same two complete historical inspections;
      // they need no extra whole-chain scans merely to obtain metadata.
      let active = true;
      try {
        await check?.({ state: before.state, captures: before.captures.map(({ store: _store, ...capture }) => capture), readAssets: async reference => {
          if (!active) throw new Error('Main certification boundary closed');
          const capture = before.captures!.find(c => isDeepStrictEqual(c.reference, reference));
          if (!capture) throw new Error('Exact certified capture reference required');
          return readCaptureAssets(root, capture);
        } });
      } finally { active = false; }
      const after = await inspectLocked(root);
      if (!after.captures || !after.tip || !after.inventory || before.state.state !== after.state.state ||
        before.inventory.fingerprint !== after.inventory.fingerprint || before.inventory.bytes !== after.inventory.bytes || before.inventory.records !== after.inventory.records ||
        !isDeepStrictEqual(before.captures.map(c => ({ reference: c.reference, ack: c.ack })), after.captures.map(c => ({ reference: c.reference, ack: c.ack }))) ||
        !isDeepStrictEqual(before.tip.ack, after.tip.ack)) throw new Error('Whole-workspace history changed during full readback');
      return after.state;
    }),
    inspectCapturesReadonly: (root: string) => withLayerFileOperation(async () => {
      const state = await inspectLocked(root);
      if (!state.captures) throw new Error('Certified whole-workspace historical chain required');
      return state.captures.map(({ content, ack, reference, sourcePolicy }) => ({ content, ack, reference, storagePolicy: sourcePolicy }));
    }),
    readCapture: (root: string, reference: RecoveryCaptureReference) => withLayerFileOperation(async () => {
      const before = await inspectLocked(root);
      const capture = before.captures?.find(c => isDeepStrictEqual(c.reference, reference));
      if (!capture || !before.tip) throw new Error('Exact whole-workspace historical reference required');
      return readSelectedCapture(root, before, capture);
    }),
    readAssets: (root: string, generationId: string) => withLayerFileOperation(async () => {
      const before = await inspectLocked(root);
      if (!before.tip || before.tip.ack.generationId !== generationId) throw new Error('Exact whole-workspace readable tip required');
      return (await readSelectedCapture(root, before, before.tip)).assets;
    }),
    readAsset: (root: string, generationId: string, assetId: string) => withLayerFileOperation(async () => {
      const before = await exactTip(root, generationId), bytes = await before.store.readAsset(root, generationId, assetId);
      const after = await exactTip(root, generationId);
      if (before.ack.sealDigest !== after.ack.sealDigest) throw new Error('Whole-workspace capture changed during asset read');
      return bytes;
    })
  };
};
