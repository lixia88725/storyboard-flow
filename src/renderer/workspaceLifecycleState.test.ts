import { describe, expect, it } from "vitest";
import { initialWorkspaceLifecycleState } from "./workspaceLifecycleState";

describe("workspaceLifecycleState", () => {
  it("uses the existing workspace lifecycle defaults", () => {
    const state = initialWorkspaceLifecycleState();

    expect(state.project.name).toBe("Untitled Storyboard");
    expect(state.project.shots).toEqual([]);
    expect(state.folderPath).toBeUndefined();
    expect(state.folderInputValue).toBe("");
    expect(state.metadataPath).toBeUndefined();
    expect(state.workspaceSaveState).toBe("saved");
    expect(state.workspaceTask).toBeUndefined();
    expect(state.fileNameSyncState).toBe("synced");
    expect(state.recentFolders).toEqual([]);
    expect(state.autosaveRevision).toBe(0);
  });
});
