import { afterEach, describe, expect, it, vi } from "vitest";
import { persistWorkspaceProject, registerWorkspaceAutosave } from "./workspaceAutosaveController";
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

  it("persists the workspace project and marks autosave state as saved", async () => {
    const project = createProject("Demo");
    const api = {
      autosaveWorkspace: vi.fn(async () => undefined)
    };
    const scriptImportCheckIdRef = { current: 3 };
    const setAutosaveError = vi.fn();
    const setScriptImportNeeded = vi.fn();
    const setWorkspaceSaveState = vi.fn();

    await persistWorkspaceProject({
      activeFolderPath: "/project",
      activeMetadataPath: "/project/.storyboard-workbench/project.json",
      api,
      now: () => new Date("2026-06-15T01:02:03.000Z"),
      projectToSave: project,
      scriptImportCheckIdRef,
      setAutosaveError,
      setScriptImportNeeded,
      setWorkspaceSaveState
    });

    expect(api.autosaveWorkspace).toHaveBeenCalledWith({
      project: { ...project, updatedAt: "2026-06-15T01:02:03.000Z" },
      folderPath: "/project",
      metadataPath: "/project/.storyboard-workbench/project.json"
    });
    expect(scriptImportCheckIdRef.current).toBe(4);
    expect(setScriptImportNeeded).toHaveBeenCalledWith(false);
    expect(setWorkspaceSaveState).toHaveBeenCalledWith("saved");
    expect(setAutosaveError).toHaveBeenCalledWith(expect.any(Function));
  });

  it("skips persistence when the workspace API or paths are unavailable", async () => {
    const api = {
      autosaveWorkspace: vi.fn(async () => undefined)
    };
    const setAutosaveError = vi.fn();
    const setScriptImportNeeded = vi.fn();
    const setWorkspaceSaveState = vi.fn();

    await persistWorkspaceProject({
      activeFolderPath: undefined,
      activeMetadataPath: "/project/.storyboard-workbench/project.json",
      api,
      projectToSave: createProject(),
      scriptImportCheckIdRef: { current: 0 },
      setAutosaveError,
      setScriptImportNeeded,
      setWorkspaceSaveState
    });

    expect(api.autosaveWorkspace).not.toHaveBeenCalled();
    expect(setScriptImportNeeded).not.toHaveBeenCalled();
    expect(setWorkspaceSaveState).not.toHaveBeenCalled();
    expect(setAutosaveError).not.toHaveBeenCalled();
  });

  it("leaves failure reporting to the caller when workspace persistence fails", async () => {
    const setAutosaveError = vi.fn();
    const setScriptImportNeeded = vi.fn();
    const setWorkspaceSaveState = vi.fn();

    await expect(
      persistWorkspaceProject({
        activeFolderPath: "/project",
        activeMetadataPath: "/project/.storyboard-workbench/project.json",
        api: {
          autosaveWorkspace: vi.fn(async () => {
            throw new Error("disk full");
          })
        },
        projectToSave: createProject(),
        scriptImportCheckIdRef: { current: 0 },
        setAutosaveError,
        setScriptImportNeeded,
        setWorkspaceSaveState
      })
    ).rejects.toThrow("disk full");

    expect(setScriptImportNeeded).not.toHaveBeenCalled();
    expect(setWorkspaceSaveState).not.toHaveBeenCalled();
    expect(setAutosaveError).not.toHaveBeenCalled();
  });
});
