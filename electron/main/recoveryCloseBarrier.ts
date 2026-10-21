import type { IpcMainInvokeEvent, MessageBoxOptions } from "electron";

export type RecoveryCloseWindow = {
  destroy: () => void;
  webContents: { id: number; mainFrame: object; send: (channel: string, payload: unknown) => void; reload?: () => void };
};
export type CloseCaptureResult = { requestId: string; captureAvailable: boolean; recoveryRequired: boolean; busy: boolean; hasUnsavedChanges: boolean; capture?: unknown };
/** Ordinary-close authority. Retention may retire only the authenticated close lease;
 * it never completes a failed operation or retires the physical writer gate. */
export const createRecoveryCloseBarrier = (ports: {
  requestId: () => string;
  showMessageBox: (window: RecoveryCloseWindow, options: MessageBoxOptions) => Promise<{ response: number }>;
  cancelled: (window: RecoveryCloseWindow, reason: string) => void;
  certifyRetained?: (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, capture: unknown) => Promise<boolean>;
  certifyRetainedSet?: (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, collection: unknown) => Promise<boolean>;
}) => {
  type Pending = { window: RecoveryCloseWindow; sender: object; frame: object; stage: "capture" | "prompt" | "save" | "verify"; retainedCapture?: string; purpose?: 'reload'; timer?: ReturnType<typeof setTimeout> };
  const pending = new Map<string, Pending>();
  const held = new Set<object>();
  const busy = new Set<object>();
  const approvedReloads = new Map<object, object>();
  const authentic = (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, p: Pending) =>
    event.sender === p.sender && event.senderFrame === p.frame && p.window.webContents.mainFrame === p.frame;
  const cancel = (id: string, reason: string) => {
    const p = pending.get(id);
    pending.delete(id);
    if (p) { clearTimeout(p.timer); ports.cancelled(p.window, reason); }
  };
  return {
    consumeReloadPermission: (window: RecoveryCloseWindow) => {
      const frame = approvedReloads.get(window.webContents);
      approvedReloads.delete(window.webContents);
      return frame !== undefined && frame === window.webContents.mainFrame;
    },
    // Electron already cancelled this real beforeunload request. Keep the
    // original document alive until settlement and fresh exact readback.
    beginReload: (window: RecoveryCloseWindow) => {
      if ([...pending.values()].some(p => p.window === window)) return;
      const id = ports.requestId();
      const p: Pending = {window, sender: window.webContents, frame: window.webContents.mainFrame, stage: 'capture', purpose: 'reload'};
      pending.set(id, p);
      p.timer = setTimeout(() => cancel(id, 'Refresh timed out waiting for Save/producer settlement or certification; original document retained'), 120_000);
      p.timer.unref?.();
      window.webContents.send('app:prepareClose', {requestId: id, purpose: 'reload'});
    },
    begin: (window: RecoveryCloseWindow) => {
      if ([...pending.values()].some(p => p.window === window)) return;
      const id = ports.requestId();
      pending.set(id, { window, sender: window.webContents, frame: window.webContents.mainFrame, stage: "capture" });
      window.webContents.send("app:prepareClose", { requestId: id });
    },
    // Top-frame real event only. A document cannot un-latch its own unknown by false.
    observe: (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, recoveryRequired: boolean, isBusy?: boolean) => {
      if (event.senderFrame !== event.sender.mainFrame) throw new Error("Close observation requires the current top frame");
      if (recoveryRequired) held.add(event.sender);
      if (isBusy === true) busy.add(event.sender);
      if (isBusy === false) busy.delete(event.sender);
    },
    finishCapture: async (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, result: CloseCaptureResult) => {
      if (!result || typeof result.requestId !== "string" ||
          [result.captureAvailable, result.recoveryRequired, result.busy, result.hasUnsavedChanges].some(v => typeof v !== "boolean"))
        throw new Error("Malformed close capture");
      const p = pending.get(result.requestId);
      if (!p || !["capture", "verify"].includes(p.stage) || !authentic(event, p)) throw new Error("Close capture caller/stage mismatch");
      // No approved content-only route can retire an unexecuted asset intent.
      // Check the actual all-slot content at the final destroy boundary too;
      // renderer flags and another Save's success must not waive these RAM bytes.
      const retained = (value: unknown): boolean => !!value && typeof value === 'object' &&
        Array.isArray((value as { retainedAssetIntents?: unknown }).retainedAssetIntents) &&
        ((value as { retainedAssetIntents: unknown[] }).retainedAssetIntents.length > 0);
      const hasRetainedIntents = (value: unknown): boolean => {
        if (retained(value)) return true;
        if (!value || typeof value !== 'object') return false;
        const slots = (value as { slots?: unknown }).slots;
        return Array.isArray(slots) && slots.some(slot => slot && typeof slot === 'object' && retained(slot.content));
      };
      if (hasRetainedIntents(result.capture)) {
        held.add(p.sender);
        cancel(result.requestId, 'Close cancelled: uncompleted asset intents require this window and original RAM');
        return;
      }
      if (p.stage === "verify") {
        if (!result.captureAvailable || result.busy || busy.has(p.sender) || JSON.stringify(result.capture) !== p.retainedCapture) {
          cancel(result.requestId, "Close cancelled: latest content changed after byte readback"); return;
        }
        pending.delete(result.requestId); clearTimeout(p.timer);
        if (p.purpose === 'reload') {
          // Retention is not an ACK or writer unlock. The existing Main
          // navigation listener still invalidates the original document.
          approvedReloads.set(p.sender, p.frame);
          p.window.webContents.reload!();
        } else { held.delete(p.sender); p.window.destroy(); }
        return;
      }
      if (result.recoveryRequired) held.add(event.sender);
      if (!result.captureAvailable || result.busy || busy.has(event.sender)) {
        cancel(result.requestId, "Close cancelled: latest protected content has no certified durable retention; keep this window open");
        return;
      }
      if (p.purpose === 'reload') {
        if (!ports.certifyRetainedSet || !result.capture || !p.window.webContents.reload) {
          cancel(result.requestId, 'Refresh refused: durable content could not be certified'); return;
        }
        const captured = JSON.stringify(result.capture);
        p.stage = 'prompt';
        let certified = false;
        try { certified = await ports.certifyRetainedSet(event, JSON.parse(captured)) === true; } catch { /* Keep original document. */ }
        if (pending.get(result.requestId) !== p) return;
        if (!certified || !authentic(event, p) || busy.has(p.sender)) {
          cancel(result.requestId, 'Refresh refused: retained bytes or current document could not be certified'); return;
        }
        p.retainedCapture = captured; p.stage = 'verify';
        p.window.webContents.send('app:prepareClose', {requestId: result.requestId, purpose: 'reload'}); return;
      }
      if (held.has(event.sender)) {
        const collection = result.capture !== null && typeof result.capture === "object" && Object.prototype.hasOwnProperty.call(result.capture, "slots");
        const certify = collection ? ports.certifyRetainedSet : ports.certifyRetained;
        if (!certify || !result.capture) { cancel(result.requestId, "Close cancelled: durable retention unavailable"); return; }
        const captured = JSON.stringify(result.capture);
        p.stage = "prompt";
        const { response } = await ports.showMessageBox(p.window, {
          type: "warning", buttons: ["Retain Recovery Content and Close", "Cancel"], defaultId: 1, cancelId: 1,
          message: "This workspace has an unfinished operation",
          detail: "Retain exact recovery content before closing. This does not complete Save or unlock the workspace."
        });
        if (response !== 0 || pending.get(result.requestId) !== p || !authentic(event, p) || busy.has(p.sender)) {
          cancel(result.requestId, "Close cancelled"); return;
        }
        let certified = false;
        try { certified = await certify(event, JSON.parse(captured)); } catch { /* Keep RAM and the latch. */ }
        if (!certified || pending.get(result.requestId) !== p || !authentic(event, p) || busy.has(p.sender)) {
          cancel(result.requestId, "Close cancelled: retained bytes or current document could not be certified"); return;
        }
        // Main's actual readback is not proof that the RAM revision stayed current.
        // Ask the still-frozen renderer for one exact final capture, no recopy/retry loop.
        p.retainedCapture = captured; p.stage = "verify";
        p.window.webContents.send("app:prepareClose", { requestId: result.requestId }); return;
      }
      if (!result.hasUnsavedChanges) { pending.delete(result.requestId); p.window.destroy(); return; }
      p.stage = "prompt";
      const { response } = await ports.showMessageBox(p.window, {
        type: "warning", buttons: ["Save and Close", "Close Without Saving", "Cancel"], defaultId: 0, cancelId: 2,
        message: "Close without saving?", detail: "Only ordinary current changes can be discarded. Protected content cannot be discarded."
      });
      if (pending.get(result.requestId) !== p || held.has(p.sender) || busy.has(p.sender)) { cancel(result.requestId, "Close cancelled: content protection changed"); return; }
      if (response === 0) { p.stage = "save"; p.window.webContents.send("app:saveAndClose", { requestId: result.requestId }); }
      else if (response === 1) { pending.delete(result.requestId); p.window.destroy(); }
      else cancel(result.requestId, "Close cancelled");
    },
    finishSave: (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, result: { requestId: string; saved: boolean }) => {
      if (!result || typeof result.requestId !== "string" || typeof result.saved !== "boolean") throw new Error("Malformed save close result");
      const p = pending.get(result.requestId);
      if (!p || p.stage !== "save" || !authentic(event, p)) throw new Error("Save-and-close caller/stage mismatch");
      if (!result.saved || held.has(p.sender) || busy.has(p.sender)) { cancel(result.requestId, "Save and Close cancelled: protected or pending content remains"); return; }
      pending.delete(result.requestId); p.window.destroy();
    },
    invalidateDocument: (window: RecoveryCloseWindow) => {
      approvedReloads.delete(window.webContents);
      for (const [id, p] of pending) if (p.window === window) cancel(id, "Close cancelled: document changed");
      // Unknown content survives navigation. Cold protocol remains unimplemented.
    }
  };
};
export type RecoveryCloseBarrier = ReturnType<typeof createRecoveryCloseBarrier>;
