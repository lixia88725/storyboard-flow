import { startImageEngine } from './imageEngineConnection.js';
import type { ImageProjectLease } from './imageProjectLease.js';

type Connection = ReturnType<typeof startImageEngine>;
export type ImageEngineWorkerHandle = { readonly generation: number; readonly connection: Connection };
const unavailable = () => Object.assign(Error('Image worker requires reconciliation'), { effect: 'unknown' as const });

/** Process ownership only. Restart never settles intents, replays input, releases the
 * project lease, or makes the project Session active. Those decisions belong to Main. */
export async function createImageEngineWorkerOwner(options: Parameters<typeof startImageEngine>[0] & {
  lease: Pick<ImageProjectLease, 'held' | 'assertHeld' | 'onInvalidated'>;
  onFault?(generation: number): void;
  startupTimeoutMs?: number;
}) {
  const { lease, onFault, startupTimeoutMs = 5000, ...config } = options;
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 30000)
    throw Error('Invalid worker startup timeout');
  let phase: 'recovering' | 'available' | 'closed' = 'recovering';
  let generation = 0, raw: Connection | undefined, handle: ImageEngineWorkerHandle | undefined;
  let restarting: Promise<ImageEngineWorkerHandle> | undefined;
  let leaseLost = false;
  function fault(target: number) {
    if (target !== generation || phase !== 'available') return;
    phase = 'recovering'; handle = undefined;
    // Admission is already closed. Defer observers to avoid reentrant restarts
    // before the replacement promise has been installed.
    queueMicrotask(() => { try { void Promise.resolve(onFault?.(target)).catch(() => {}); } catch { /* Gate stays closed. */ } });
  }
  const unsubscribe = lease.onInvalidated(() => {
    leaseLost = true; fault(generation);
    raw?.terminateOwnedProcess();
  });
  const closed = () => phase === 'closed';
  function restart(): Promise<ImageEngineWorkerHandle> {
    if (closed() || leaseLost || !lease.held) { fault(generation); return Promise.reject(unavailable()); }
    if (restarting) return restarting;
    // Fence every old handle BEFORE the first await, including in-flight responses.
    fault(generation); phase = 'recovering'; handle = undefined;
    const target = ++generation;
    restarting = (async () => {
      if (raw) { raw.terminateOwnedProcess(); await raw.exited; }
      if (closed() || leaseLost || !lease.held) throw unavailable();
      await lease.assertHeld();
      if (closed() || leaseLost || !lease.held) throw unavailable();
      const child = startImageEngine(config); raw = child;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([child.ready, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), startupTimeoutMs);
        })]);
        await lease.assertHeld();
        if (closed() || leaseLost || !lease.held || target !== generation) throw unavailable();
        const current = () => {
          if (!lease.held) fault(target);
          return lease.held && phase === 'available' && generation === target;
        };
        const connection: Connection = {
          ...child,
          supports: capability => current() && child.supports(capability),
          async request(...args) {
            if (!current()) throw unavailable();
            try {
              const result = await child.request(...args);
              if (!current()) throw unavailable();
              return result;
            } catch (error) {
              if ((error as { effect?: string })?.effect !== 'none') fault(target);
              throw error;
            }
          },
          terminateOwnedProcess() { fault(target); child.terminateOwnedProcess(); },
        };
        handle = Object.freeze({ generation: target, connection }); phase = 'available';
        void child.exited.then(() => fault(target));
        return handle;
      } catch (error) {
        child.terminateOwnedProcess(); await child.exited;
        throw error;
      } finally { clearTimeout(timer); }
    })().finally(() => { restarting = undefined; });
    return restarting;
  }
  /** Explicit process disposal, NOT a successful project close or cancelled operation. */
  async function dispose() {
    phase = 'closed'; handle = undefined; unsubscribe();
    raw?.terminateOwnedProcess();
    if (restarting) await restarting.catch(() => {});
    if (raw) await raw.exited;
  }
  try { await restart(); } catch (error) { await dispose(); throw error; }
  return { current: () => { if (!lease.held) fault(generation); return handle; }, restart, dispose };
}
