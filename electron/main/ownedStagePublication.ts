import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** Native evidence, NOT a cleanup capability. Retry must reauthenticate it. */
export type OwnedStageMetadata = {
  dev: string; ino: string; uid: number; gid: number; mode: number; flags: number;
  links: number; size: number; mtimeNs: string; ctimeNs: string;
  acl: string | null; xattrs: Record<string, string>;
};
export type OwnedStagePublicationReceipt = {
  schema: 'swb.owned-stage-publication.v1'; operation: string;
  root: string; target: string; stage: string; creation: { dev: string; ino: string };
  stageBeforePublication: OwnedStageMetadata;
  targetAfterPublication: OwnedStageMetadata; stageAfterPublication: OwnedStageMetadata;
  parents: { path: string; before: OwnedStageMetadata; metadata: OwnedStageMetadata }[];
  bytes: { length: number; digest: string };
  publication: { method: 'link'; targetWasAbsent: true };
};
const exact = (value: any, fields: string[]): boolean => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k)));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const decimal = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);
const encoded = (value: unknown): value is string => typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value;
const metadata = (value: any): value is OwnedStageMetadata => exact(value, ['dev', 'ino', 'uid', 'gid', 'mode', 'flags', 'links', 'size', 'mtimeNs', 'ctimeNs', 'acl', 'xattrs']) &&
  decimal(value.dev) && decimal(value.ino) && ['uid', 'gid', 'mode', 'flags', 'links', 'size'].every(k => integer(value[k])) && value.mode <= 0o7777 && value.flags <= 0xffffffff && value.links > 0 &&
  ['mtimeNs', 'ctimeNs'].every(k => typeof value[k] === 'string' && /^-?\d+$/.test(value[k])) && (value.acl === null || encoded(value.acl) && value.acl.length > 0) &&
  Boolean(value.xattrs && typeof value.xattrs === 'object' && !Array.isArray(value.xattrs)) && Object.entries(value.xattrs).every(([key, value]) => key.length > 0 && encoded(key) && encoded(value));
const restrictions = (value: OwnedStageMetadata) => ({ dev: value.dev, ino: value.ino, uid: value.uid, gid: value.gid, mode: value.mode, flags: value.flags, acl: value.acl, xattrs: value.xattrs });

// Live original-response provenance, never a native permission/result cache.
// Public disk/IPC evidence cannot recreate the mark. Remember exact bytes too:
// mutating a marked object must not turn it into another original observation.
const originalReceipts = new WeakMap<object, string>();
export const hasOriginalOwnedStageProvenance = (value: unknown): value is OwnedStagePublicationReceipt => {
  if (!value || typeof value !== 'object') return false;
  const original = originalReceipts.get(value);
  if (original === undefined) return false;
  try { return JSON.stringify(value) === original; } catch { return false; }
};
export const copyOriginalOwnedStageReceipt = (value: OwnedStagePublicationReceipt): OwnedStagePublicationReceipt => {
  if (!hasOriginalOwnedStageProvenance(value)) throw new Error('Receipt lacks unchanged original Main provenance');
  const copy = structuredClone(value);
  originalReceipts.set(copy, originalReceipts.get(value)!);
  return copy;
};

/** Only called on the original private child response, with its Main request. */
export const authenticateOwnedStagePublication = (value: unknown, original: {
  operation: string; root: string; target: string; stage: unknown;
  identity: { dev: string; ino: string }; bytes: Buffer;
}): OwnedStagePublicationReceipt => {
  const fail = (): never => { throw new Error('Original owned-stage publication receipt mismatch'); };
  if (!exact(value, ['schema', 'operation', 'root', 'target', 'stage', 'creation', 'stageBeforePublication', 'targetAfterPublication', 'stageAfterPublication', 'parents', 'bytes', 'publication'])) return fail();
  const v = value as OwnedStagePublicationReceipt;
  if (Buffer.byteLength(JSON.stringify(v)) > 32768 || v.schema !== 'swb.owned-stage-publication.v1' || v.operation !== original.operation ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.operation) ||
      v.root !== original.root || v.target !== original.target || v.stage !== original.stage || typeof v.stage !== 'string' ||
      path.resolve(v.root) !== v.root || path.resolve(v.target) !== v.target || path.resolve(v.stage) !== v.stage ||
      !v.target.startsWith(v.root + path.sep) || v.stage === v.target || path.dirname(v.stage) !== path.dirname(v.target) || !/^\.layer-staging-.+$/.test(path.basename(v.stage)) ||
      !exact(v.creation, ['dev', 'ino']) || !isDeepStrictEqual(v.creation, original.identity) || !decimal(v.creation.dev) || !decimal(v.creation.ino) ||
      !exact(v.bytes, ['length', 'digest']) || v.bytes.length !== original.bytes.length || v.bytes.digest !== createHash('sha256').update(original.bytes).digest('hex') ||
      !exact(v.publication, ['method', 'targetWasAbsent']) || v.publication.method !== 'link' || v.publication.targetWasAbsent !== true) return fail();
  const before = v.stageBeforePublication, after = v.stageAfterPublication;
  if (![before, after, v.targetAfterPublication].every(metadata) || before.links !== 1 || after.links !== 2 || before.flags !== 0 || before.acl !== null || (before.mode & 0o7000) !== 0 ||
      !isDeepStrictEqual(after, v.targetAfterPublication) || !isDeepStrictEqual(restrictions(before), restrictions(after)) ||
      before.dev !== v.creation.dev || before.ino !== v.creation.ino || before.size !== original.bytes.length || after.size !== original.bytes.length || before.mtimeNs !== after.mtimeNs) return fail();
  const parents = [v.root];
  for (const part of path.relative(v.root, path.dirname(v.target)).split(path.sep).filter(Boolean)) parents.push(path.join(parents[parents.length - 1], part));
  if (!Array.isArray(v.parents) || v.parents.length !== parents.length || v.parents.some((entry, index) =>
    !exact(entry, ['path', 'before', 'metadata']) || entry.path !== parents[index] || !metadata(entry.before) || !metadata(entry.metadata) ||
    !isDeepStrictEqual(restrictions(entry.before), restrictions(entry.metadata)))) return fail();
  const receipt = structuredClone(v);
  originalReceipts.set(receipt, JSON.stringify(receipt));
  return receipt;
};
