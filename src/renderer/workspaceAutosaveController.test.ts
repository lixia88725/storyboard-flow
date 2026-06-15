import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWorkspaceAutosave } from "./workspaceAutosaveController";
import { createProject } from "../shared/projectOps";

describe("workspaceAutosaveController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("captures the active workspace refs and persists after the autosave delay", async () => {
    vi.useFakeTimers();
    const project = createProject();
    const persistWorkspace = vi.fn(async () => undefined);
    const timers = {
      setTimeout: vi.fn((callback: () => void, delayMs: number) =>
        globalThis.setTimeout(callback, delayMs) as unknown as number
      ),
      clearTimeout: vi.fn((timeoutId: number) =>
        globalThis.clearTimeout(timeoutId as unknown as ReturnType<typeof globalThis.setTimeout>)
      )
    };

    registerWorkspaceAutosave({
      autosaveRevision: 1,
      folderPathRef: { current: "/project" },
      hasStoryboardApi: true,
      metadataPathRef: { current: "/project/.storyboard-workbench/project.json" },
      persistWorkspace,
      projectRef: { current: project },
      setAutosaveError: vi.fn(),
      setStatus: vi.fn(),
      setWorkspaceSaveState: vi.fn(),
      timers
    });

    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 600);

    vi.advanceTimersByTime(600);
    await Promise.resolve();

    expect(persistWorkspace).toHaveBeenCalledWith(
      project,
      "/project",
      "/project/.storyboard-workbench/project.json"
    );
  });

  it("reports autosave failures through the existing save state, notice, and status channels", async () => {
    vi.useFakeTimers();
    const setAutosaveError = vi.fn();
    const setStatus = vi.fn();
    const setWorkspaceSaveState = vi.fn();

    registerWorkspaceAutosave({
      autosaveRevision: 1,
      folderPathRef: { current: "/project" },
      hasStoryboardApi: true,
      metadataPathRef: { current: "/project/.storyboard-workbench/project.json" },
      persistWorkspace: vi.fn(async () => {
        throw new Error("disk full");
      }),
      projectRef: { current: createProject() },
      setAutosaveError,
      setStatus,
      setWorkspaceSaveState,
      timers: {
        setTimeout: (callback, delayMs) =>
          globalThis.setTimeout(callback, delayMs) as unknown as number,
        clearTimeout: (timeoutId) =>
          globalThis.clearTimeout(timeoutId as unknown as ReturnType<typeof globalThis.setTimeout>)
      }
    });

    expect(setWorkspaceSaveState).toHaveBeenCalledWith("saving");

    vi.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();

    expect(setWorkspaceSaveState).toHaveBeenCalledWith("error");
    expect(setAutosaveError).toHaveBeenCalledWith(expect.any(Function));
    expect(setStatus).toHaveBeenCalledWith("Autosave failed: disk full");
  });
});
