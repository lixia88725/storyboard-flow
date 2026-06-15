import type { WorkspaceTask } from "./workspaceLifecycleState";

export type StoryboardScriptImportDraft = {
  sourceMarkdownPath: string;
  fileName: string;
  entryCount: number;
  targetFolderPath: string;
};

export const workspaceTaskUnitLabel = (kind: WorkspaceTask["kind"]): "images" | "shots" =>
  kind === "open" ? "images" : "shots";

export const WorkspaceTaskProgressBanner = ({
  workspaceTask
}: {
  workspaceTask: WorkspaceTask | undefined;
}) => {
  if (!workspaceTask) {
    return null;
  }

  return (
    <div className="workspace-task-progress" role="status" aria-live="polite">
      <div className="workspace-task-progress-copy">
        <span>{workspaceTask.label}</span>
        <span>
          {workspaceTask.current} / {workspaceTask.total}{" "}
          {workspaceTaskUnitLabel(workspaceTask.kind)}
        </span>
      </div>
      <div className="workspace-task-progress-track" aria-hidden="true">
        <div className="workspace-task-progress-line" />
      </div>
    </div>
  );
};

export const SaveErrorModal = ({
  message,
  onDismiss
}: {
  message: string | undefined;
  onDismiss: () => void;
}) => {
  if (!message) {
    return null;
  }

  return (
    <div className="save-error-modal-backdrop" role="presentation">
      <section
        className="save-error-modal"
        role="alertdialog"
        aria-label="Save failed"
        aria-modal="true"
      >
        <header>
          <strong>Save failed</strong>
        </header>
        <p>{message}</p>
        <div className="save-error-actions">
          <button type="button" className="primary" autoFocus onClick={onDismiss}>
            OK
          </button>
        </div>
      </section>
    </div>
  );
};

export const StoryboardScriptImportModal = ({
  draft,
  isWorkspaceTaskRunning,
  onCancel,
  onCreateProject,
  onSelectTargetFolder
}: {
  draft: StoryboardScriptImportDraft | undefined;
  isWorkspaceTaskRunning: boolean;
  onCancel: () => void;
  onCreateProject: () => Promise<unknown>;
  onSelectTargetFolder: () => Promise<unknown>;
}) => {
  if (!draft) {
    return null;
  }

  return (
    <div className="script-import-modal-backdrop" role="presentation">
      <section
        className="script-import-modal"
        role="dialog"
        aria-label="Create storyboard from Markdown"
      >
        <header>
          <strong>导入文字分镜脚本？</strong>
          <button type="button" aria-label="Cancel storyboard script import" onClick={onCancel}>
            x
          </button>
        </header>
        <p>
          {draft.fileName} 里有 {draft.entryCount} 个镜头条目。
        </p>
        <label className="script-import-target">
          <span>目标文件夹</span>
          <input
            aria-label="Storyboard script target folder"
            value={draft.targetFolderPath}
            readOnly
            placeholder="选择一个空文件夹"
          />
        </label>
        <div className="script-import-actions">
          <button type="button" onClick={() => void onSelectTargetFolder()}>
            Choose Folder
          </button>
          <button
            type="button"
            className="primary"
            disabled={!draft.targetFolderPath || isWorkspaceTaskRunning}
            onClick={() => void onCreateProject()}
          >
            Create Storyboard
          </button>
        </div>
      </section>
    </div>
  );
};
