import { describe, expect, it, vi } from "vitest";
import { registerAiIpcHandlers } from "./aiHandlers";
import { registerLayerIpcHandlers } from "./layerHandlers";
import { registerRecentIpcHandlers } from "./recentHandlers";
import { registerSettingsIpcHandlers } from "./settingsHandlers";

const fakeIpcMain = () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      })
    },
    handlers
  };
};

describe("domain IPC handlers", () => {
  it("registers AI IPC channels and delegates to supplied handlers", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const getSettings = vi.fn(async () => ({ ok: true }));
    const generateCandidate = vi.fn(async (payload) => ({ payload }));

    registerAiIpcHandlers(ipcMain, {
      getSettings,
      saveOpenAiApiKey: vi.fn(),
      clearOpenAiApiKey: vi.fn(),
      saveSeedreamApiKey: vi.fn(),
      clearSeedreamApiKey: vi.fn(),
      saveComfyUiSettings: vi.fn(),
      testComfyUiConnection: vi.fn(),
      listResources: vi.fn(),
      importResources: vi.fn(),
      deleteResource: vi.fn(),
      updateResourceMetadata: vi.fn(),
      generateCandidate,
      generateBatchCandidates: vi.fn(),
      copyRequestPreview: vi.fn(),
      discardCandidate: vi.fn(),
      applyCandidate: vi.fn()
    });

    expect([...handlers.keys()]).toContain("ai:getSettings");
    expect([...handlers.keys()]).toContain("ai:generateCandidate");
    await expect(handlers.get("ai:getSettings")?.({})).resolves.toEqual({ ok: true });
    await expect(handlers.get("ai:generateCandidate")?.({}, { shotId: "shot-1" })).resolves.toEqual({
      payload: { shotId: "shot-1" }
    });
  });

  it("registers layer, settings, and recent IPC channels", () => {
    const { ipcMain, handlers } = fakeIpcMain();

    registerLayerIpcHandlers(ipcMain, {
      writePng: vi.fn(),
      readPng: vi.fn(),
      deletePng: vi.fn(),
      copyPng: vi.fn(),
      mergeDown: vi.fn(),
      mergeVisible: vi.fn()
    });
    registerSettingsIpcHandlers(ipcMain, {
      getToolRadialMenu: vi.fn(),
      setToolRadialMenu: vi.fn()
    });
    registerRecentIpcHandlers(ipcMain, {
      getFolders: vi.fn()
    });

    expect([...handlers.keys()].sort()).toEqual([
      "layers:copyPng",
      "layers:deletePng",
      "layers:mergeDown",
      "layers:mergeVisible",
      "layers:readPng",
      "layers:writePng",
      "recent:getFolders",
      "settings:getToolRadialMenu",
      "settings:setToolRadialMenu"
    ]);
  });
});
