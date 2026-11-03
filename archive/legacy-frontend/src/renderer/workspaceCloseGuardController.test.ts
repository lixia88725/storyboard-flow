import { describe, expect, it, vi } from "vitest";
import {
  updateWorkspaceCloseGuard,
  workspaceCloseGuardPayload,
  type WorkspaceCloseGuardApi
} from "./workspaceCloseGuardController";

describe("workspaceCloseGuardController", () => {
  it("marks workspace as unsaved when dirty shots are present", () => {
    expect(
      workspaceCloseGuardPayload({
        dirtyShotCount: 1,
        workspaceSaveState: "saved",
        fileNameSyncState: "synced"
      })
    ).toEqual({ hasUnsavedChanges: true });
  });

  it("marks workspace as clean only when there are no dirty shots and save state is synced", () => {
    expect(
      workspaceCloseGuardPayload({
        dirtyShotCount: 0,
        workspaceSaveState: "saved",
        fileNameSyncState: "synced"
      })
    ).toEqual({ hasUnsavedChanges: false });
    expect(
      workspaceCloseGuardPayload({
        dirtyShotCount: 0,
        workspaceSaveState: "saving",
        fileNameSyncState: "synced"
      })
    ).toEqual({ hasUnsavedChanges: true });
    expect(
      workspaceCloseGuardPayload({
        dirtyShotCount: 0,
        workspaceSaveState: "saved",
        fileNameSyncState: "unsynced"
      })
    ).toEqual({ hasUnsavedChanges: true });
  });

  it("updates the Electron close guard with the computed payload", async () => {
    const api: WorkspaceCloseGuardApi = {
      updateCloseGuard: vi.fn(async () => undefined)
    };

    await updateWorkspaceCloseGuard(api, {
      dirtyShotCount: 0,
      workspaceSaveState: "saved",
      fileNameSyncState: "synced"
    });

    expect(api.updateCloseGuard).toHaveBeenCalledWith({ hasUnsavedChanges: false });
  });
});
