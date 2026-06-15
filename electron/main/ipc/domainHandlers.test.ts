import { describe, expect, it, vi } from "vitest";
import { registerAppIpcHandlers } from "./appHandlers";
import { registerAiIpcHandlers } from "./aiHandlers";
import { registerImageIpcHandlers } from "./imageHandlers";
import { registerLayerIpcHandlers } from "./layerHandlers";
import { registerRecentIpcHandlers } from "./recentHandlers";
import { registerSettingsIpcHandlers } from "./settingsHandlers";
import { registerWorkspaceAssetIpcHandlers } from "./workspaceAssetHandlers";
import { registerWorkspaceScriptIpcHandlers } from "./workspaceScriptHandlers";
import { registerWorkspaceWatchIpcHandlers } from "./workspaceWatchHandlers";

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
  it("registers app shell IPC channels and delegates to supplied handlers", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const selectFolder = vi.fn(async (event) => ({ event }));
    const finishSaveAndClose = vi.fn((payload) => ({ payload }));
    const updateCloseGuard = vi.fn((event, payload) => ({ event, payload }));
    const getInfo = vi.fn(() => ({ version: "1.0.0" }));
    const openExternal = vi.fn(async (url) => ({ url }));

    registerAppIpcHandlers(ipcMain, {
      selectFolder,
      finishSaveAndClose,
      updateCloseGuard,
      getInfo,
      openExternal
    });

    expect([...handlers.keys()].sort()).toEqual([
      "app:finishSaveAndClose",
      "app:getInfo",
      "app:openExternal",
      "app:updateCloseGuard",
      "dialog:selectFolder"
    ]);
    await expect(handlers.get("dialog:selectFolder")?.({ sender: "sender" })).resolves.toEqual({
      event: { sender: "sender" }
    });
    expect(handlers.get("app:getInfo")?.({})).toEqual({ version: "1.0.0" });
    await expect(handlers.get("app:openExternal")?.({}, "https://example.com")).resolves.toEqual({
      url: "https://example.com"
    });
    expect(handlers.get("app:finishSaveAndClose")?.({}, { requestId: "r1", saved: true })).toEqual({
      payload: { requestId: "r1", saved: true }
    });
    expect(handlers.get("app:updateCloseGuard")?.({ sender: "sender" }, { hasUnsavedChanges: true })).toEqual({
      event: { sender: "sender" },
      payload: { hasUnsavedChanges: true }
    });
  });

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

  it("registers layer, settings, recent, and workspace watch IPC channels", () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const startFolderWatch = vi.fn();
    const stopFolderWatch = vi.fn(() => "stopped");

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
    registerWorkspaceWatchIpcHandlers(ipcMain, {
      startFolderWatch,
      stopFolderWatch
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
      "settings:setToolRadialMenu",
      "workspace:startFolderWatch",
      "workspace:stopFolderWatch"
    ]);
    handlers.get("workspace:startFolderWatch")?.({ sender: "sender" }, "/folder");
    const stopResult = handlers.get("workspace:stopFolderWatch")?.({}, 42);

    expect(startFolderWatch).toHaveBeenCalledWith({ sender: "sender" }, "/folder");
    expect(stopFolderWatch).toHaveBeenCalledWith(42);
    expect(stopResult).toBeUndefined();
  });

  it("registers workspace asset IPC channels and delegates to supplied handlers", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const copyShotAssets = vi.fn(async (payload) => ({ payload }));

    registerWorkspaceAssetIpcHandlers(ipcMain, {
      copyShotAssets
    });

    expect([...handlers.keys()].sort()).toEqual(["workspace:copyShotAssets"]);
    await expect(
      handlers.get("workspace:copyShotAssets")?.({}, { folderPath: "/project" })
    ).resolves.toEqual({
      payload: { folderPath: "/project" }
    });
    expect(copyShotAssets).toHaveBeenCalledWith({ folderPath: "/project" });
  });

  it("registers workspace script IPC channels and delegates to supplied handlers", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const inspectStoryboardScript = vi.fn(async (sourceMarkdownPath) => ({
      sourceMarkdownPath
    }));
    const createFromStoryboardScript = vi.fn(async (payload) => ({
      folderPath: "/created-project",
      payload
    }));
    const addRecentFolder = vi.fn();
    const ensureStoryboardScriptMarkdown = vi.fn(async () => true);

    registerWorkspaceScriptIpcHandlers(ipcMain, {
      inspectStoryboardScript,
      createFromStoryboardScript,
      addRecentFolder,
      ensureStoryboardScriptMarkdown
    });

    expect([...handlers.keys()].sort()).toEqual([
      "workspace:checkStoryboardScript",
      "workspace:createFromStoryboardScript",
      "workspace:inspectStoryboardScript"
    ]);
    await expect(
      handlers.get("workspace:inspectStoryboardScript")?.({}, "/project/storyboard-script.md")
    ).resolves.toEqual({
      sourceMarkdownPath: "/project/storyboard-script.md"
    });
    await expect(
      handlers.get("workspace:createFromStoryboardScript")?.({}, { targetFolderPath: "/project" })
    ).resolves.toEqual({
      folderPath: "/created-project",
      payload: { targetFolderPath: "/project" }
    });
    await expect(
      handlers.get("workspace:checkStoryboardScript")?.(
        {},
        { folderPath: "/project", project: { shots: [] } }
      )
    ).resolves.toEqual({
      scriptImportNeeded: true
    });
    expect(inspectStoryboardScript).toHaveBeenCalledWith("/project/storyboard-script.md");
    expect(createFromStoryboardScript).toHaveBeenCalledWith({ targetFolderPath: "/project" });
    expect(addRecentFolder).toHaveBeenCalledWith("/created-project");
    expect(ensureStoryboardScriptMarkdown).toHaveBeenCalledWith("/project", { shots: [] });
  });

  it("registers image IPC channels and delegates to supplied handlers", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const createBlankShot = vi.fn(async (folderPath, options) => ({ folderPath, options }));

    registerImageIpcHandlers(ipcMain, {
      createBlankShot
    });

    expect([...handlers.keys()].sort()).toEqual(["images:createBlankShot"]);
    await expect(
      handlers.get("images:createBlankShot")?.({}, "/project", { preset: "2.39:1" })
    ).resolves.toEqual({
      folderPath: "/project",
      options: { preset: "2.39:1" }
    });
    expect(createBlankShot).toHaveBeenCalledWith("/project", { preset: "2.39:1" });
  });
});
