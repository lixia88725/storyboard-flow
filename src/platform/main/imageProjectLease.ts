import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {WorkspaceOutputBudget}from'../../project-files/main/image-engine/workspaceOutputContract.js';
import {readBoundFile}from'../../project-files/main/persistence/fileOps.js';
import {canonicalUtf8,sha256Hex}from'../../project-files/main/persistence/canonicalJson.js';
import {validWorkspaceColdCopyAuthorization,validWorkspaceColdCopyReceipt,coldCopyReceipt,type WorkspaceColdCopyAuthorization,type WorkspaceColdCopyReceipt}from'../../project-files/main/image-engine/workspaceColdCopyContract.js';

export type ImageProjectRootBinding = { path: string; dev: string; ino: string };
export type ImageProjectLeaseLoss = { reason: string; guardPid: number; ownerNonce: string; effect: 'unknown' };
export type ImageProjectLease = {
  readonly guardPid: number;
  readonly ownerNonce: string;
  readonly held: boolean;
  readonly copyReceipt?: WorkspaceColdCopyReceipt;
  /** Await immediately before each new project write. Does not cancel already accepted work. */
  assertHeld(root?: ImageProjectRootBinding): Promise<void>;
  /** Caller MUST drain accepted obligations first. Abnormal loss cannot masquerade as release. */
  release(): Promise<void>;
  onInvalidated(listener: (loss: ImageProjectLeaseLoss) => void): () => void;
};
const failure = (message: string) => Object.assign(Error(message), { code: 'writer-lease-unavailable', effect: 'unknown' as const });

/** Real cross-process advisory lease Adapter. Native guard owns the fixed OS lock and
 * a durable Main-owner marker. Guard loss closes this gate immediately; its stale marker
 * also prevents another guard while this Main is alive (including in-flight filesystem work).
 * No lock deletion, PID-based stealing, timeout cancellation or project-close certification.
 */
