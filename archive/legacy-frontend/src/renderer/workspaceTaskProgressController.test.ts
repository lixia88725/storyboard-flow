import { describe, expect, it, vi } from "vitest";
import {
  nextWorkspaceTaskFromProgress,
  registerWorkspaceTaskProgressListener,
  type WorkspaceTaskProgressApi
} from "./workspaceTaskProgressController";
import type { WorkspaceTask } from "./workspaceLifecycleState";

describe("workspaceTaskProgressController", () => {
  it("updates matching workspace task progress and keeps non-matching tasks unchanged", () => {
    const saveTask: WorkspaceTask = {
      kind: "save",
      label: "Saving...",
      current: 0,
      total: 3
    };
    const importTask: WorkspaceTask = {
      kind: "import",
      label: "Importing...",
      current: 0,
      total: 3
    };

    expect(
      nextWorkspaceTaskFromProgress(saveTask, {
        kind: "save",
        current: 1,
        total: 3
      })
    ).toEqual({
      kind: "save",
      label: "Writing changed TIFFs...",
      current: 1,
      total: 3
    });
    expect(
      nextWorkspaceTaskFromProgress(importTask, {
        kind: "save",
        current: 1,
        total: 3
      })
    ).toBe(importTask);
  });

  it("prefers explicit progress labels over default save label", () => {
    const task: WorkspaceTask = {
      kind: "save",
      label: "Saving...",
      current: 0,
      total: 3
    };

    expect(
      nextWorkspaceTaskFromProgress(task, {
        kind: "save",
        label: "Baking TIFFs...",
        current: 2,
        total: 3
      })
    ).toEqual({
      kind: "save",
      label: "Baking TIFFs...",
      current: 2,
      total: 3
    });
  });

  it("registers workspace task progress listener until cleanup", () => {
    let listener:
      | Parameters<WorkspaceTaskProgressApi["onWorkspaceTaskProgress"]>[0]
      | undefined;
    const removeListener = vi.fn();
    const api: WorkspaceTaskProgressApi = {
      onWorkspaceTaskProgress: vi.fn((callback) => {
        listener = callback;
        return removeListener;
      })
    };
    const setWorkspaceTask = vi.fn((update) => {
      expect(typeof update).toBe("function");
      return update({ kind: "save", label: "Saving...", current: 0, total: 1 });
    });

    const cleanup = registerWorkspaceTaskProgressListener(api, setWorkspaceTask);
    listener?.({ kind: "save", current: 1, total: 1 });

    expect(setWorkspaceTask).toHaveBeenCalledTimes(1);

    cleanup();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
