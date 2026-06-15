import { describe, expect, it } from "vitest";
import {
  hasUnsavedWorkspaceChanges,
  shouldAutosaveAfterLoad,
  shouldPersistLoadedProject,
  shouldRunAutosave
} from "./workspacePersistenceController";

describe("workspacePersistenceController", () => {
  it("runs autosave only when the workspace has an API and active paths after the initial revision", () => {
    expect(
      shouldRunAutosave(0, "/scene", "/scene/.storyboard-workbench/storyboard.project.json", true)
    ).toBe(false);
    expect(
      shouldRunAutosave(1, "", "/scene/.storyboard-workbench/storyboard.project.json", true)
    ).toBe(false);
    expect(
      shouldRunAutosave(1, "/scene", "/scene/.storyboard-workbench/storyboard.project.json", true)
    ).toBe(true);
  });

  it("reports unsaved changes when dirty shots, save state, or filename sync are pending", () => {
    expect(
      hasUnsavedWorkspaceChanges(0, "saved", "synced")
    ).toBe(false);
    expect(
      hasUnsavedWorkspaceChanges(1, "saved", "synced")
    ).toBe(true);
    expect(
      hasUnsavedWorkspaceChanges(0, "saving", "synced")
    ).toBe(true);
    expect(
      hasUnsavedWorkspaceChanges(0, "saved", "unsynced")
    ).toBe(true);
  });

  it("persists loaded projects only for metadata-only project changes without import or dirty output", () => {
    expect(
      shouldPersistLoadedProject(true, true, false, false, false)
    ).toBe(true);
    expect(
      shouldPersistLoadedProject(false, true, false, false, false)
    ).toBe(false);
    expect(
      shouldPersistLoadedProject(true, true, false, false, true)
    ).toBe(false);
  });

  it("autosaves after load when output changed and no script import is pending", () => {
    expect(
      shouldAutosaveAfterLoad(false, false, false, false)
    ).toBe(false);
    expect(
      shouldAutosaveAfterLoad(true, false, false, false)
    ).toBe(true);
    expect(
      shouldAutosaveAfterLoad(true, false, false, true)
    ).toBe(false);
  });
});
