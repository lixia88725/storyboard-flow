import { afterEach, expect, it, vi } from 'vitest';
import { createRecoveryCloseBarrier } from './recoveryCloseBarrier';

afterEach(() => vi.useRealTimers());
const fixture = (certify = async () => true) => {
  const sent: {channel: string; payload: any}[] = [];
  let reloads = 0, destroyed = 0, certifications = 0;
  const sender = {id: 1, mainFrame: {}, send: (channel: string, payload: any) => sent.push({channel, payload}), reload: () => { reloads++; }};
  const window = {webContents: sender, destroy: () => { destroyed++; }};
  const event = {sender, senderFrame: sender.mainFrame} as never;
  const barrier = createRecoveryCloseBarrier({requestId: () => 'reload-1', showMessageBox: async () => { throw new Error('No implicit consent'); },
    cancelled: (_window, reason) => sent.push({channel: 'cancelled', payload: {reason}}),
    certifyRetainedSet: async () => { certifications++; return certify(); }});
  const result = {requestId: 'reload-1', captureAvailable: true, recoveryRequired: false, busy: false, hasUnsavedChanges: false, capture: {slots: [{content: {retainedAssetIntents: []}}]}};
  return {barrier, window, event, sent, result, get reloads() {return reloads;}, get destroyed() {return destroyed;}, get certifications() {return certifications;}};
};
it('defers reload, certifies settled original capture, compares a fresh capture, and never destroys the window or ACKs Save', async () => {
  const f = fixture();
  f.barrier.beginReload(f.window);
  expect(f.sent.at(-1)).toEqual({channel: 'app:prepareClose', payload: {requestId: 'reload-1', purpose: 'reload'}});
  expect(f.reloads).toBe(0);
  await f.barrier.finishCapture(f.event, f.result);
  expect(f.certifications).toBe(1); expect(f.reloads).toBe(0);
  await f.barrier.finishCapture(f.event, f.result);
  expect(f.reloads).toBe(1); expect(f.destroyed).toBe(0);
  await expect(f.barrier.finishCapture(f.event, f.result)).rejects.toThrow('caller');
});
it.each(['false', 'unknown', 'throw'])('refuses %s certification and retains the original document', async kind => {
  const f = fixture(async () => { if (kind === 'throw') throw new Error('readback failed'); return (kind === 'false' ? false : undefined) as boolean; });
  f.barrier.beginReload(f.window);
  await f.barrier.finishCapture(f.event, f.result);
  expect(f.reloads).toBe(0); expect(f.destroyed).toBe(0); expect(f.sent.at(-1)?.payload.reason).toMatch(/certified/);
});
it('rejects changed capture and wrong document without reusing certification', async () => {
  const f = fixture(); f.barrier.beginReload(f.window);
  await f.barrier.finishCapture(f.event, f.result);
  await f.barrier.finishCapture(f.event, {...f.result, capture: {slots: []}});
  expect(f.reloads).toBe(0);
  f.barrier.beginReload(f.window);
  f.window.webContents.mainFrame = {};
  await expect(f.barrier.finishCapture(f.event, f.result)).rejects.toThrow('caller');
  expect(f.reloads).toBe(0);
});
it('times out pending work visibly, rejects late capture, and does not force a reload', async () => {
  vi.useFakeTimers(); const f = fixture(); f.barrier.beginReload(f.window);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.sent.at(-1)?.payload.reason).toMatch(/timed out/);
  await expect(f.barrier.finishCapture(f.event, f.result)).rejects.toThrow('caller');
  expect(f.reloads).toBe(0); expect(f.destroyed).toBe(0); expect(f.certifications).toBe(0);
});
it('timeout during certification cannot spend a late successful readback', async () => {
  vi.useFakeTimers(); let release!: (ok: boolean) => void;
  const f = fixture(() => new Promise(resolve => {release = resolve;})); f.barrier.beginReload(f.window);
  const verifying = f.barrier.finishCapture(f.event, f.result);
  await vi.advanceTimersByTimeAsync(120_000); release(true); await verifying;
  expect(f.reloads).toBe(0); expect(f.sent.at(-1)?.payload.reason).toMatch(/timed out/);
});
