import { createNativeAuthorizationSession, NATIVE_AUTHORIZATION_TRANSPORT_BYTES } from './nativeAuthorizationSession.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** Main-private persistent resource claims. Capacity/lifecycle ONLY.
 *
 * Records live in the same fixed Main-private namespace as origin enrollment
 * records, so the existing origin census charges them inside the one approved
 * workspace total. They never grant provenance, stage cleanup, Save/ACK,
 * execution or replay authority, and this module never deletes or rewrites. */
export type ClaimPlan = { effectPeak: number; claimPeak: number; closePeak: number };
export type ClaimCensus = { bytes: number; records: number; fingerprint: string };
export type ClaimAllowance = { bytes: number; records: number };
export type ClaimReservation = { records: number; before: ClaimCensus };
export type ClaimScopeEnd = { memberCount: number; membersDigest: string; census: ClaimCensus; outcome: 'closed' | 'exceeded' };
export type ClaimAdmission = { recordName: string; census: ClaimCensus };
export type RecordRestrictions = { uid: number; gid: number; mode: number; flags: number; acl: string | null; xattrs: Record<string, string> };
type NativeRecordIdentity = { dev: string; ino: string; mtimeNs: string; ctimeNs: string };
type OwnedAdmission = { identity: NativeRecordIdentity; userData: string; payload: ClaimRecord & { schema: 'swb.workspace-claim.v3'; version: 3; reservation: ClaimReservation; recordPolicyFingerprint: string; scopeEnd: null }; restrictions: RecordRestrictions; digest: string; terminalCensus?: ClaimCensus; state: 'ready' | 'closing' | 'closed' | 'unknown' };
const ownedAdmissions = new WeakMap<ClaimAdmission, OwnedAdmission>();
export type ClaimState = 'reserved' | 'closed' | 'exceeded';
export type ClaimRecord = {
  scopeId: string; claimId: string; workspaceKey: string;
  effectPeak: number; claimPeak: number; closePeak: number;
  state: ClaimState; census: ClaimCensus | null;
  reservation?: ClaimReservation;
  recordPolicyFingerprint?: string;
  scopeEnd?: ClaimScopeEnd | null;
};
export type ClaimRead = { claim: ClaimRecord; closed: ClaimRecord | null; scopeComplete?: boolean; nativeIdentity?: NativeRecordIdentity };

const identity = (value: string) => /^[\w-]{1,80}$/.test(value);
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nativeIdentity = (value: any): value is NativeRecordIdentity => value && Object.keys(value).sort().join(',') === 'ctimeNs,dev,ino,mtimeNs' && Object.values(value).every(item => typeof item === 'string' && /^[0-9]+$/.test(item));
const canonical = (value: unknown): string => JSON.stringify(value === null || typeof value !== 'object' ? value
  : Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical((value as Record<string, unknown>)[key]))])));

