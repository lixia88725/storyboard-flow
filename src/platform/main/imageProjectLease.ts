import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export type ImageProjectRootBinding = { path: string; dev: string; ino: string };
export type ImageProjectLeaseLoss = { reason: string; guardPid: number; ownerNonce: string; effect: 'unknown' };
export type ImageProjectLease = {
  readonly guardPid: number;
  readonly ownerNonce: string;
  readonly held: boolean;
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
}): Promise<ImageProjectLease> {
  // Capture configuration before the first asynchronous filesystem check.
  const { root, binary, onInvalidated } = options, timeoutMs = options.timeoutMs ?? 5000;
  if (!['darwin', 'linux'].includes(process.platform)) throw failure('Project writer lease is unavailable on this platform');
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root || root === path.parse(root).root || root.includes('\0') || typeof binary !== 'string' || !path.isAbsolute(binary) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw failure('Invalid project lease options');
  const stat = await lstat(root, { bigint: true });
  const rootBinding: ImageProjectRootBinding = { path: root, dev: String(stat.dev), ino: String(stat.ino) };
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw failure('Canonical ordinary project directory required');
  const ownerNonce = randomUUID(), child = spawn(binary, [root, ownerNonce], { stdio: ['pipe', 'pipe', 'pipe'] });
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
      if (buffered.length + chunk.length > 8192) throw Error('Lease response exceeds budget');
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const end = buffered.indexOf(10); if (end < 0) { if (buffered.length > 4096) throw Error('Lease line exceeds budget'); break; }
        if (end > 4096) throw Error('Lease line exceeds budget');
        const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(0, end)));
        buffered = buffered.subarray(end + 1);
        if (!reply || reply.protocol !== 1 || reply.nonce !== ownerNonce) throw Error('Lease response identity mismatch');
        if (phase === 'starting') {
          if (reply.kind !== 'held' || reply.ownerPid !== process.pid || reply.guardPid !== child.pid || reply.root?.path !== rootBinding.path || reply.root?.dev !== rootBinding.dev || reply.root?.ino !== rootBinding.ino) throw Error('Lease not acquired: ' + String(reply.message ?? reply.kind));
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
  await ready;
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
    guardPid: child.pid!, ownerNonce,
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
      phase = 'releasing';
      releasePromise = (async () => {
        // The caller drained obligations; no new writes/checks are admitted after this call.
        await request('release'); child.stdin.end();
        const exit = await exited;
        if (!isReleased() || exit.code !== 0 || exit.signal !== null) throw failure(loss?.reason ?? 'Lease release was not confirmed');
        listeners.clear();
      })();
      return releasePromise;
    },
    onInvalidated(listener) {
      if (loss) { try { void Promise.resolve(listener({ ...loss })).catch(() => {}); } catch { /* Notification failure cannot reopen the gate. */ } return () => {}; }
      if (phase === 'released') return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
  };
}
