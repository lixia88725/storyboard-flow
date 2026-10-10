import { describe, expect, it, vi } from "vitest";
import { createAppAppHandlers } from "./appAppRuntime.js";

describe("createAppAppHandlers", () => {
  it("uses the CORS-compatible single-repository updates manifest by default", () => {
    const handlers = createAppAppHandlers({
      arch: "arm64", platform: "darwin", getVersion: () => "0.1.31",
      closeGuardWebContentsIds: new Set(), saveAndCloseRequests: new Map(),
      openExternal: async () => undefined, ownerFromSender: () => undefined,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    });
    expect(handlers.getInfo()).toEqual({
      arch: "arm64", platform: "darwin", version: "0.1.31",
      updateManifestUrl: "https://raw.githubusercontent.com/lixia88725/storyboard-flow/updates/update.json"
    });
  });
  it("returns app shell dependencies used by the IPC handler", async () => {
    const destroy = vi.fn();
    const saveAndCloseRequests = new Map([["request-1", { destroy }]]);
    const closeGuardWebContentsIds = new Set<number>();
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ["/scene"] }));
    const openExternal = vi.fn(async () => undefined);
    const owner = { id: 2 };
    const sender = { id: 1 };
    const handlers = createAppAppHandlers({
      arch: "arm64",
      closeGuardWebContentsIds,
      getVersion: () => "1.2.3",
      openExternal,
      ownerFromSender: () => owner,
      platform: "darwin",
      saveAndCloseRequests,
      showOpenDialog,
      updateManifestUrl: "https://example.com/update.json"
    });

    await expect(handlers.selectFolder({ sender } as never)).resolves.toBe("/scene");
    expect(showOpenDialog).toHaveBeenCalledWith(owner, {
      properties: ["openDirectory", "createDirectory"]
    });

    handlers.updateCloseGuard({ sender } as never, { hasUnsavedChanges: true });
    expect(closeGuardWebContentsIds.has(sender.id)).toBe(true);

    handlers.finishSaveAndClose({ requestId: "request-1", saved: true });
    expect(destroy).toHaveBeenCalledOnce();
    expect(saveAndCloseRequests.has("request-1")).toBe(false);

    expect(handlers.getInfo()).toEqual({
      arch: "arm64",
      platform: "darwin",
      updateManifestUrl: "https://example.com/update.json",
      version: "1.2.3"
    });

    await handlers.openExternal("https://example.com/download");
    expect(openExternal).toHaveBeenCalledWith("https://example.com/download");
  });
});
