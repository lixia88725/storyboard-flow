import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession.js';
import { originWorkspaceKey, type OriginWorkspaceAccounting } from './originWorkspaceAccounting.js';
import { hasOriginalOwnedStageProvenance, copyOriginalOwnedStageReceipt } from './ownedStagePublication.js';
import { recoveryPolicyKey } from './recoveryPolicyPartition.js';
import { withLayerFileOperation } from './layerFileOperationQueue.js';
import type { RecoveryBudget } from './workspaceRecoveryStore.js';

export type OriginCapture = {
  operationId: string; generationId: string; sealDigest: string;
  contentDigest: string; revision: string; format: 'v1' | 'v2'; policyKey: string | null;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
const captureFingerprint = (capture: OriginCapture) => {
  if (!capture || Object.keys(capture).sort().join(',') !== 'contentDigest,format,generationId,operationId,policyKey,revision,sealDigest'
    || ![capture.operationId, capture.generationId].every(v => typeof v === 'string' && /^[\w-]{1,80}$/.test(v))
    || !hex(capture.sealDigest) || !hex(capture.contentDigest) || typeof capture.revision !== 'string' || !capture.revision
    || !(capture.format === 'v1' && capture.policyKey === null || capture.format === 'v2' && hex(capture.policyKey))) throw new Error('Exact verified origin capture required');
  return hash(canonical(capture));
};

/** Main-only producer bridge, never an IPC DTO accepting renderer paths/policy.
 * The callback is the real Main retainExact full-byte readback boundary. */
export const createOriginEnrollment = (options: {
  userData: () => string; python: string; script: string;
  accounting: OriginWorkspaceAccounting; budget: () => RecoveryBudget;
}) => {
  const native = createNativeAuthorizationSession(options.python, options.script, () => 65536);
  const cleanupNative = createNativeAuthorizationSession(options.python, path.join(path.dirname(options.script), 'owned-stage-cleanup.py'), () => 65536);
  const prepare = async (receipt: any, policy: any) => {
    if (!receipt || receipt.schema !== 'swb.owned-stage-publication.v1' || typeof receipt.root !== 'string' || typeof receipt.target !== 'string'
      || !path.isAbsolute(receipt.root) || path.normalize(receipt.root) !== receipt.root || !receipt.target.startsWith(receipt.root + path.sep)
      || path.normalize(receipt.target) !== receipt.target || typeof receipt.operation !== 'string' || !/^[\w-]{1,80}$/.test(receipt.operation)) throw new Error('Origin publication binding required');
    recoveryPolicyKey(policy);
    if (policy.schema !== 'swb.finite-source-policy' || policy.version !== 1 || !Array.isArray(policy.observed) || !policy.observed.length) throw new Error('Main complete origin source policy required');
    const workspaceKey = await originWorkspaceKey(receipt.root), sourceMode = policy.expected.mode & 0o600;
    if (![0o400, 0o600].includes(sourceMode)) throw new Error('Origin owner-only source mode unavailable');
    const sourceRestrictions = { ...structuredClone(policy.expected), acl: null };
    const payload = { schema: 'swb.workspace-origin-enrollment', version: 1, workspaceKey, operation: receipt.operation,
      receiptFingerprint: hash(JSON.stringify(receipt)), targetDigest: hash(receipt.target), sourceMode, state: 'issued', capturedDigest: null as string | null };
    const recordName = hash(JSON.stringify(['swb.workspace-origin-operation.v1', workspaceKey, receipt.operation]));
    return { root: receipt.root as string, sourceRestrictions, sourcePolicy: structuredClone(policy), payload, recordName };
  };
  type Prepared = Awaited<ReturnType<typeof prepare>>;
  const attributeBytes = (original: Prepared) => Object.entries(original.sourceRestrictions.xattrs as Record<string, string>).reduce((sum, [name, value]) => sum + Buffer.from(name, 'base64').length + Buffer.from(value, 'base64').length, 0);
  const request = async (original: Prepared, phase: 'issue' | 'seal' | 'confirm', capturedDigest: string | null) => {
    const payload = { ...original.payload, state: phase === 'issue' ? 'issued' : 'sealed', capturedDigest };
    if (await originWorkspaceKey(original.root) !== payload.workspaceKey) throw new Error('Origin workspace incarnation changed');
    const send = async () => {
      const allowance = await options.accounting.originAllowance(original.root, options.budget());
      const result = await native.request({ phase, userData: options.userData(), workspaceKey: payload.workspaceKey,
        recordName: original.recordName, payload, sourceMode: payload.sourceMode, sourceRestrictions: original.sourceRestrictions,
        byteLimit: allowance.bytes, recordLimit: allowance.records });
      if (await originWorkspaceKey(original.root) !== payload.workspaceKey) throw new Error('Origin workspace changed after native request');
      return result;
    };
    if (phase === 'confirm') return send();
    const before = await options.accounting.originAllowance(original.root, options.budget());
    // A fresh private workspace directory can carry OS-created attributes too.
    // Reserve its native observation ceiling; never assume mkdir is zero-byte.
    const directoryPeak = (Number(before.originAbsent) + Number(before.registryAbsent)) * 32768;
    const filePeak = Math.max(32768, Buffer.byteLength(canonical(payload)) + attributeBytes(original));
    const quote = await options.accounting.quote(original.root, options.budget(), filePeak + directoryPeak, 2, original.sourcePolicy);
    return options.accounting.reserve(original.root, options.budget(), filePeak + directoryPeak, 2, send, undefined, quote);
  };
  return {
    capture: async (receipt: unknown, policy: unknown, retainExact: () => Promise<OriginCapture>): Promise<OriginCapture> => withLayerFileOperation(() => options.accounting.run(async () => {
      if (!hasOriginalOwnedStageProvenance(receipt)) throw new Error('Unchanged original Main provenance required');
      const original = await prepare(copyOriginalOwnedStageReceipt(receipt), policy);
      await request(original, 'issue', null);
      const capture = await retainExact(), capturedDigest = captureFingerprint(capture);
      if (!hasOriginalOwnedStageProvenance(receipt)) throw new Error('Original Main receipt changed during capture');
      await request(original, 'seal', capturedDigest);
      return capture;
    })),
    cleanupCold: async (receipt: unknown, policy: unknown, capture: OriginCapture, onDispatch?: () => void) => {
     let dispatched = false, observedRepair: any;
     const unknown = (error: unknown) => ({ status: 'unknown' as const, cleanupOutcome: 'unknown' as const, auditOutcome: 'unknown' as const,
       ...(observedRepair ? { repair: observedRepair } : {}), error: error instanceof Error ? error.message : String(error) });
     let reportedUnknown: ReturnType<typeof unknown> | undefined;
     // Only the already-dispatched explicit cleanup has this failure route.
     // Reporting unknown preserves evidence; it is never a cleanup success,
     // caller-validity certificate, retry, or permission for another write.
     const cleanupFailed = async (error: unknown) => {
       if (!dispatched) throw error;
       reportedUnknown = unknown(error);
     };
     try { return await withLayerFileOperation(() => options.accounting.run(async () => {
      const original = await prepare(receipt, policy), capturedDigest = captureFingerprint(capture);
      await request(original, 'confirm', capturedDigest);
      const payload = { ...original.payload, state: 'sealed', capturedDigest };
      const checked = async (result: any) => {
        if (result.status === 'unknown') return { status: 'unknown' as const, cleanupOutcome: ['stage-absent','stage-removed'].includes(result.cleanupOutcome) ? result.cleanupOutcome as 'stage-absent' | 'stage-removed' : 'unknown' as const, auditOutcome: 'unknown' as const, error: String(result.error || 'Cleanup outcome unknown') };
        const repair = result.repair;
        if (!['repaired', 'reconciled', 'already-repaired'].includes(result.status) || !repair || repair.schema !== 'swb.owned-stage-repair.v1' || repair.version !== 1
          || repair.operation !== payload.operation || repair.receiptFingerprint !== payload.receiptFingerprint || repair.capturedDigest !== capturedDigest
          || repair.targetDigest !== payload.targetDigest || repair.stageAbsent !== true) throw new Error('Exact native repair receipt unavailable; effect unknown');
        observedRepair = repair;
        if (await originWorkspaceKey(original.root) !== payload.workspaceKey) throw new Error('Origin workspace changed after cleanup; effect unknown');
        return { status: result.status as 'repaired' | 'reconciled' | 'already-repaired', cleanupOutcome: result.status === 'repaired' ? 'stage-removed' as const : 'stage-absent' as const, auditOutcome: 'verified' as const, repair };
      };
      // Keep the same interpreter through read-only observation and actual
      // dispatch; an EOF/tail failure is never bypassed by a second adapter.
      return cleanupNative.run(async () => {
        const observeAllowance = await options.accounting.originAllowance(original.root, options.budget());
        const observed = await cleanupNative.request({ phase: 'observe', userData: options.userData(), workspaceKey: payload.workspaceKey,
          recordName: original.recordName, payload, sourceMode: payload.sourceMode, sourceRestrictions: original.sourceRestrictions,
          byteLimit: observeAllowance.bytes, recordLimit: observeAllowance.records, sourceByteLimit: options.budget().bytes, publication: receipt });
        if (observed.status === 'already-repaired') return checked(observed);
        if (observed.status !== 'cleanup-needed') throw new Error('Read-only cleanup observation unknown');
        // Only a real prospective effect reserves persistent control/audit
        // slots. A freshly certified already-repaired query stays write-free.
        const peak = 2 * Math.max(32768, 16384 + attributeBytes(original));
        const quote = await options.accounting.quote(original.root, options.budget(), peak, 3, original.sourcePolicy);
        return options.accounting.reserve(original.root, options.budget(), peak, 3, async () => {
          const allowance = await options.accounting.originAllowance(original.root, options.budget());
          dispatched = true;onDispatch?.();
          return checked(await cleanupNative.request({ phase: 'cleanup', userData: options.userData(), workspaceKey: payload.workspaceKey,
            recordName: original.recordName, payload, sourceMode: payload.sourceMode, sourceRestrictions: original.sourceRestrictions,
            byteLimit: allowance.bytes, recordLimit: allowance.records, sourceByteLimit: options.budget().bytes, publication: receipt }));
        }, cleanupFailed, quote);
      });
     })); } catch (error) {
       if (!dispatched) throw error;
       // A reported repair remains evidence, not success/next-write authority,
       // if late stdout/exit/close, ledger settlement or incarnation fails.
       return reportedUnknown ?? unknown(error);
     }
    },
    verifyCold: async (receipt: unknown, policy: unknown, capture: OriginCapture): Promise<boolean> => withLayerFileOperation(() => options.accounting.run(async () => {
      // Hashing cold public evidence is only an address/query. Authority comes
      // from the separate native private issued+sealed records, not self-marking.
      const original = await prepare(receipt, policy);
      await request(original, 'confirm', captureFingerprint(capture));
      return true;
    }))
  };
};
