import { expect, it } from 'vitest';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { acquireImageProjectLease } from './imageProjectLease';
import { createImageEngineWorkerOwner } from './imageEngineWorkerOwner';

it('fences old handles and restarts the owned real worker without replaying or accepting a candidate', async () => {
  const binary = process.env.FLOW_IMAGE_HOST, guard = process.env.FLOW_PROJECT_LEASE_BINARY;
  if (!binary || !guard) throw Error('Real native host and project lease are required');
  const root = await temporaryWorkspace('worker-owner-');
  const lease = await acquireImageProjectLease({ root, binary: guard });
  const faults: number[] = [];
  const owner = await createImageEngineWorkerOwner({ binary, store: path.join(root, 'native'),
    sessionId: 'worker-owner', incarnation: 'same-main', budgetBytes: 32 * 1024 * 1024,
    lease, onFault: generation => faults.push(generation) });
  try {
    const first = owner.current()!;
    const created = await first.connection.request('new-document', { kind: 'new', width: 8, height: 8 });
    expect(created.header.body).toMatchObject({ kind: 'prepared' });
    const oldPending = first.connection.request('old-pending', { kind: 'status', targetOperationId: 'new-document' });
    const oldRefused = expect(oldPending).rejects.toMatchObject({ effect: 'unknown' });
    const restarting = owner.restart();
    expect(owner.current()).toBeUndefined();
    expect(owner.restart()).toBe(restarting);
    await expect(first.connection.request('late', { kind: 'capture' })).rejects.toMatchObject({ effect: 'unknown' });
    const second = await restarting;
    await oldRefused;
    expect(second.generation).toBe(first.generation + 1);
    expect(second.connection.pid).not.toBe(first.connection.pid);
    expect((await first.connection.exited).signal).toBe('SIGKILL');
    // The new worker can only report the existing journal; owner never accepts it.
    const status = await second.connection.request('status', { kind: 'status', targetOperationId: 'new-document' });
    expect(JSON.stringify(status.header.body)).toContain('prepared');
    expect(faults).toEqual([first.generation]);
    first.connection.terminateOwnedProcess(); // stale handle cannot close the new generation
    expect(owner.current()).toBe(second);
    const again = await second.connection.request('status-again', { kind: 'status', targetOperationId: 'new-document' });
    expect(again.header.body).toEqual(status.header.body);
    second.connection.terminateOwnedProcess();
    expect(owner.current()).toBeUndefined();
    await second.connection.exited;
    const third = await owner.restart();
    expect(third.generation).toBe(second.generation + 1);
    await owner.dispose();
    await expect(owner.restart()).rejects.toMatchObject({ effect: 'unknown' });
    expect(owner.current()).toBeUndefined();
    expect(lease.held).toBe(true); // no implicit project-close certification
  } finally { await owner.dispose(); await lease.release(); }
}, 15000);

it('never launches a replacement after the writer authority refuses it', async () => {
  const binary = process.env.FLOW_IMAGE_HOST;
  if (!binary) throw Error('Real native host is required');
  const root = await temporaryWorkspace('worker-authority-');
  let held = true;
  const owner = await createImageEngineWorkerOwner({ binary, store: path.join(root, 'native'),
    sessionId: 'worker-owner', incarnation: 'authority', budgetBytes: 32 * 1024 * 1024,
    onFault: async () => { throw Error('observer failed'); },
    lease: { held: true, async assertHeld() { if (!held) throw Error('writer lost'); }, onInvalidated() { return () => {}; } } });
  try {
    const first = owner.current()!; held = false;
    await expect(owner.restart()).rejects.toThrow('writer lost');
    expect(owner.current()).toBeUndefined();
    await first.connection.exited;
  } finally { await owner.dispose(); }
});

it('dispose during a pending authority check cannot resurrect a worker', async () => {
  const binary = process.env.FLOW_IMAGE_HOST;
  if (!binary) throw Error('Real native host is required');
  const root = await temporaryWorkspace('worker-dispose-');
  let checks = 0, entered!: () => void, release!: () => void;
  const checking = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const owner = await createImageEngineWorkerOwner({ binary, store: path.join(root, 'native'),
    sessionId: 'worker-owner', incarnation: 'dispose', budgetBytes: 32 * 1024 * 1024,
    lease: { held: true, async assertHeld() { if (++checks === 3) { entered(); await delayed; } }, onInvalidated() { return () => {}; } } });
  try {
    const old = owner.current()!, restarting = owner.restart();
    // Install a handler before rejecting the concurrent restart.
    const refused = expect(restarting).rejects.toMatchObject({ effect: 'unknown' });
    await checking;
    const disposing = owner.dispose();
    expect(owner.current()).toBeUndefined();
    release(); await disposing; await refused;
    expect(checks).toBe(3);
    await old.connection.exited;
    await expect(owner.restart()).rejects.toMatchObject({ effect: 'unknown' });
  } finally { release(); await owner.dispose(); }
});

it('lease invalidation immediately fences requests and permanently refuses restart', async () => {
  const binary = process.env.FLOW_IMAGE_HOST;
  if (!binary) throw Error('Real native host is required');
  const root = await temporaryWorkspace('worker-lease-loss-');
  let invalidate!: () => void;
  const owner = await createImageEngineWorkerOwner({ binary, store: path.join(root, 'native'),
    sessionId: 'worker-owner', incarnation: 'lost', budgetBytes: 32 * 1024 * 1024,
    lease: { held: true, async assertHeld() {}, onInvalidated(listener) {
      invalidate = () => listener({ reason: 'synthetic lease loss', guardPid: -1, ownerNonce: 'test', effect: 'unknown' });
      return () => {};
    } } });
  try {
    const old = owner.current()!;
    invalidate();
    expect(owner.current()).toBeUndefined();
    await expect(old.connection.request('late', { kind: 'capture' })).rejects.toMatchObject({ effect: 'unknown' });
    await expect(owner.restart()).rejects.toMatchObject({ effect: 'unknown' });
    await old.connection.exited;
  } finally { await owner.dispose(); }
});

it('refuses a retained handle after normal lease release even without an invalidation event', async () => {
  const binary = process.env.FLOW_IMAGE_HOST, guard = process.env.FLOW_PROJECT_LEASE_BINARY;
  if (!binary || !guard) throw Error('Real host and lease required');
  const root = await temporaryWorkspace('worker-released-');
  const lease = await acquireImageProjectLease({ root, binary: guard });
  const owner = await createImageEngineWorkerOwner({ binary, store: path.join(root, 'native'),
    sessionId: 'worker-owner', incarnation: 'released', budgetBytes: 32 * 1024 * 1024, lease });
  try {
    const old = owner.current()!;
    await lease.release(); // Deliberately wrong caller order; owner must still refuse new work.
    expect(owner.current()).toBeUndefined();
    await expect(old.connection.request('new-after-release', { kind: 'new', width: 8, height: 8 }))
      .rejects.toMatchObject({ effect: 'unknown' });
    await expect(owner.restart()).rejects.toMatchObject({ effect: 'unknown' });
  } finally { await owner.dispose(); if (lease.held) await lease.release(); }
});
