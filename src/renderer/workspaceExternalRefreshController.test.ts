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

    const normalSaveRefresh = vi.fn(async () => false);
    await refreshWorkspaceExternalImportState({
      api, normalSaveRefresh,
      checkIdRef: { current: 0 }, folderPathRef: { current: "/scene" },
      metadataPathRef: { current: "/scene/.storyboard-workbench/storyboard.project.json" },
      mergeExternalImageChanges: vi.fn(), setScriptImportNeeded: vi.fn(),
      workspaceSaveStateRef: { current: "saving" }
    });

    expect(normalSaveRefresh).not.toHaveBeenCalled();
    expect(api.checkExternalChanges).not.toHaveBeenCalled();
    expect(api.importSwbFormat).not.toHaveBeenCalled();
  });

  it("delegates compatible scan handling to the owner domain and uses its script completion", async () => {
    const project = { id: "project-1", shots: [{ id: "shot-1" }] };
    const nextProject = { id: "project-1", shots: [{ id: "shot-1", external: true }] };
    const api = {
      checkExternalChanges: vi.fn(async () => ({ images: [{ fileName: "shot_0010.tiff" }], scriptImportNeeded: true })),
      importSwbFormat: vi.fn()
    };
    // Only the ownership-domain port is substituted in this unit test. Real
    // automatic Import/persistence is covered by normalSaveImageImportChain.
    const normalSaveRefresh = vi.fn(async (read: (p: typeof project) => Promise<typeof project>, isCurrent: () => boolean) => {
      expect(isCurrent()).toBe(true);
      expect(await read(project)).toBe(nextProject);
      return { accepted: true, scriptImportNeeded: false };
    });
    const setScriptImportNeeded = vi.fn();
    await refreshWorkspaceExternalImportState({
      api, normalSaveRefresh,
      checkIdRef: { current: 0 }, folderPathRef: { current: "/scene" },
      metadataPathRef: { current: "/scene/.storyboard-workbench/storyboard.project.json" },
      mergeExternalImageChanges: () => nextProject, setScriptImportNeeded,
      workspaceSaveStateRef: { current: "saved" }
    });
    expect(api.checkExternalChanges).toHaveBeenCalledWith({
      project, folderPath: "/scene", metadataPath: "/scene/.storyboard-workbench/storyboard.project.json", normalSave: true
    });
    expect(normalSaveRefresh).toHaveBeenCalledOnce();
    expect(api.importSwbFormat).not.toHaveBeenCalled();
    expect(setScriptImportNeeded).toHaveBeenCalledWith(false);
  });

});
