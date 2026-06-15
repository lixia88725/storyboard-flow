export type WorkspaceTaskKind = "save" | "import" | "open";

export type WorkspaceTaskProgress = {
  kind?: WorkspaceTaskKind;
  label?: string;
  current: number;
  total: number;
};

export type WorkspaceTaskProgressReporter = (progress: WorkspaceTaskProgress) => void;

export type WorkspaceTaskProgressSender = {
  send: (channel: "workspace:taskProgress", progress: WorkspaceTaskProgress & { kind: WorkspaceTaskKind }) => void;
};

export const workspaceTaskProgressPayload = (
  kind: WorkspaceTaskKind,
  progress: WorkspaceTaskProgress
): WorkspaceTaskProgress & { kind: WorkspaceTaskKind } => ({
  ...progress,
  kind
});

export const createWorkspaceTaskProgressReporter =
  (sender: WorkspaceTaskProgressSender, kind: WorkspaceTaskKind): WorkspaceTaskProgressReporter =>
  (progress) => {
    sender.send("workspace:taskProgress", workspaceTaskProgressPayload(kind, progress));
  };