export async function acquireImageProjectLease(options: {
  root: string;
  binary: string;
  timeoutMs?: number;
  onInvalidated?(loss: ImageProjectLeaseLoss): void;
  copyAdmission?:WorkspaceColdCopyAuthorization;
  /** Same Main broker. Reserves acquisition and a lifetime 32KiB release grant. */
  budget?:WorkspaceOutputBudget;
  /** Synthetic fault boundary; never supplied by product UI. */
  copyFault?:'after-evidence'|'after-owner';
}): Promise<ImageProjectLease> {
  // Capture configuration before the first asynchronous filesystem check.
  const { root, binary, onInvalidated,budget,copyFault } = options,copyAdmission=options.copyAdmission===undefined?undefined:structuredClone(options.copyAdmission), timeoutMs = options.timeoutMs ?? 5000;
  if (!['darwin', 'linux'].includes(process.platform)) throw failure('Project writer lease is unavailable on this platform');
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root || root === path.parse(root).root || root.includes('\0') || typeof binary !== 'string' || !path.isAbsolute(binary) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw failure('Invalid project lease options');
  const stat = await lstat(root, { bigint: true });
  const rootBinding: ImageProjectRootBinding = { path: root, dev: String(stat.dev), ino: String(stat.ino) };
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw failure('Canonical ordinary project directory required');
  if(copyAdmission&&(!validWorkspaceColdCopyAuthorization(copyAdmission)||!budget||copyAdmission.currentRoot.path!==root||copyAdmission.currentRoot.dev!==rootBinding.dev||copyAdmission.currentRoot.ino!==rootBinding.ino)||copyFault&&!copyAdmission)throw failure('Explicit copy authorization, current root and shared budget required');
  const namespace=path.join(root,'.storyboard-flow/image-project-v2'),ownerNonce=randomUUID();let namespaceIdentity:{dev:number;ino:number}|undefined;
  const measure=async()=>{const current=await lstat(root,{bigint:true});if(String(current.dev)!==rootBinding.dev||String(current.ino)!==rootBinding.ino||!current.isDirectory()||current.isSymbolicLink())throw failure('Lease budget root identity changed');let total=0;try{const directory=await lstat(namespace);if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(namespace)!==namespace)throw failure('Lease namespace alias');if(namespaceIdentity&&(namespaceIdentity.dev!==directory.dev||namespaceIdentity.ino!==directory.ino))throw failure('Lease namespace identity changed');namespaceIdentity??={dev:directory.dev,ino:directory.ino};for(const name of await readdir(namespace)){const entry=await lstat(path.join(namespace,name));if(entry.isSymbolicLink())throw failure('Lease budget alias');if(entry.isFile())total+=entry.size;}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return total;};
  const before=budget?await measure():0,oldMarker=budget?await readBoundFile(path.join(namespace,'owner.json'),16384).then(b=>b?sha256Hex(b):null):null;
  const grant=budget?await budget.reserve({operationId:'lease-acquire-'+ownerNonce,bytes:copyAdmission?65536:32768,purpose:copyAdmission?'native-cold-copy-bootstrap':'native-lease-acquire'}):undefined;
  let releaseGrant:Awaited<ReturnType<WorkspaceOutputBudget['reserve']>>|undefined;try{if(budget)releaseGrant=await budget.reserve({operationId:'lease-release-'+ownerNonce,bytes:32768,purpose:'native-lease-release'});}catch(e){await grant?.settleActual(0);throw e;}
  const args=[root,ownerNonce,...(copyAdmission?['--copy-admission',canonicalUtf8(copyAdmission).toString()]:[]),...(copyFault?['--copy-fault',copyFault]:[])];
  const child = spawn(binary,args,{ stdio: ['pipe', 'pipe', 'pipe'] });let copyReceipt:WorkspaceColdCopyReceipt|undefined,refusedWithoutEffects=false;
  const settleBudget=async(g:NonNullable<typeof grant>,baseline:number)=>{const now=await measure();await g.settleActual(now-baseline);};
  const settleFailedBudget=async(g:NonNullable<typeof grant>,baseline:number)=>{try{const bytes=await readBoundFile(path.join(namespace,'owner.json'),16384),same=bytes?sha256Hex(bytes)===oldMarker:oldMarker===null,marker=bytes?JSON.parse(bytes.toString()):null;if(!same&&marker?.nonce!==ownerNonce)throw failure('A different owner prevents budget settlement');await settleBudget(g,baseline);}catch{await g.retainUnknown();}};

  let phase: 'starting' | 'held' | 'releasing' | 'released' | 'invalidated' = 'starting';
  let sequence = 0, buffered = Buffer.alloc(0), diagnostics = '', everHeld = false, releaseAcknowledged = false;
  let loss: ImageProjectLeaseLoss | undefined;
  const listeners = new Set<(loss: ImageProjectLeaseLoss) => void>();
  if (onInvalidated) listeners.add(onInvalidated);
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  let pending: { id: number; kind: 'check' | 'release'; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined;
  let checkPromise: Promise<void> | undefined, releasePromise: Promise<void> | undefined;
  const alive = () => child.exitCode === null && child.signalCode === null && !child.killed;
  const invalidate = (reason: string) => {
    if (phase === 'released' || phase === 'invalidated') return;
    phase = 'invalidated'; clearTimeout(startupTimer);
    loss = { reason, guardPid: child.pid ?? -1, ownerNonce, effect: 'unknown' };
    const error = failure(reason); readyReject(error);
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
    if (everHeld) for (const listener of [...listeners]) try { void Promise.resolve(listener({ ...loss })).catch(() => {}); } catch { /* A gate stays closed if its observer fails. */ }
    // Only this Adapter's own child. Marker remains held; this is not normal release.
    if (alive()) child.kill('SIGKILL');
  };
  const startupTimer = setTimeout(() => invalidate('Project lease startup timed out; result retained/unknown'), timeoutMs);
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    child.once('exit', (code, signal) => {
      clearTimeout(startupTimer);
      if (phase !== 'releasing' || code !== 0 || signal !== null) invalidate(`Project lease guard exited (${code ?? signal}); ${diagnostics}`);
    });
    child.once('close', (code, signal) => {
      if (phase === 'releasing' && releaseAcknowledged && code === 0 && signal === null) phase = 'released';
      else if (phase !== 'released' && phase !== 'invalidated') invalidate(`Project lease guard closed (${code ?? signal}); ${diagnostics}`);
      resolve({ code, signal });
    });
  });
  child.on('error', error => invalidate('Project lease spawn failed: ' + String(error)));
  child.stdin.on('error', error => invalidate('Project lease input failed: ' + String(error)));
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-4096); });
  child.stdout.on('data', (chunk: Buffer) => {
    if (phase === 'invalidated' || phase === 'released') return;
    try {
      if (buffered.length + chunk.length > 32768) throw Error('Lease response exceeds budget');
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const end = buffered.indexOf(10); if (end < 0) { if (buffered.length > 16384) throw Error('Lease line exceeds budget'); break; }
        if (end > 16384) throw Error('Lease line exceeds budget');
        const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(0, end)));
        buffered = buffered.subarray(end + 1);
        if (!reply || reply.protocol !== 1 || reply.nonce !== ownerNonce) throw Error('Lease response identity mismatch');
        if (phase === 'starting') {
          if(reply.kind==='refused'&&reply.effect==='none')refusedWithoutEffects=true;
          if (reply.kind !== 'held' || reply.ownerPid !== process.pid || reply.guardPid !== child.pid || reply.root?.path !== rootBinding.path || reply.root?.dev !== rootBinding.dev || reply.root?.ino !== rootBinding.ino) throw Error('Lease not acquired: ' + String(reply.message ?? reply.kind));
          if(reply.copyReceipt!==null&&reply.copyReceipt!==undefined){if(!validWorkspaceColdCopyReceipt(reply.copyReceipt)||reply.copyReceipt.currentRoot.dev!==rootBinding.dev||reply.copyReceipt.currentRoot.ino!==rootBinding.ino)throw failure('Invalid copy lease receipt');copyReceipt=reply.copyReceipt;}
          if(copyAdmission&&(!copyReceipt||sha256Hex(canonicalUtf8(copyReceipt))!==sha256Hex(canonicalUtf8(coldCopyReceipt(copyAdmission)))))throw failure('Copy lease receipt differs from authorization');
          clearTimeout(startupTimer); phase = 'held'; everHeld = true; readyResolve();
        } else {
          if (reply.kind === 'invalidated') throw Error('Lease identity invalidated: ' + String(reply.message));
          if (!pending || reply.id !== pending.id || reply.kind !== (pending.kind === 'check' ? 'checked' : 'released')) throw Error('Unexpected lease response');
          const work = pending; pending = undefined; clearTimeout(work.timer);
          if (work.kind === 'release') releaseAcknowledged = true;
          work.resolve();
        }
      }
    } catch (error) { invalidate(String(error)); }
  });
  child.stdout.on('end', () => { if (!releaseAcknowledged) invalidate('Lease output disconnected without release'); });
  const admissionHeld=()=>phase==='held'&&alive();
  try{await ready;if(grant)await settleBudget(grant,before);if(!admissionHeld())throw failure('Lease lost before admission returned');}catch(e){invalidate('Lease startup failed: '+String(e));await exited;if(grant){if(refusedWithoutEffects)await grant.settleActual(0);else await settleFailedBudget(grant,before);}await releaseGrant?.settleActual(0);throw e;}
  const request = (kind: 'check' | 'release', binding?: ImageProjectRootBinding): Promise<void> => {
    if (!alive() || pending || phase === 'invalidated' || phase === 'released') return Promise.reject(failure(loss?.reason ?? 'Lease is not available'));
    if (sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(failure('Lease request sequence exhausted'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => invalidate('Lease response timed out; ownership unknown'), timeoutMs);
      pending = { id, kind, resolve, reject, timer };
      child.stdin.write(JSON.stringify({ kind, id, nonce: ownerNonce, ...(binding ? { root: binding } : {}) }) + '\n', error => { if (error) invalidate(String(error)); });
    });
  };
  const isReleased = () => phase === 'released';
  return {
    guardPid: child.pid!, ownerNonce,copyReceipt,
    get held() { return phase === 'held' && alive(); },
    assertHeld(binding) {
      if (binding !== undefined && (!binding || typeof binding !== 'object' || binding.path !== rootBinding.path || binding.dev !== rootBinding.dev || binding.ino !== rootBinding.ino))
        return Promise.reject(failure('Project writer lease root binding mismatch'));
      const captured = binding ? { path: binding.path, dev: binding.dev, ino: binding.ino } : undefined;
      if (phase !== 'held') return Promise.reject(failure(loss?.reason ?? 'Lease is not held'));
      if (!alive()) { invalidate('Lease guard is not alive'); return Promise.reject(failure(loss?.reason ?? 'Lease is not held')); }
      if (!checkPromise) checkPromise = request('check', captured).then(() => {
        if (phase !== 'held' || !alive()) throw failure('Lease lost while checking ownership');
      }).finally(() => { checkPromise = undefined; });
      return checkPromise;
    },
    release() {
      if (releasePromise) return releasePromise;
      if (phase === 'released') return Promise.resolve();
      if (phase !== 'held' || !alive()) return Promise.reject(failure('Invalidated lease cannot certify a normal release'));
      if (checkPromise) return Promise.reject(failure('Finish pending ownership checks before release'));
      releasePromise = (async () => {
        const baseline=budget?await measure():0,g=releaseGrant;if(phase!=='held'||!alive()||checkPromise){throw failure('Lease changed before release admission');}phase='releasing';try{
        // The caller drained obligations; no new writes/checks are admitted after this call.
        await request('release'); child.stdin.end();
        const exit = await exited;
        if (!isReleased() || exit.code !== 0 || exit.signal !== null) throw failure(loss?.reason ?? 'Lease release was not confirmed');
        if(g)await settleBudget(g,baseline);listeners.clear();
        }catch(e){invalidate('Lease release failed: '+String(e));if(g){await exited;await settleFailedBudget(g,baseline);}throw e;}
      })().catch(e=>{if(phase==='held')releasePromise=undefined;throw e;});
      return releasePromise;
    },
    onInvalidated(listener) {
      if (loss) { try { void Promise.resolve(listener({ ...loss })).catch(() => {}); } catch { /* Notification failure cannot reopen the gate. */ } return () => {}; }
      if (phase === 'released') return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
  };
}
