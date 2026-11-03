import { useEffect } from "react";
import type { WorkspaceTask } from "./workspaceLifecycleState";

export type WorkspaceTaskProgress = {
  kind: WorkspaceTask["kind"];
  label?: string;
  current: number;
  total: number;
};

export type WorkspaceTaskProgressApi = {
  onWorkspaceTaskProgress: (callback: (progress: WorkspaceTaskProgress) => void) => () => void;
};

export const nextWorkspaceTaskFromProgress = (
  task: WorkspaceTask | undefined,
  progress: WorkspaceTaskProgress
): WorkspaceTask | undefined => {
  if (!task || task.kind !== progress.kind) {
    return task;
  }

  return {
    ...task,
    label: progress.label ?? (progress.kind === "save" ? "Writing changed TIFFs..." : task.label),
    current: progress.current,
    total: progress.total
  };
};

export const registerWorkspaceTaskProgressListener = (
  api: WorkspaceTaskProgressApi,
  setWorkspaceTask: (update: (task: WorkspaceTask | undefined) => WorkspaceTask | undefined) => void
): (() => void) =>
  api.onWorkspaceTaskProgress((progress) => {
    setWorkspaceTask((task) => nextWorkspaceTaskFromProgress(task, progress));
  });

export const useWorkspaceTaskProgressController = (
  setWorkspaceTask: (update: (task: WorkspaceTask | undefined) => WorkspaceTask | undefined) => void
): void => {
  useEffect(() => {
    if (!window.storyboard) {
      return;
    }

    return registerWorkspaceTaskProgressListener(window.storyboard, setWorkspaceTask);
  }, [setWorkspaceTask]);
};
