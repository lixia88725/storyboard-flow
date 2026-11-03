import { describe, expect, it, vi } from "vitest";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createAppAppHandlers } from "../../electron/main/appAppRuntime";
import { handleStoryboardWindowClose } from "../../electron/main/appWindowService";
import { registerAppCloseGuardBarriers } from "../../electron/main/ipc/appHandlers";
import fs from "node:fs";
import vm from "node:vm";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const fixture = () => {
  const guards = new Set<number>();
  const handlers = createAppAppHandlers({ arch: "arm64", platform: "darwin", closeGuardWebContentsIds: guards, getVersion: () => "test", openExternal: async () => {}, ownerFromSender: () => undefined, saveAndCloseRequests: new Map(), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
  const event = { sender: { id: 7 } } as never;
  const owner = { destroy: vi.fn(), webContents: { id: 7, send: vi.fn() } };
  const preventDefault = vi.fn();
  const close = () => handleStoryboardWindowClose({ preventDefault }, { owner, closeGuardWebContentsIds: guards, createRequestId: () => "close", saveAndCloseRequests: new Map(), showMessageBoxSync: () => 2 });
  let pending = false;
  const transitions: boolean[] = [];
  // Cast permits a real RED before adding the admission callback contract.
  const queue = (createBitmapLayerWriteQueue as unknown as (options: { onBusyChange: (busy: boolean) => void }) => ReturnType<typeof createBitmapLayerWriteQueue>)({ onBusyChange: busy => {
    transitions.push(busy);
    (handlers as unknown as { updateBitmapQueueGuard: (e: never, p: { busy: boolean; hasUnsavedChanges: boolean }) => void }).updateBitmapQueueGuard(event, { busy, hasUnsavedChanges: pending });
  } });
  return { queue, handlers, event, guards, owner, preventDefault, close, transitions, setPending: (value: boolean) => { pending = value; } };
};

describe("bitmap queue native close admission (no React render)", () => {
  it("arms actual cached main guard before starting PNG work and cannot be cleared by a clean render", async () => {
    const f = fixture(), ack = deferred(), entered = deferred();
    f.handlers.updateCloseGuard(f.event, { hasUnsavedChanges: false });
    expect(f.guards.has(7)).toBe(false);
    const write = f.queue.enqueue("a.png", async () => { expect(f.guards.has(7)).toBe(true); entered.resolve(); await ack.promise; });
    // Must already be armed, not after task/publication/another render.
    expect(f.guards.has(7)).toBe(true);
    await entered.promise;
    f.handlers.updateCloseGuard(f.event, { hasUnsavedChanges: false });
    f.close();
    expect(f.preventDefault).toHaveBeenCalledOnce(); expect(f.owner.destroy).not.toHaveBeenCalled();
    ack.resolve(); await write;
    expect(f.guards.has(7)).toBe(false); expect(f.transitions).toEqual([true, false]);
  });
  it("does not release while newer queued or exclusive work remains; retains current pending on finish", async () => {
    const f = fixture(), hold = deferred();
    const first = f.queue.enqueue("a", () => hold.promise);
    const exclusive = f.queue.runExclusive(async () => { expect(f.guards.has(7)).toBe(true); });
    const last = f.queue.enqueue("b", async () => { expect(f.guards.has(7)).toBe(true); f.setPending(true); });
    hold.resolve(); await Promise.all([first, exclusive, last]); await f.queue.drain();
    expect(f.transitions).toEqual([true, false]); expect(f.guards.has(7)).toBe(true);
    f.setPending(false); f.handlers.updateCloseGuard(f.event, { hasUnsavedChanges: false }); expect(f.guards.has(7)).toBe(false);
  });
  it("releases busy after rejection or synchronous task throw without changing queue order", async () => {
    const f = fixture(); const order: string[] = [];
    const bad = f.queue.enqueue("a", () => { order.push("bad"); throw Error("PNG failed"); });
    const good = f.queue.enqueue("a", async () => { order.push("good"); });
    await expect(bad).rejects.toThrow("PNG failed"); await good; await f.queue.drain();
    expect(order).toEqual(["bad", "good"]); expect(f.transitions).toEqual([true, false]); expect(f.guards.has(7)).toBe(false);
  });
  it("refuses to start effects when main admission fails, and a later admission can recover", async () => {
    let refuse = true; const task = vi.fn(async () => {});
    const queue = (createBitmapLayerWriteQueue as unknown as (o: { onBusyChange: (busy: boolean) => void }) => ReturnType<typeof createBitmapLayerWriteQueue>)({ onBusyChange: busy => { if (busy && refuse) throw Error("No main ACK"); } });
    await expect(queue.enqueue("a", task)).rejects.toThrow("No main ACK"); expect(task).not.toHaveBeenCalled(); expect(queue.isBusy?.()).toBe(false);
    refuse = false; await queue.enqueue("a", task); expect(task).toHaveBeenCalledOnce();
  });
  it("propagates exclusive admission and release failures without orphan rejected cleanup promises", async () => {
    let phase = "start";
    const queue = createBitmapLayerWriteQueue({ onBusyChange: busy => { if ((busy && phase === "start") || (!busy && phase === "end")) throw Error("Guard transport failed"); } });
    const task = vi.fn(async () => {});
    await expect(queue.runExclusive(task)).rejects.toThrow("Guard transport failed"); expect(task).not.toHaveBeenCalled();
    phase = "end"; await expect(queue.runExclusive(task)).rejects.toThrow("Guard transport failed"); expect(queue.isBusy?.()).toBe(false);
    phase = "ok"; await queue.runExclusive(task); await queue.drain(); expect(queue.isBusy?.()).toBe(false);
  });
  it("real CommonJS preload synchronously ACKs real registered main barrier before PNG invocation", async () => {
    const f = fixture(), listeners = new Map<string, (e: unknown, p: unknown) => void>();
    registerAppCloseGuardBarriers({ on: (channel: string, callback: (e: unknown, p: unknown) => void) => { listeners.set(channel, callback); } } as never, f.handlers);
    let bridge: { updateCloseGuard: (p: { hasUnsavedChanges: boolean }) => Promise<void>; updateBitmapQueueGuard: (p: { busy: boolean; hasUnsavedChanges: boolean }) => void };
    const calls: string[] = [];
    vm.runInNewContext(fs.readFileSync("electron/preload/preload.cjs", "utf8"), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: typeof bridge) => { bridge = value; } }, ipcRenderer: {
      on: vi.fn(), invoke: () => { throw Error("Async guard race"); }, sendSync: (channel: string, payload: unknown) => {
        calls.push(channel); const e = { sender: { id: 7 }, returnValue: undefined }; listeners.get(channel)!(e, payload); return e.returnValue;
      }
    } }) });
    await bridge!.updateCloseGuard({ hasUnsavedChanges: false });
    const queue = createBitmapLayerWriteQueue({ onBusyChange: busy => bridge!.updateBitmapQueueGuard({ busy, hasUnsavedChanges: false }) });
    await queue.enqueue("PNG", async () => { expect(f.guards.has(7)).toBe(true); f.close(); });
    expect(calls).toEqual(["app:updateCloseGuardSync", "app:updateBitmapQueueGuard", "app:updateBitmapQueueGuard"]);
    expect(f.preventDefault).toHaveBeenCalledOnce(); expect(f.guards.has(7)).toBe(false);
  });
});