export const createRecoveryClaimRecords = (options: {
  userData: () => string; python: string; script: string;
  restrictions?: () => RecordRestrictions;
}) => {
  const native = createNativeAuthorizationSession(options.python, options.script, () => NATIVE_AUTHORIZATION_TRANSPORT_BYTES);
  const restrictionsFor = () => {
    if (!options.restrictions) throw new Error('Native producer record restrictions required');
    return options.restrictions();
  };
  const sourceMode = () => {
    const restrictions = restrictionsFor();
    const mode = restrictions.mode & 0o600;
    if (![0o400, 0o600].includes(mode)) throw new Error('Owner-only claim record restriction required');
    return mode;
  };
  const payloadFor = (workspaceKey: string, scopeId: string, claimId: string, plan: ClaimPlan, state: ClaimState, census: ClaimCensus | null, reservation?: ClaimReservation, lifecycle = false, captured?: RecordRestrictions) => {
    if (!hex(workspaceKey) || !identity(scopeId) || !identity(claimId)) throw new Error('Claim workspace/scope/claim identity required');
    if (![plan.effectPeak, plan.claimPeak, plan.closePeak].every(finite)) throw new Error('Finite claim plan required');
    if (reservation !== undefined && (!finite(reservation?.records) || !finite(reservation?.before?.bytes) || !finite(reservation?.before?.records) || !hex(reservation?.before?.fingerprint))) throw new Error('Complete claim reservation baseline required');
    if (lifecycle && reservation === undefined) throw new Error('Lifecycle claim requires its original reservation');
    const restrictions = lifecycle ? captured ?? restrictionsFor() : null;
    const recordPolicyFingerprint = restrictions && createHash('sha256').update(JSON.stringify([restrictions.uid, restrictions.gid, restrictions.mode, restrictions.flags, restrictions.acl, Object.entries(restrictions.xattrs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])).digest('hex');
    return { schema: lifecycle ? 'swb.workspace-claim.v3' : reservation === undefined ? 'swb.workspace-claim.v1' : 'swb.workspace-claim.v2', version: lifecycle ? 3 : reservation === undefined ? 1 : 2, workspaceKey, scopeId, claimId,
      effectPeak: plan.effectPeak, claimPeak: plan.claimPeak, closePeak: plan.closePeak, state, census,
      ...(reservation === undefined ? {} : { reservation: { records: reservation.records, before: { ...reservation.before } } }),
      ...(lifecycle ? { recordPolicyFingerprint, scopeEnd: null } : {}) };
  };
  const send = async (request: Record<string, unknown>) => {
    if (!finite(request.byteLimit as number) || !Number.isSafeInteger(request.recordLimit) || (request.recordLimit as number) <= 0) throw new Error('Finite joint allowance required for claim records');
    return native.request(request);
  };
  const adapter = {
    closedCensus: (admissions: ClaimAdmission[]): ClaimCensus => {
      const members = admissions.map(admission => ownedAdmissions.get(admission));
      const first = members[0];
      if (!first?.terminalCensus || members.some(member => !member || member.state !== 'closed' || member.userData !== options.userData() || member.payload.workspaceKey !== first.payload.workspaceKey || member.payload.scopeId !== first.payload.scopeId || !isDeepStrictEqual(member.terminalCensus, first.terminalCensus))) throw new Error('Original closed scope census required');
      return { ...first.terminalCensus };
    },
    plan: (input: { workspaceKey: string; scopeId: string; claimId: string; effectPeak: number; reservation: ClaimReservation }): ClaimPlan => {
      const restrictions = restrictionsFor();
      const attributes = Object.entries(restrictions.xattrs).reduce((total, [key, value]) => total + Buffer.from(key, 'base64').length + Buffer.from(value, 'base64').length, 0);
      let plan = { effectPeak: input.effectPeak, claimPeak: 32768, closePeak: 32768 };
      // A size bound only, never passed off as an observed runtime census.
      const ceiling = { bytes: Number.MAX_SAFE_INTEGER, records: Number.MAX_SAFE_INTEGER, fingerprint: 'f'.repeat(64) };
      for (let attempt = 0; attempt < 8; attempt++) {
        const reserved = payloadFor(input.workspaceKey, input.scopeId, input.claimId, plan, 'reserved', null, input.reservation, true, restrictions);
        const terminal = { ...reserved, state: 'exceeded', census: ceiling, scopeEnd: { memberCount: Number.MAX_SAFE_INTEGER, membersDigest: 'f'.repeat(64), census: ceiling, outcome: 'exceeded' } };
        const next = { effectPeak: plan.effectPeak, claimPeak: Math.max(32768, Buffer.byteLength(canonical(reserved)) + attributes), closePeak: Math.max(32768, Buffer.byteLength(canonical(terminal)) + attributes) };
        if (!Object.values(next).every(finite)) throw new Error('Finite claim record funding required');
        if (next.claimPeak === plan.claimPeak && next.closePeak === plan.closePeak) return next;
        plan = next;
      }
      throw new Error('Claim record funding did not converge');
    },
    ownsScopeRows: (members: ClaimAdmission[], rows: ClaimRead[]): boolean => {
      if (!members.length || members.length !== rows.length || new Set(members).size !== members.length) return false;
      const owned = members.map(member => ownedAdmissions.get(member));
      if (owned.some(member => !member || member.state !== 'ready' || member.userData !== options.userData())) return false;
      const remaining = new Set(rows);
      for (const member of owned as OwnedAdmission[]) {
        const row = [...remaining].find(row => !row.closed && !row.scopeComplete && isDeepStrictEqual(
          Object.fromEntries(Object.keys(member.payload).map(key => [key, (row.claim as any)[key]])), member.payload));
        if (!row || !isDeepStrictEqual(row.nativeIdentity, member.identity) || createHash('sha256').update(canonical(member.payload)).digest('hex') !== member.digest) return false;
        remaining.delete(row);
      }
      return remaining.size === 0;
    },
    admit: async (input: { workspaceKey: string; scopeId: string; claimId: string; plan: ClaimPlan; allowance: ClaimAllowance; reservation?: ClaimReservation; lifecycle?: boolean }): Promise<ClaimAdmission> =>
      native.run(async () => {
        const restrictions = structuredClone(restrictionsFor()), userData = options.userData();
        const payload = payloadFor(input.workspaceKey, input.scopeId, input.claimId, input.plan, 'reserved', null, input.reservation, input.lifecycle, restrictions);
        const result = await send({ phase: 'admit', userData, workspaceKey: input.workspaceKey,
          claimName: await requireName(input.workspaceKey, input.scopeId, input.claimId), sourceMode: restrictions.mode & 0o600, sourceRestrictions: restrictions,
          payload, byteLimit: input.allowance.bytes, recordLimit: input.allowance.records });
        if (result.authorized !== true || typeof result.recordName !== 'string' || !hex(result.recordName.replace(/\.reserve$/, '')) || !finite(result.bytes) || !finite(result.records) || !hex(result.fingerprint)) throw new Error('Claim admission not certified');
        const admission: ClaimAdmission = { recordName: result.recordName, census: { bytes: result.bytes, records: result.records, fingerprint: result.fingerprint } };
        if (input.lifecycle) {
          if (!hex(result.reserveDigest) || !nativeIdentity(result.reserveIdentity)) throw new Error('Original reserve identity/digest not certified');
          ownedAdmissions.set(admission, { identity: structuredClone(result.reserveIdentity), userData, payload: structuredClone(payload) as OwnedAdmission['payload'], restrictions, digest: result.reserveDigest, state: 'ready' });
        }
        return admission;
      }),
    close: async (input: { workspaceKey: string; scopeId: string; claimId: string; plan: ClaimPlan; census: ClaimCensus; exceeded?: boolean; allowance: ClaimAllowance; reservation?: ClaimReservation }): Promise<ClaimCensus> =>
      native.run(async () => {
        if (!finite(input.census?.bytes) || !finite(input.census?.records) || !hex(input.census?.fingerprint)) throw new Error('Complete claim close census required');
        const payload = payloadFor(input.workspaceKey, input.scopeId, input.claimId, input.plan, input.exceeded ? 'exceeded' : 'closed', input.census, input.reservation);
        const result = await send({ phase: 'close', userData: options.userData(), workspaceKey: input.workspaceKey,
          claimName: await requireName(input.workspaceKey, input.scopeId, input.claimId), sourceMode: sourceMode(), sourceRestrictions: restrictionsFor(),
          payload, byteLimit: input.allowance.bytes, recordLimit: input.allowance.records });
        if (result.authorized !== true || !finite(result.bytes) || !finite(result.records) || !hex(result.fingerprint)) throw new Error('Claim close not certified');
        return { bytes: result.bytes, records: result.records, fingerprint: result.fingerprint };
      }),
    read: async (input: { workspaceKey: string; scopeId: string; claimId: string; plan: ClaimPlan; allowance: ClaimAllowance }): Promise<ClaimRead[]> =>
      native.run(async () => {
        const payload = options.restrictions ? payloadFor(input.workspaceKey, input.scopeId, input.claimId, input.plan, 'reserved', null) : null;
        const result = await send({ phase: 'read', userData: options.userData(), workspaceKey: input.workspaceKey,
          claimName: payload ? await requireName(input.workspaceKey, input.scopeId, input.claimId) : null, sourceMode: payload ? sourceMode() : null, sourceRestrictions: payload ? restrictionsFor() : null,
          payload, byteLimit: input.allowance.bytes, recordLimit: input.allowance.records });
        if (result.authorized !== true || !Array.isArray(result.claims)) throw new Error('Claim read not certified');
        return result.claims.map((entry: any) => {
          const {reserveIdentity: recordIdentity, ...stored}=entry;
          const claim = stored as ClaimRecord;
          if (typeof claim?.scopeId !== 'string' || typeof claim?.claimId !== 'string' || claim.workspaceKey !== input.workspaceKey
            || !['reserved', 'closed', 'exceeded'].includes(claim.state) || !finite(claim.effectPeak) || !finite(claim.claimPeak) || !finite(claim.closePeak)) throw new Error('Unknown claim record');
          const closed = entry.closed === null || entry.closed === undefined ? null : entry.closed as ClaimRecord;
          if (closed && (closed.state === 'reserved' || !finite(closed.census?.bytes) || !finite(closed.census?.records) || !hex(closed.census?.fingerprint))) throw new Error('Unknown claim terminal record');
          if (!nativeIdentity(recordIdentity)) throw new Error('Native reserve identity not certified');
          return { claim, closed, nativeIdentity: recordIdentity, ...(entry.version === 3 ? { scopeComplete: entry.scopeComplete === true } : {}) };
        });
      }),
    closeScope: async (input: { members: ClaimAdmission[]; census: ClaimCensus; allowance: ClaimAllowance; exceeded?: boolean; originBefore?: ClaimCensus }): Promise<ClaimRead[]> => native.run(async () => {
      if (!Array.isArray(input.members) || !input.members.length || new Set(input.members).size !== input.members.length || !finite(input.census?.bytes) || !finite(input.census?.records) || !hex(input.census?.fingerprint)) throw new Error('Original complete scope members and census required');
      const members = input.members.map(member => {
        const owned = ownedAdmissions.get(member);
        if (!owned || owned.state !== 'ready' || owned.userData !== options.userData()) throw new Error('Original Main scope admission required');
        return owned;
      });
      const first = members[0].payload;
      if (members.some(member => member.payload.workspaceKey !== first.workspaceKey || member.payload.scopeId !== first.scopeId)) throw new Error('Scope member Root/identity mismatch');
      const entries = members.map(member => [member.payload.claimId, member.digest]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const scopeIdentityDigest = createHash('sha256').update(canonical(members.map(member => [member.payload.claimId, member.digest, member.identity]).sort((a,b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))).digest('hex');
      const end: ClaimScopeEnd = { memberCount: members.length, membersDigest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), census: { ...input.census }, outcome: input.exceeded ? 'exceeded' : 'closed' };
      for (const member of members) member.state = 'closing';
      try {
        let terminalCensus: ClaimCensus | undefined;
        const starting = input.originBefore ?? await send({phase:'read',userData:options.userData(),workspaceKey:first.workspaceKey,claimName:null,sourceMode:null,sourceRestrictions:null,payload:null,byteLimit:input.allowance.bytes,recordLimit:input.allowance.records});
        let expectedInventory: ClaimCensus = {bytes:starting.bytes,records:starting.records,fingerprint:starting.fingerprint};
        for (let index = 0; index < members.length; index++) {
          const member = members[index], payload = { ...member.payload, state: end.outcome, census: end.census, scopeEnd: end };
          const pending = members.slice(index + 1), heldBytes = pending.reduce((sum, other) => sum + other.payload.closePeak, 0);
          if (!Number.isSafeInteger(heldBytes)) throw new Error('Unknown terminal slot total');
          const result = await send({ phase: 'close', userData: member.userData, workspaceKey: payload.workspaceKey,
            originalReserveIdentity: member.identity, scopeIdentityDigest, expectedInventory,
            claimName: await requireName(payload.workspaceKey, payload.scopeId, payload.claimId), sourceMode: member.restrictions.mode & 0o600, sourceRestrictions: member.restrictions, payload,
            byteLimit: input.allowance.bytes - heldBytes, recordLimit: input.allowance.records - pending.length });
          if (result.authorized !== true || result.appendOnly !== true || !finite(result.bytes) || !finite(result.records) || !hex(result.fingerprint)) throw new Error('Original scope terminal not certified');
          terminalCensus = { bytes: result.bytes, records: result.records, fingerprint: result.fingerprint };
          expectedInventory = {...terminalCensus};
        }
        const rows = (await adapter.read({ workspaceKey: first.workspaceKey, scopeId: first.scopeId, claimId: first.claimId, plan: first, allowance: input.allowance })).filter(row => row.claim.scopeId === first.scopeId);
        if (rows.length !== members.length || rows.some(row => !row.closed || !members.some(member=>member.payload.claimId===row.claim.claimId && isDeepStrictEqual(member.identity,row.nativeIdentity)) || row.closed.scopeEnd?.membersDigest !== end.membersDigest || (end.outcome === 'closed' && !row.scopeComplete))) throw new Error('Whole scope terminal readback not certified');
        for (const member of members) { member.state = 'closed'; member.terminalCensus = terminalCensus; }
        return rows;
      } catch (error) {
        for (const member of members) member.state = 'unknown';
        throw error;
      }
    })
  };
  return adapter;
  async function requireName(workspaceKey: string, scopeId: string, claimId: string) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(JSON.stringify(['swb.workspace-claim-name.v1', workspaceKey, scopeId, claimId])).digest('hex');
  }
};
