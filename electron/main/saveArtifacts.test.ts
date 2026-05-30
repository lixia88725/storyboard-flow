import { describe, expect, it, vi } from "vitest";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";

describe("withSuccessfulSaveArtifactCleanup", () => {
  it("removes successful save temp and backup folders after replacement commit", async () => {
    const applied = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    };
    const remove = vi.fn(async () => undefined);

    const wrapped = withSuccessfulSaveArtifactCleanup(applied, {
      tempFolderPath: "/scene/.storyboard-workbench/save-tmp/save-123",
      backupFolderPath: "/scene/.storyboard-workbench/save-backup/save-123",
      remove
    });

    await wrapped.commit();

    expect(applied.commit).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("/scene/.storyboard-workbench/save-tmp/save-123", {
      recursive: true,
      force: true
    });
    expect(remove).toHaveBeenCalledWith("/scene/.storyboard-workbench/save-backup/save-123", {
      recursive: true,
      force: true
    });
  });

  it("does not remove save artifacts during rollback", async () => {
    const applied = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    };
    const remove = vi.fn(async () => undefined);

    const wrapped = withSuccessfulSaveArtifactCleanup(applied, {
      tempFolderPath: "/scene/.storyboard-workbench/save-tmp/save-123",
      backupFolderPath: "/scene/.storyboard-workbench/save-backup/save-123",
      remove
    });

    await wrapped.rollback();

    expect(applied.rollback).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });
});
