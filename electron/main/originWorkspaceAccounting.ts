import fs from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createNativeAuthorizationSession, NATIVE_AUTHORIZATION_TRANSPORT_BYTES } from './nativeAuthorizationSession.js';
import { scanRecoveryWorkspace } from './recoveryWorkspaceAccounting.js';
import type { RecoveryBudget } from './workspaceRecoveryStore.js';
import { withLayerFileOperation } from './layerFileOperationQueue.js';
import { assertNativeWorkersSettled } from './nativeWorkerSettlement.js';
import type { createRecoveryClaimRecords, ClaimAdmission, RecordRestrictions } from './recoveryClaimRecords.js';
import { recoveryPolicyKey, intersectRecoveryPolicies } from './recoveryPolicyPartition.js';

// Main-only error disposition, registered before the request's first await.
// It does not change the failed operation's result or any resource authority.
export type ReservationFailureHandler = (error: unknown) => Promise<void>;
export type ResourceReservationQuote = Readonly<object>;
export type ReservationPhysicalControl = Readonly<{ unknown: () => void }>;

export type OriginWorkspaceAccounting = typeof scanRecoveryWorkspace & {
  run: <T>(operation: () => Promise<T>) => Promise<T>;
  quote: (root: string, budget: RecoveryBudget, bytes: number, records: number, certificate: unknown) => Promise<ResourceReservationQuote | undefined>;
  isControlOnlyChange: (root: string, before: string, after: string) => Promise<boolean>;
  reserve: <T>(root: string, budget: RecoveryBudget, bytes: number, records: number, operation: (control?: ReservationPhysicalControl) => Promise<T>, onFailure?: ReservationFailureHandler, quote?: ResourceReservationQuote) => Promise<T>;
  originAllowance: (root: string, budget: RecoveryBudget) => Promise<{ bytes: number; records: number; originAbsent: boolean; registryAbsent: boolean }>;
};

/** Address only, NOT historical provenance. The private registry's original
 * records will separately bind exact producer/capture evidence. No JS Number
 * device/inode conversion, no copying an address supplied by the renderer. */
export const originWorkspaceKey = async (root: string): Promise<string> => {
  if (await fs.realpath(root) !== root) throw new Error('Origin accounting workspace alias');
  const metadata = path.join(root, '.storyboard-workbench');
  if (await fs.realpath(metadata) !== metadata) throw new Error('Origin accounting metadata alias');
  const r = await fs.lstat(root, { bigint: true }), m = await fs.lstat(metadata, { bigint: true });
  if (!r.isDirectory() || r.isSymbolicLink() || !m.isDirectory() || m.isSymbolicLink() || r.birthtimeNs <= 0n || m.birthtimeNs <= 0n) throw new Error('Origin accounting physical incarnation unavailable');
  return createHash('sha256').update(JSON.stringify(['swb.workspace-origin-address.v1', root, String(r.dev), String(r.ino), String(r.birthtimeNs), String(m.dev), String(m.ino), String(m.birthtimeNs)])).digest('hex');
};

