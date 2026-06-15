import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerWorkspaceFocusRefresh,
  registerWorkspaceFolderWatchRefresh
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
});
