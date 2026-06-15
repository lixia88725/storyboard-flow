import { describe, expect, it, vi } from "vitest";
import {
  finishSaveAndClose,
  getAppInfoForRenderer,
  openExternalUrl,
  respondToStoryboardImageRequest,
  selectFolderPath,
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

  it("rejects storyboard image requests without a file path", async () => {
    const fetchFileUrl = vi.fn(async () => new Response("ignored"));

    const response = await respondToStoryboardImageRequest("storyboard-img://image", fetchFileUrl);

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Missing path");
    expect(fetchFileUrl).not.toHaveBeenCalled();
  });

  it("fetches storyboard image requests through a file URL", async () => {
    const fetchFileUrl = vi.fn(async () => new Response("ok"));

    const response = await respondToStoryboardImageRequest(
      "storyboard-img://image?path=%2Ftmp%2FStoryboard%20Flow%2Fshot%201.png",
      fetchFileUrl
    );

    expect(response.status).toBe(200);
    expect(fetchFileUrl).toHaveBeenCalledWith("file:///tmp/Storyboard%20Flow/shot%201.png");
  });

  it("selects a folder without an owner window", async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ["/chosen"] }));

    await expect(selectFolderPath({ showOpenDialog })).resolves.toBe("/chosen");

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ["openDirectory", "createDirectory"]
    });
  });

  it("selects a folder with an owner window when available", async () => {
    const owner = { id: 42 };
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ["/owned"] }));

    await expect(selectFolderPath({ owner, showOpenDialog })).resolves.toBe("/owned");

    expect(showOpenDialog).toHaveBeenCalledWith(owner, {
      properties: ["openDirectory", "createDirectory"]
    });
  });

  it("returns undefined when folder selection is canceled", async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: ["/ignored"] }));

    await expect(selectFolderPath({ showOpenDialog })).resolves.toBeUndefined();
  });
});