export const createOriginWorkspaceAccounting = (options: { userData: () => string; python: string; script: string; claimRecords?: (root: string) => ReturnType<typeof createRecoveryClaimRecords>; claimWriter?: (root: string, restrictions: RecordRestrictions) => ReturnType<typeof createRecoveryClaimRecords> }): OriginWorkspaceAccounting => {
  if (options.claimWriter && !options.claimRecords) throw new Error('Independent claim reader required with durable writer');
  const native = createNativeAuthorizationSession(options.python, options.script, () => 65536);
  const projectNative = createNativeAuthorizationSession(options.python, path.join(path.dirname(options.script), 'recovery-project-permissions.py'), () => 65536);
  const contentNative = createNativeAuthorizationSession(options.python, path.join(path.dirname(options.script), 'recovery-content-permissions.py'), () => NATIVE_AUTHORIZATION_TRANSPORT_BYTES);
  type Claim = { root: string; key: string; bytes: number; records: number; scope: Scope; beforeBytes: number; beforeRecords: number; effectBeforeBytes: number; effectBeforeRecords: number; effectPeak: number; effectRecords: number; peakBytes: number; peakRecords: number; reconciled: boolean; exceeded: boolean; physicalUnknown: boolean; effectSettled: boolean };
  type Group = { key: string; scopeId: string; budget: RecoveryBudget; writer: ReturnType<typeof createRecoveryClaimRecords>; members: ClaimAdmission[]; claims: Set<Claim>; closed: boolean };
  type Task = { settled: boolean; admitted: boolean; failed: boolean; handled: boolean; error?: unknown };
  type Scope = { claims: Set<Claim>; groups: Map<string, Group>; closed: boolean; accepting: boolean; pending: Set<Promise<void>>; tasks: Set<Task> };
  const scopes = new AsyncLocalStorage<Scope>(), active = new AsyncLocalStorage<Claim>();
  const outstanding = new Set<Claim>();
  // At most one unconsumed control-only transition per Root. This is lifecycle
  // evidence, not a cached permission: callers still perform fresh inventories.
  const controlTransitions = new Map<string, { key: string; before: string; after: string }>();
  const isControlOnlyChange = async (root: string, before: string, after: string): Promise<boolean> => {
    const transition = controlTransitions.get(root);
    if (!transition || transition.before !== before || transition.after !== after || transition.key !== await originWorkspaceKey(root)) return false;
    controlTransitions.delete(root);return true;
  };
  const quotes = new WeakMap<ResourceReservationQuote, { scope: Scope; root: string; key: string; bytes: number; records: number; budget: RecoveryBudget; live: any; restrictions: RecordRestrictions; used: boolean }>();
  const quote = async (root: string, budget: RecoveryBudget, bytes: number, records: number, certificate: any): Promise<ResourceReservationQuote | undefined> => {
    if (!options.claimWriter) return undefined;
    budget = { ...budget };certificate = structuredClone(certificate);
    const scope = scopes.getStore();
    if (!scope || !scope.accepting || scope.closed || ![bytes, records].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Original open resource scope and finite producer plan required');
    recoveryPolicyKey(certificate);
    if (certificate.schema !== 'swb.finite-source-policy' || certificate.version !== 1 || !Array.isArray(certificate.observed) || !certificate.observed.length) throw new Error('Main native contributor certificate required');
    const key = await originWorkspaceKey(root), sources: string[] = [];
    for (const observation of certificate.observed) {
      const file = observation?.[0];
      if (typeof file !== 'string' || !path.isAbsolute(file) || file !== path.normalize(file) || !file.startsWith(root + path.sep)) throw new Error('Bound producer contributor path required');
      try { await fs.lstat(file); sources.push(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (!sources.length) throw new Error('Live native producer contributors unavailable');
    const live = (await contentNative.request({ phase: 'capturePolicy', sources: [...new Set(sources)], sourceByteLimit: budget.bytes })).sourcePolicy;
    const restrictions: RecordRestrictions = { ...intersectRecoveryPolicies([certificate, live]).expected, acl: null };
    if (![0o400, 0o600].includes(restrictions.mode) || key !== await originWorkspaceKey(root) || !scope.accepting) throw new Error('Owner-only bound producer quote required');
    const binding = Object.freeze({});
    quotes.set(binding, { scope, root, key, bytes, records, budget: { ...budget }, live: structuredClone(live), restrictions: structuredClone(restrictions), used: false });
    return binding;
  };

  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    const existing = scopes.getStore();
    if (existing) { if (existing.closed) throw new Error('Closed joint accounting scope'); return operation(); }
    const scope: Scope = { claims: new Set(), groups: new Map(), closed: false, accepting: true, pending: new Set(), tasks: new Set() };
    const execute = async () => {
      let failed = false;
      try { return await operation(); }
      catch (error) { failed = true; throw error; }
      finally {
        scope.accepting = false;

        // Keep both native census sessions alive until every synchronously
        // registered request really settles, including unawaited effects.
        while (scope.pending.size) {
          await Promise.allSettled([...scope.pending]);
        }
        if ([...scope.tasks].some(task => !task.settled)) {
          for (const claim of scope.claims) claim.reconciled = false;
          if (!failed) throw new Error('Joint accounting task settlement unknown');
        }
        const unhandled = [...scope.tasks].find(task => task.failed && !task.handled);
        try { await finish(scope); }
        catch (error) { if (!failed && !unhandled) throw error; }
        if (!failed && unhandled) throw unhandled.error;
      }
    };
    try { return await scopes.run(scope, () => native.run(() => projectNative.run(() => contentNative.run(execute)))); }
    finally {
      scope.closed = true;
      try {
        assertNativeWorkersSettled();
        // A successful post-effect census plus genuine scope/worker settlement
        // permits release. If one claim is unknown, preserve the whole Root's
        // envelope so a later census cannot misattribute its sibling effects.
        const unknownRoots = new Set([...scope.claims].filter(c => c.physicalUnknown || !c.reconciled || c.exceeded || scope.groups.has(c.root) && !scope.groups.get(c.root)!.closed).map(c => c.root));
        for (const claim of [...scope.claims]) if (!unknownRoots.has(claim.root)) {
          outstanding.delete(claim); scope.claims.delete(claim);
        }
      } catch {
        // Exit alone is NOT reconciliation. The next caller must observe a
        // complete stable census after real settlement before any new grant.
        for (const claim of scope.claims) claim.reconciled = false;
      }
    }
  };
  const physicalScan = async (root: string, budget: RecoveryBudget) => {
    const key = await originWorkspaceKey(root);
    // userData is evaluated only after Main's isolated startup path is set.
    // The interpreter rechecks every FD/native policy on every inventory query.
    const userData = options.userData();
    const request = { phase: 'inventory', userData, workspaceKey: key, byteLimit: budget.bytes, recordLimit: budget.records };
    const before = await native.request(request);
    const project = await projectNative.request({ phase: 'inventory', root, byteLimit: budget.bytes, recordLimit: budget.records });
    if (!Number.isSafeInteger(project.bytes) || project.bytes < 0 || !Number.isSafeInteger(project.records) || project.records < 0 || !/^[a-f0-9]{64}$/.test(project.fingerprint)) throw new Error('Unknown project accounting budget');
    const origin = await native.request(request);
    if (key !== await originWorkspaceKey(root) || origin.fingerprint !== before.fingerprint || origin.bytes !== before.bytes || origin.records !== before.records) throw new Error('Origin/project accounting incarnation or inventory changed');
    if (!Number.isSafeInteger(origin.bytes) || origin.bytes < 0 || !Number.isSafeInteger(origin.records) || origin.records < 0 || !/^[a-f0-9]{64}$/.test(origin.fingerprint)) throw new Error('Unknown origin accounting budget');
    const bytes = project.bytes + origin.bytes, records = project.records + origin.records;
    if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(records)) throw new Error('Unknown accumulated joint recovery workspace budget');
    if (bytes > budget.bytes || records > budget.records) {
      // Both complete censuses and the physical incarnation have been checked.
      // A shared-cap overrun must survive this early refusal: finally/effective
      // have not received a result yet and cannot record it themselves. Keep
      // the original Root's entire envelope quarantined after later shrinkage.
      // Unknown/incomplete scans above never acquire this measured-overrun fact.
      for (const claim of outstanding) if (claim.root === root && claim.key === key) claim.exceeded = true;
      throw new Error('Accumulated joint recovery workspace budget exceeded');
    }
    return { key, bytes, records, originBytes: origin.bytes as number, originRecords: origin.records as number, projectFingerprint: project.fingerprint as string, originFingerprint: origin.fingerprint as string, originAbsent: origin.absent === true, registryAbsent: origin.registryAbsent === true, fingerprint: createHash('sha256').update(JSON.stringify([project.fingerprint, origin.fingerprint])).digest('hex') };
  };
  const effective = async (root: string, budget: RecoveryBudget, physical: Awaited<ReturnType<typeof physicalScan>>) => {
    const key = await originWorkspaceKey(root);
    if (key !== physical.key) throw new Error('Joint census physical incarnation changed');
    if (options.claimRecords) {
      const entries = await options.claimRecords(root).read({ workspaceKey: key, scopeId: 'resource-census', claimId: 'resource-census',
        plan: { effectPeak: 1, claimPeak: 65536, closePeak: 65536 }, allowance: { bytes: budget.bytes, records: budget.records } });
      if (key !== await originWorkspaceKey(root)) throw new Error('Persistent resource census incarnation changed');
      // Only a complete authenticated v3 member-set proof can end the durable
      // envelope. Legacy codec terminals, partial groups and exceeded outcomes
      // cannot turn later shrinkage into new capacity.
      const group = scopes.getStore()?.groups.get(root), incomplete = entries.filter(entry => entry.scopeComplete !== true);
      if (group && !group.closed && group.members.length) {
        if (group.key !== key || !group.writer.ownsScopeRows(group.members, incomplete)) throw new Error('Persistent resource scope original members changed');
      } else if (incomplete.length) throw new Error('Persistent resource scope is not certified; reservation remains protected');
    }
    // This applies to LIVE scopes too. A caller that caught a measured overrun
    // cannot spend a sibling reservation before the outer scope finally exits.
    for (const claim of outstanding) if (claim.root === root && claim.exceeded) throw new Error('Joint reservation reconciliation materialization exceeded peak');
    for (const claim of outstanding) if (claim.root === root && claim.physicalUnknown) throw new Error('Original physical reservation outcome unknown; Root protected');
    const closed = new Map<Scope, Claim[]>();
    for (const claim of outstanding) if (claim.root === root && claim.scope.closed) {
      const group = closed.get(claim.scope) ?? []; group.push(claim); closed.set(claim.scope, group);
    }
    for (const group of closed.values()) {
      assertNativeWorkersSettled();
      if (group.some(c => c.key !== key)) throw new Error('Joint reservation reconciliation incarnation changed');
      const peakBytes = group.reduce((sum, c) => sum + c.peakBytes, 0), peakRecords = group.reduce((sum, c) => sum + c.peakRecords, 0);
      if (group.some(c => c.exceeded)) throw new Error('Joint reservation reconciliation materialization exceeded peak');
      if (!Number.isSafeInteger(peakBytes) || !Number.isSafeInteger(peakRecords) || physical.bytes - group[0].beforeBytes > peakBytes || physical.records - group[0].beforeRecords > peakRecords) {
        // A first complete delayed census can be the first proof of overrun.
        // Keep that fact just like reserve.finally does; later shrinkage must
        // not wash it into permission for a new operation in this instance.
        for (const claim of group) claim.exceeded = true;
        throw new Error('Joint reservation reconciliation materialization exceeded peak');
      }
      // This scan is fresh, complete, stable, incarnation-bound and performed
      // after the original workers settled. It does not replay the operation or
      // retire its failure/ACK; only its fully accounted reservation can end.
      for (const claim of group) { outstanding.delete(claim); claim.scope.claims.delete(claim); }
    }
    let bytes = physical.bytes, records = physical.records;
    for (const claim of outstanding) if (claim.root === root && claim !== active.getStore()) {
      if (claim.key !== key) throw new Error('Joint reservation physical incarnation changed');
      bytes += claim.bytes; records += claim.records;
    }
    if (!Number.isSafeInteger(bytes) || bytes > budget.bytes || !Number.isSafeInteger(records) || records > budget.records) throw new Error('Joint reservation budget exceeded');
    return { fingerprint: physical.fingerprint, bytes, records };
  };
  const scan = async (root: string, budget: RecoveryBudget) => withLayerFileOperation(() => run(async () => effective(root, budget, await physicalScan(root, budget))));
  const reserve = <T>(root: string, budget: RecoveryBudget, bytes: number, records: number, operation: (control?: ReservationPhysicalControl) => Promise<T>, onFailure?: ReservationFailureHandler, suppliedQuote?: ResourceReservationQuote): Promise<T> => {
    budget = { ...budget };
    const owner = scopes.getStore();
    // Standalone requests retain the original queue-wide lifetime. Re-enter
    // with an owning scope so the same explicit settlement applies everywhere.
    if (!owner) return withLayerFileOperation(() => run(() => reserve(root, budget, bytes, records, operation, onFailure, suppliedQuote)));
    if (owner.closed) return Promise.reject(new Error('Closed joint accounting scope'));
    const registered: Task = { settled: false, admitted: false, failed: false, handled: false };
    owner.tasks.add(registered);
    const bound = suppliedQuote && quotes.get(suppliedQuote);
    const usable = !!bound && !bound.used && bound.scope === owner && bound.root === root && bound.bytes === bytes && bound.records === records && isDeepStrictEqual(bound.budget, budget);
    if (usable) bound!.used = true;
    const task = !owner.accepting
      ? Promise.reject<T>(new Error('Joint accounting scope closing; new reservation refused'))
      : withLayerFileOperation(() => run(async () => {
    const scope = scopes.getStore()!;
    if (!scope.accepting) throw new Error('Joint accounting scope closing; unadmitted reservation refused');
    if (onFailure !== undefined && typeof onFailure !== 'function') throw new Error('Main failure handler required');
    if (![bytes, records].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Finite joint reservation budget required');
    // No implicit parent-to-child allocation. A live parent peak is still
    // spendable and its materialization cannot be inferred from a nested scan.
    // Production issue/capture/seal acquire sequential caller-boundary claims.
    // Nested consumers must explicitly define allocation before using this API.
    if (active.getStore()) throw new Error('Nested joint reservation requires explicit allocation');
    const before = await physicalScan(root, budget), used = await effective(root, budget, before);
    let durable: { group: Group; writer: ReturnType<typeof createRecoveryClaimRecords>; plan: ReturnType<ReturnType<typeof createRecoveryClaimRecords>['plan']>; claimId: string; directories: number } | undefined;
    if (options.claimWriter) {
      if (!usable || !bound || bound.key !== before.key) throw new Error('Original Main producer quote required');
      const current = (await contentNative.request({ phase: 'capturePolicy', sources: bound.live.observed.map((row: any) => row[0]), sourceByteLimit: budget.bytes })).sourcePolicy;
      if (!isDeepStrictEqual(current, bound.live)) throw new Error('Producer source observations changed before admission');
      const writer = options.claimWriter(root, bound.restrictions);
      let group = scope.groups.get(root);
      if (!group) { group = { key: before.key, scopeId: randomUUID(), budget: { ...budget }, writer, members: [], claims: new Set(), closed: false }; scope.groups.set(root, group); }
      if (group.closed || group.key !== before.key || !isDeepStrictEqual(group.budget, budget)) throw new Error('Original resource group changed');
      const claimId = randomUUID(), plan = writer.plan({ workspaceKey: before.key, scopeId: group.scopeId, claimId, effectPeak: bytes, reservation: { records, before: { bytes: before.bytes, records: before.records, fingerprint: before.fingerprint } } });
      durable = { group, writer, plan, claimId, directories: Number(before.originAbsent) + Number(before.registryAbsent) };
    }
    const peakBytes = bytes + (durable ? durable.plan.claimPeak + durable.plan.closePeak + durable.directories * 32768 : 0);
    const peakRecords = records + (durable ? 2 + durable.directories : 0);
    if (!Number.isSafeInteger(used.bytes + peakBytes) || used.bytes + peakBytes > budget.bytes || !Number.isSafeInteger(used.records + peakRecords) || used.records + peakRecords > budget.records) throw new Error('Joint reservation peak budget exceeded');
    const key = await originWorkspaceKey(root);
    if (!scope.accepting) throw new Error('Joint accounting scope closing; unadmitted reservation refused');
    if (key !== before.key) throw new Error('Joint reservation physical incarnation changed');
    const claim: Claim = { root, key, bytes: peakBytes, records: peakRecords, scope, beforeBytes: before.bytes, beforeRecords: before.records, effectBeforeBytes: before.bytes, effectBeforeRecords: before.records, effectPeak: bytes, effectRecords: records, peakBytes, peakRecords, reconciled: false, exceeded: false, physicalUnknown: false, effectSettled: false };
    scopes.getStore()!.claims.add(claim); outstanding.add(claim);
    if (durable) {
      durable.group.claims.add(claim);
      const admission = await durable.writer.admit({ workspaceKey: key, scopeId: durable.group.scopeId, claimId: durable.claimId, plan: durable.plan, lifecycle: true,
        reservation: { records, before: { bytes: before.bytes, records: before.records, fingerprint: before.fingerprint } },
        allowance: { bytes: budget.bytes - used.bytes + before.originBytes, records: budget.records - used.records + before.originRecords } });
      durable.group.members.push(admission);
      const control = await physicalScan(root, budget);
      if (control.key !== key || control.projectFingerprint !== before.projectFingerprint || control.originFingerprint !== admission.census.fingerprint || control.originBytes !== admission.census.bytes || control.originRecords !== admission.census.records) throw new Error('Control materialization joint census changed');
      const deltaBytes = control.bytes - before.bytes, deltaRecords = control.records - before.records;
      if (deltaBytes < 0 || deltaRecords < 0) throw new Error('Control baseline changed');
      if (deltaBytes > durable.plan.claimPeak + durable.directories * 32768 || deltaRecords > 1 + durable.directories) { claim.exceeded = true; throw new Error('Control materialization exceeded peak'); }
      claim.effectBeforeBytes = control.bytes; claim.effectBeforeRecords = control.records;
      claim.bytes = peakBytes - deltaBytes; claim.records = peakRecords - deltaRecords;
    }
    registered.admitted = true;
    return active.run(claim, async () => {
      let failed = false;
      const control: ReservationPhysicalControl = Object.freeze({ unknown: () => {
        if (active.getStore() !== claim || scopes.getStore() !== scope || claim.effectSettled || scope.closed || !outstanding.has(claim)) throw new Error('Original active physical reservation required');
        // One-way evidence from the original Main callback, not new authority.
        claim.physicalUnknown = true; claim.reconciled = false;
      } });
      try { return await operation(control); }
      catch (error) { failed = true; throw error; }
      finally {
        claim.effectSettled = true;
        // Convert only this operation's observed materialization, not subsequent
        // captures, to used bytes. Keep unspent peak until the entire original
        // scope/native workers really settle. On unknown, retain the full claim.
        try {
          assertNativeWorkersSettled();
          if (claim.exceeded) throw new Error('Joint reservation materialization exceeded peak');
          if (claim.physicalUnknown) throw new Error('Original physical reservation outcome unknown; envelope retained');
          const after = await physicalScan(root, budget);
          if (await originWorkspaceKey(root) !== claim.key) throw new Error('Joint reservation physical incarnation changed');
          if (claim.exceeded || after.bytes - claim.effectBeforeBytes > bytes || after.records - claim.effectBeforeRecords > records) { claim.exceeded = true; throw new Error('Joint reservation materialization exceeded peak'); }
          claim.bytes = Math.max(0, peakBytes - Math.max(0, after.bytes - before.bytes));
          claim.records = Math.max(0, peakRecords - Math.max(0, after.records - before.records));
          claim.reconciled = true;
        } catch (error) { if (!failed) throw error; }
      }
    });
    }));
    const settlement = task.then(() => { registered.settled = true; }, async error => {
      registered.failed = true; registered.error = error;
      try {
        if (onFailure) {
          try { await onFailure(error); registered.handled = true; }
          catch (handlerError) { registered.error = handlerError; }
        }
      } finally { registered.settled = true; }
    });
    owner.pending.add(settlement);
    void settlement.then(() => owner.pending.delete(settlement), () => owner.pending.delete(settlement));
    // Always expose the original result. Only the private ledger decides
    // whether a predeclared disposition completed; Promise consumers cannot.
    return task;
  };
  const originAllowance = async (root: string, budget: RecoveryBudget) => withLayerFileOperation(() => run(async () => {
    const physical = await physicalScan(root, budget), used = await effective(root, budget, physical);
    // Native origin writes receive only the project/other-reservations-adjusted
    // allowance, never the workspace's full budget as a second independent cap.
    return { bytes: budget.bytes - used.bytes + physical.originBytes, records: budget.records - used.records + physical.originRecords, originAbsent: physical.originAbsent, registryAbsent: physical.registryAbsent };
  }));
  const finish = async (scope: Scope) => {
    let failure: { error: unknown } | undefined;
    for (const [root, group] of scope.groups) {
      if (!group.claims.size) { group.closed = true; continue; }
      try {
        await withLayerFileOperation(async () => {
          assertNativeWorkersSettled();
          if (group.members.length !== group.claims.size || [...group.claims].some(claim => !claim.reconciled && !claim.exceeded)) throw new Error('Original resource scope settlement unknown or exceeded');
          if ([...group.claims].some(claim => claim.physicalUnknown)) throw new Error('Original physical reservation outcome unknown; scope cannot close');
          const exceeded = [...group.claims].some(claim => claim.exceeded);
          const census = await physicalScan(root, group.budget);
          if (exceeded) {
            const rows = await options.claimRecords!(root).read({ workspaceKey: group.key, scopeId: group.scopeId, claimId: 'exceeded-census', plan: { effectPeak: 1, claimPeak: 65536, closePeak: 65536 }, allowance: group.budget });
            if (!group.writer.ownsScopeRows(group.members, rows.filter(row => row.scopeComplete !== true))) throw new Error('Original exceeded scope members changed');
          } else await effective(root, group.budget, census);
          const foreign = [...outstanding].filter(claim => claim.root === root && claim.scope !== scope);
          const allowance = { bytes: group.budget.bytes - (census.bytes - census.originBytes) - foreign.reduce((sum, claim) => sum + claim.bytes, 0),
            records: group.budget.records - (census.records - census.originRecords) - foreign.reduce((sum, claim) => sum + claim.records, 0) };
          await group.writer.closeScope({ members: group.members, census: { bytes: census.bytes, records: census.records, fingerprint: census.fingerprint }, allowance, exceeded,
            originBefore: {bytes:census.originBytes,records:census.originRecords,fingerprint:census.originFingerprint} });
          const rows = await options.claimRecords!(root).read({ workspaceKey: group.key, scopeId: group.scopeId, claimId: 'scope-readback', plan: { effectPeak: 1, claimPeak: 65536, closePeak: 65536 }, allowance });
          const own = rows.filter(row => row.claim.scopeId === group.scopeId);
          if (exceeded) {
            if (own.length !== group.members.length || own.some(row => row.closed?.state !== 'exceeded' || row.scopeComplete === true)) throw new Error('Exceeded terminal readback incomplete');
            // Preserve the measured failure forever; writing its terminal is
            // evidence, never release or capacity for a subsequent operation.
            throw new Error('Original resource scope settlement unknown or exceeded');
          }
          if (own.length !== group.members.length || rows.some(row => row.scopeComplete !== true)) throw new Error('Independent resource scope readback incomplete');
          const after = await physicalScan(root, group.budget), terminal = group.writer.closedCensus(group.members);
          if (after.key !== group.key || after.projectFingerprint !== census.projectFingerprint || after.originFingerprint !== terminal.fingerprint || after.originBytes !== terminal.bytes || after.originRecords !== terminal.records) throw new Error('Scope terminal joint inventory changed');
          const previous = controlTransitions.get(root);
          controlTransitions.set(root, { key: group.key, before: previous?.key === group.key && previous.after === census.fingerprint ? previous.before : census.fingerprint, after: after.fingerprint });
          group.closed = true;
        });
      } catch (error) { for (const claim of group.claims) claim.reconciled = false; failure ??= { error }; }
    }
    if ([...scope.claims].some(claim => claim.physicalUnknown)) failure ??= { error: new Error('Original physical reservation outcome unknown; scope cannot settle') };
    if (failure) throw failure.error;
  };
  return Object.assign(scan, { run, quote, reserve, originAllowance, isControlOnlyChange });
};
