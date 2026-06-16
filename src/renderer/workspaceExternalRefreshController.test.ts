import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerWorkspaceFocusRefresh,
  registerWorkspaceFolderWatchRefresh,
  refreshWorkspaceExternalImportState
} from "./workspaceExternalRefreshController";

describe("workspaceExternalRefreshController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes on window focus until cleanup", () => {
    let focusListener: (() => void) | undefined;
    const eventTarget = {
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        focusListener = listener;
      }),
      removeEventListener: vi.fn()
    };
    const refreshExternalImportState = vi.fn();

    const cleanup = registerWorkspaceFocusRefresh(eventTarget, refreshExternalImportState);

    expect(eventTarget.addEventListener).toHaveBeenCalledWith("focus", expect.any(Function));
    focusListener?.();

    expect(refreshExternalImportState).toHaveBeenCalledTimes(1);

    cleanup();

    expect(eventTarget.removeEventListener).toHaveBeenCalledWith("focus", focusListener);
  });

  it("debounces workspace folder watch changes and stops watching on cleanup", async () => {
    vi.useFakeTimers();
    let changeListener: ((change: { folderPath: string; fileName: string }) => void) | undefined;
    const stopWatching = vi.fn();
    const api = {
      watchWorkspaceFolder: vi.fn(
        async (
          _folderPath: string,
          listener: (change: { folderPath: string; fileName: string }) => void
        ) => {
          changeListener = listener;
          return stopWatching;
        }
      )
    };
    const timers = {
      setTimeout: vi.fn((callback: () => void, delayMs: number) =>
        globalThis.setTimeout(callback, delayMs) as unknown as number
      ),
      clearTimeout: vi.fn((timeoutId: number) =>
        globalThis.clearTimeout(timeoutId as unknown as ReturnType<typeof globalThis.setTimeout>)
      )
    };
    const refreshExternalImportState = vi.fn();

    const cleanup = registerWorkspaceFolderWatchRefresh({
      api,
      folderPath: "/project",
      refreshExternalImportState,
      timers
    });
    await Promise.resolve();

    changeListener?.({ folderPath: "/project", fileName: "shot_a.tiff" });
    changeListener?.({ folderPath: "/project", fileName: "shot_a.tiff" });
    vi.advanceTimersByTime(499);

    expect(refreshExternalImportState).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(api.watchWorkspaceFolder).toHaveBeenCalledWith("/project", expect.any(Function));
    expect(timers.clearTimeout).toHaveBeenCalledTimes(1);
    expect(refreshExternalImportState).toHaveBeenCalledTimes(1);

    cleanup();

    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it("does not check external changes while the workspace is saving", async () => {
    const api = {
      checkExternalChanges: vi.fn(),
      importSwbFormat: vi.fn()
    };

    await refreshWorkspaceExternalImportState({
      api,
      blankShotPreset: "16:9",
      checkIdRef: { current: 0 },
      dirtyShotIds: () => [],
      folderPathRef: { current: "/scene" },
      hasOnlyCompatibleExternalEdits: () => false,
      loadFolderScan: vi.fn(),
      metadataPathRef: { current: "/scene/.storyboard-workbench/storyboard.project.json" },
      mergeExternalImageChanges: vi.fn(),
      persistResolvedExternalProject: vi.fn(),
      projectNeedsSwbImport: () => false,
      projectRef: { current: { id: "project-1" } },
      runWithStatus: async (_label, action) => action(),
      setProject: vi.fn(),
      setScriptImportNeeded: vi.fn(),
      workspaceSaveStateRef: { current: "saving" }
    });

    expect(api.checkExternalChanges).not.toHaveBeenCalled();
    expect(api.importSwbFormat).not.toHaveBeenCalled();
  });

  it("auto-imports compatible external edits and loads the imported scan", async () => {
    const project = { id: "project-1", shots: [{ id: "shot-1" }] };
    const nextProject = { id: "project-1", shots: [{ id: "shot-1", external: true }] };
    const importedScan = {
      folderPath: "/scene",
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
      project: nextProject
    };
    const api = {
      checkExternalChanges: vi.fn(async () => ({
        images: [{ fileName: "shot_0010.tiff" }],
        scriptImportNeeded: true
      })),
      importSwbFormat: vi.fn(async () => importedScan)
    };
    const loadFolderScan = vi.fn(async () => nextProject);
    const setProject = vi.fn();
    const setScriptImportNeeded = vi.fn();

    await refreshWorkspaceExternalImportState({
      api,
      blankShotPreset: "2.39:1",
      checkIdRef: { current: 0 },
      dirtyShotIds: () => ["shot-1"],
      folderPathRef: { current: "/scene" },
      hasOnlyCompatibleExternalEdits: (candidate) => candidate === nextProject,
      loadFolderScan,
      metadataPathRef: { current: "/scene/.storyboard-workbench/storyboard.project.json" },
      mergeExternalImageChanges: vi.fn(() => nextProject),
      persistResolvedExternalProject: vi.fn(),
      projectNeedsSwbImport: () => false,
      projectRef: { current: project },
      runWithStatus: async (_label, action) => action(),
      setProject,
      setScriptImportNeeded,
      workspaceSaveStateRef: { current: "saved" }
    });

    expect(api.checkExternalChanges).toHaveBeenCalledWith({
      project,
      folderPath: "/scene",
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json"
    });
    expect(api.importSwbFormat).toHaveBeenCalledWith({
      project: nextProject,
      folderPath: "/scene",
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
      blankShotPreset: "2.39:1",
      dirtyShotIds: ["shot-1"],
      preserveDirtyShotLayers: true
    });
    expect(loadFolderScan).toHaveBeenCalledWith(
      importedScan,
      "Imported external Photoshop edits",
      false,
      true
    );
    expect(setProject).not.toHaveBeenCalled();
    expect(setScriptImportNeeded).not.toHaveBeenCalled();
  });
});
