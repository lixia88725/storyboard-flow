import { classifyPendingBake, pendingBakeForProject } from "../shared/pendingBake";
import type { Project } from "../shared/types";
import type { WorkspaceSaveState } from "./workspaceLifecycleState";

export type WorkspaceStatusPresentation = {
  state: WorkspaceSaveState | "pending";
  message: string;
  metadataState: WorkspaceSaveState;
};

// Presentation only. Metadata ACK is not working-TIFF completion, nor recovery authority.
export const deriveWorkspaceStatusPresentation = (input: {
  metadataState: WorkspaceSaveState;
  message: string;
  project: Project;
  owner?: { hasUnsavedWork: () => boolean; readonly lastError: unknown };
  recoveryRequired?: string;
}): WorkspaceStatusPresentation => {
  const { metadataState, owner, project, recoveryRequired } = input;
  let state: WorkspaceStatusPresentation["state"] = metadataState;
  if (owner) {
    const classification = classifyPendingBake(project);
    const unknown = classification === "unsupported" || classification === "corrupt" ||
      Object.values(pendingBakeForProject(project).shots).some(entry => entry.state === "unknown");
    if (recoveryRequired || owner.lastError || unknown || metadataState === "error") state = "error";
    else if (owner.hasUnsavedWork()) state = metadataState === "saving" ? "saving" : "pending";
  }
  // This exact success comes from explicit Save. Later obligations cannot reuse it.
  const message = state !== "saved" && input.message === "Saved and synced file names"
    ? state === "error" ? "Workspace incomplete; recovery required" : "Working TIFF output pending Save"
    : input.message;
  return { state, message, metadataState };
};
