import { describe, expect, it, vi } from "vitest";
import {
  finishSaveAndClose,
  getAppInfoForRenderer,
  openExternalUrl,
  updateCloseGuard
} from "./appShellService.js";

describe("appShellService", () => {
  it("destroys the pending window only after a save-and-close request reports saved", () => {
    const destroy = vi.fn();
    const requests = new Map<string, { destroy: () => void }>([["r1", { destroy }]]);

    finishSaveAndClose(requests, { requestId: "r1", saved: true });

    expect(destroy).toHaveBeenCalledOnce();
    expect(requests.has("r1")).toBe(false);
  });

  it("clears the pending save-and-close request without destroying when not saved", () => {
    const destroy = vi.fn();
    const requests = new Map<string, { destroy: () => void }>([["r1", { destroy }]]);

    finishSaveAndClose(requests, { requestId: "r1", saved: false });

    expect(destroy).not.toHaveBeenCalled();
    expect(requests.has("r1")).toBe(false);
  });

  it("tracks close guard webContents ids", () => {
    const ids = new Set<number>();
    const event = { sender: { id: 42 } };

    updateCloseGuard(ids, event, { hasUnsavedChanges: true });
    expect(ids.has(42)).toBe(true);

    updateCloseGuard(ids, event, { hasUnsavedChanges: false });
    expect(ids.has(42)).toBe(false);
  });

  it("builds renderer app info from supplied runtime values", () => {
    expect(
      getAppInfoForRenderer({
        version: "1.2.3",
        platform: "darwin",
        arch: "arm64",
        updateManifestUrl: "https://example.com/update.json"
      })
    ).toEqual({
      version: "1.2.3",
      platform: "darwin",
      arch: "arm64",
      updateManifestUrl: "https://example.com/update.json"
    });
  });

  it("opens only HTTPS external URLs", async () => {
    const openExternal = vi.fn(async () => undefined);

    await openExternalUrl("https://example.com", openExternal);
    await expect(openExternalUrl("http://example.com", openExternal)).rejects.toThrow(
      "Only HTTPS URLs can be opened externally."
    );
    expect(openExternal).toHaveBeenCalledOnce();
  });
});
