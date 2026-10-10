import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyFileReplacements } from "./fileRenames.js";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";

const prepareReplacement = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "swb-save-cleanup-"));
  const tempFolderPath = path.join(root, "save-tmp");
  const backupFolderPath = path.join(root, "save-backup");
  const tempPath = path.join(tempFolderPath, "shot.tiff");
  const targetPath = path.join(root, "shot.tiff");
  const backupPath = path.join(backupFolderPath, "shot.tiff");
  const oldBytes = Buffer.from("synthetic old TIFF bytes");
  const newBytes = Buffer.from("synthetic new TIFF bytes");
  await mkdir(tempFolderPath);
  await writeFile(targetPath, oldBytes);
  await writeFile(tempPath, newBytes);
  const applied = await applyFileReplacements([{ tempPath, targetPath, backupPath }], {
    mkdir: async (directory) => { await mkdir(directory, { recursive: true }); },
    rename,
    unlink
  });
  return { root, tempFolderPath, backupFolderPath, targetPath, backupPath, oldBytes, newBytes, applied };
};

describe("withSuccessfulSaveArtifactCleanup", () => {
  it.each(["tempFolderPath", "backupFolderPath"] as const)(
    "preserves committed TIFF bytes when %s cleanup fails instead of entering Save rollback",
    async (failedFolder) => {
      const fixture = await prepareReplacement();
      const cleanupError = new Error(`injected ${failedFolder} rm failure`);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const rollback = vi.fn(fixture.applied.rollback);
      const remove = vi.fn<typeof rm>(async (folder, options) => {
        if (folder === fixture[failedFolder]) throw cleanupError;
        await rm(folder, options);
      });
      const wrapped = withSuccessfulSaveArtifactCleanup({ ...fixture.applied, rollback }, {
        tempFolderPath: fixture.tempFolderPath,
        backupFolderPath: fixture.backupFolderPath,
        remove
      });
      try {
        expect(await readFile(fixture.targetPath)).toEqual(fixture.newBytes);
        expect(await readFile(fixture.backupPath)).toEqual(fixture.oldBytes);
        let saveError: unknown;
        // Match Save's catch: a rejected commit causes rollback, even after backups were deleted.
        try {
          await wrapped.commit();
        } catch (error) {
          saveError = error;
          await wrapped.rollback();
        }
        const targetBytes = await readFile(fixture.targetPath).catch(() => null);
        expect(targetBytes).toEqual(fixture.newBytes);
        expect(saveError).toBeUndefined();
        expect(rollback).not.toHaveBeenCalled();
        expect(remove.mock.calls.map(([folder]) => folder)).toEqual([
          fixture.tempFolderPath, fixture.backupFolderPath
        ]);
        expect(warning).toHaveBeenCalledWith(
          expect.stringContaining(fixture[failedFolder]), cleanupError
        );
        expect((await stat(fixture[failedFolder])).isDirectory()).toBe(true);
        const otherFolder = failedFolder === "tempFolderPath" ? "backupFolderPath" : "tempFolderPath";
        await expect(stat(fixture[otherFolder])).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(fixture.backupPath)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        warning.mockRestore();
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  );
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

  it("propagates underlying commit failure and still restores original bytes on rollback", async () => {
    const fixture = await prepareReplacement();
    const commitError = new Error("replacement commit failed");
    const remove = vi.fn<typeof rm>(rm);
    const rollback = vi.fn(fixture.applied.rollback);
    const wrapped = withSuccessfulSaveArtifactCleanup({
      commit: async () => { throw commitError; },
      rollback
    }, {
      tempFolderPath: fixture.tempFolderPath,
      backupFolderPath: fixture.backupFolderPath,
      remove
    });
    try {
      await expect(wrapped.commit()).rejects.toBe(commitError);
      expect(remove).not.toHaveBeenCalled();
      expect(await readFile(fixture.backupPath)).toEqual(fixture.oldBytes);
      await wrapped.rollback();
      expect(rollback).toHaveBeenCalledOnce();
      expect(await readFile(fixture.targetPath)).toEqual(fixture.oldBytes);
      expect((await stat(fixture.tempFolderPath)).isDirectory()).toBe(true);
      expect((await stat(fixture.backupFolderPath)).isDirectory()).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("propagates underlying rollback failure without cleaning artifacts", async () => {
    const rollbackError = new Error("rollback failed");
    const remove = vi.fn(async () => undefined);
    const wrapped = withSuccessfulSaveArtifactCleanup({
      commit: async () => undefined,
      rollback: async () => { throw rollbackError; }
    }, { tempFolderPath: "/synthetic/temp", backupFolderPath: "/synthetic/backup", remove });
    await expect(wrapped.rollback()).rejects.toBe(rollbackError);
    expect(remove).not.toHaveBeenCalled();
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
