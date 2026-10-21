import { describe, expect, it, vi } from "vitest";
import { registerAppIpcHandlers } from "./appHandlers";
import { registerImageIpcHandlers } from "./imageHandlers";
import { registerLayerIpcHandlers } from "./layerHandlers";
import { registerRecentIpcHandlers } from "./recentHandlers";
import { registerSettingsIpcHandlers } from "./settingsHandlers";
import { registerWorkspaceAssetIpcHandlers } from "./workspaceAssetHandlers";
import { registerWorkspaceExternalChangesIpcHandlers } from "./workspaceExternalChangesHandlers";
import { registerWorkspaceOpenIpcHandlers } from "./workspaceOpenHandlers";
import { registerWorkspacePersistenceIpcHandlers } from "./workspacePersistenceHandlers";
import { registerWorkspacePendingIpcHandlers } from "./workspacePendingHandlers";
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
    const finishCloseCapture = vi.fn((event, payload) => ({ event, payload }));
    const updateCloseGuard = vi.fn((event, payload) => ({ event, payload }));
    const getInfo = vi.fn(() => ({ version: "1.0.0" }));
    const openExternal = vi.fn(async (url) => ({ url }));

    registerAppIpcHandlers(ipcMain, {
      selectFolder,
      finishSaveAndClose,
      finishCloseCapture,
      updateBitmapQueueGuard: vi.fn(),
      updateCloseGuard,
      getInfo,
      openExternal
    });

    expect([...handlers.keys()].sort()).toEqual([
      "app:finishCloseCapture",
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
    expect(finishSaveAndClose).toHaveBeenCalledWith({ requestId: "r1", saved: true }, {});
    const caller = { sender: {}, senderFrame: {} };
    const captured = { requestId: "r1", captureAvailable: true, recoveryRequired: true, busy: false, hasUnsavedChanges: true, capture: { revision: "R2" } };
    expect(handlers.get("app:finishCloseCapture")?.(caller, captured)).toEqual({ event: caller, payload: captured });
    expect(finishCloseCapture).toHaveBeenCalledWith(caller, captured);
    expect(handlers.get("app:updateCloseGuard")?.({ sender: "sender" }, { hasUnsavedChanges: true })).toEqual({
      event: { sender: "sender" },
      payload: { hasUnsavedChanges: true }
    });
  });

  it("registers layer, settings, recent, and workspace watch IPC channels", () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const startFolderWatch = vi.fn();
    const stopFolderWatch = vi.fn(() => "stopped");

    registerLayerIpcHandlers(ipcMain, {
      cleanupMergeSources: vi.fn(),
      createPng: vi.fn(),
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
      "layers:cleanupMergeSources",
      "layers:copyPng",
      "layers:createPng",
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

  it("registers visible Pending file IPC channels", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const moveShotsToPending = vi.fn(async (payload, shotIds) => ({ payload, shotIds }));
    const restoreShotsFromPending = vi.fn(async (payload, shotIds) => ({ payload, shotIds }));
    const payload = { folderPath: "/project", project: { shots: [] } };

    registerWorkspacePendingIpcHandlers(ipcMain, {
      moveShotsToPending,
      restoreShotsFromPending
    });

    expect([...handlers.keys()].sort()).toEqual([
      "workspace:moveShotsToPending",
      "workspace:restoreShotsFromPending"
    ]);
    await expect(
      handlers.get("workspace:moveShotsToPending")?.({}, payload, ["shot-a"])
    ).resolves.toEqual({ payload, shotIds: ["shot-a"] });
    await expect(
      handlers.get("workspace:restoreShotsFromPending")?.({}, payload, ["shot-a"])
    ).resolves.toEqual({ payload, shotIds: ["shot-a"] });
  });

  it("registers workspace open IPC channel and handles missing and existing folders", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const pathExists = vi.fn(async (folderPath: string) => folderPath === "/existing");
    const removeRecentFolder = vi.fn();
    const createProgressReporter = vi.fn((sender, mode) => ({ sender, mode }));
    const scanFolder = vi.fn(async (folderPath, progress) => ({
      folderPath: `${folderPath}/canonical`,
      progress
    }));
    const addRecentFolder = vi.fn();

    registerWorkspaceOpenIpcHandlers(ipcMain, {
      pathExists,
      removeRecentFolder,
      createProgressReporter,
      scanFolder,
      addRecentFolder
    });

    expect([...handlers.keys()]).toEqual(["workspace:openFolderByPath"]);
    await expect(
      handlers.get("workspace:openFolderByPath")?.({ sender: "sender" }, "/missing")
    ).rejects.toThrow("Folder does not exist: /missing");
    expect(removeRecentFolder).toHaveBeenCalledWith("/missing");

    await expect(
      handlers.get("workspace:openFolderByPath")?.({ sender: "sender" }, "/existing")
    ).resolves.toEqual({
      folderPath: "/existing/canonical",
      progress: { sender: "sender", mode: "open" }
    });
    expect(createProgressReporter).toHaveBeenCalledWith("sender", "open");
    expect(scanFolder).toHaveBeenCalledWith("/existing", { sender: "sender", mode: "open" });
    expect(addRecentFolder).toHaveBeenCalledWith("/existing/canonical");
  });

  it("registers workspace persistence IPC channels and preserves autosave asset options", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const ensureProjectLayerAssets = vi.fn();
    const writeProjectFiles = vi.fn();
    const payload = {
      folderPath: "/project",
      metadataPath: "/project/.storyboard-workbench/storyboard.project.json",
      project: { shots: [] }
    };

    registerWorkspacePersistenceIpcHandlers(ipcMain, {
      ensureProjectLayerAssets,
      writeProjectFiles
    });

    expect([...handlers.keys()].sort()).toEqual([
      "workspace:autosave",
      "workspace:ensureLayerAssets"
    ]);
    await expect(handlers.get("workspace:autosave")?.({}, payload)).resolves.toBe(payload);
    expect(ensureProjectLayerAssets).toHaveBeenCalledWith(payload.project, payload.folderPath, {
      includeExternalShots: false
    });
    expect(writeProjectFiles).toHaveBeenCalledWith(
      payload.metadataPath,
      payload.folderPath,
      payload.project
    );

    ensureProjectLayerAssets.mockClear();
    await expect(handlers.get("workspace:ensureLayerAssets")?.({}, payload)).resolves.toBe(payload);
    expect(ensureProjectLayerAssets).toHaveBeenCalledWith(payload.project, payload.folderPath);
  });

  it("registers workspace external changes IPC channel with open progress", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const createProgressReporter = vi.fn((sender, mode) => ({ sender, mode }));
    const checkExternalChanges = vi.fn(async (payload, options) => ({
      payload,
      options
    }));
    const payload = {
      folderPath: "/project",
      metadataPath: "/project/.storyboard-workbench/storyboard.project.json",
      project: { shots: [{ imagePath: "/project/shot-001.tiff" }] }
    };

    registerWorkspaceExternalChangesIpcHandlers(ipcMain, {
      createProgressReporter,
      checkExternalChanges
    });

    expect([...handlers.keys()]).toEqual(["workspace:checkExternalChanges"]);
    await expect(
      handlers.get("workspace:checkExternalChanges")?.({ sender: "sender" }, payload)
    ).resolves.toEqual({
      payload,
      options: {
        reportProgress: { sender: "sender", mode: "open" }
      }
    });
    expect(createProgressReporter).toHaveBeenCalledWith("sender", "open");
    expect(checkExternalChanges).toHaveBeenCalledWith(payload, {
      reportProgress: { sender: "sender", mode: "open" }
    });
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
      handlers.get("images:createBlankShot")?.({}, "/project", { preset: "9:16" })
    ).resolves.toEqual({
      folderPath: "/project",
      options: { preset: "9:16" }
    });
    expect(createBlankShot).toHaveBeenCalledWith("/project", { preset: "9:16" });
  });
});
