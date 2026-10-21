import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyFileReplacements } from "./fileRenames.js";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";
import { recoverFailedSave } from "./saveRecovery.js";
import { createSavePreparationDirectory } from "./tiffPreparation.js";

const prepareReplacement = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "swb-save-cleanup-"));
  const tempFolderPath = path.join(root, "save-tmp");
  const backupFolderPath = path.join(root, "save-backup");
  const tempPath = path.join(tempFolderPath, "shot.tiff");
  const targetPath = path.join(root, "shot.tiff");
  const backupPath = path.join(backupFolderPath, "shot.tiff");
  const oldBytes = Buffer.from("synthetic old TIFF bytes");
  const newBytes = Buffer.from("synthetic new TIFF bytes");
  const preparationDirectory = await createSavePreparationDirectory(tempFolderPath);
  const backupDirectory = await createSavePreparationDirectory(backupFolderPath);
  await writeFile(targetPath, oldBytes);
  await writeFile(tempPath, newBytes);
  const applied = await applyFileReplacements([{ tempPath, targetPath, backupPath }], {
    mkdir: async (directory) => { await mkdir(directory, { recursive: true }); },
    rename,
    unlink
  });
  return { root, tempFolderPath, backupFolderPath, preparationDirectory, backupDirectory, targetPath, backupPath, oldBytes, newBytes, applied };
};

describe("withSuccessfulSaveArtifactCleanup", () => {
  it("retains a different directory at the same artifact path before committing or deleting", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "swb-cleanup-identity-"));
    const tempFolderPath = path.join(root, "owned"), backupFolderPath = path.join(tempFolderPath, ".backups");
    const preparationDirectory = await createSavePreparationDirectory(tempFolderPath);
    await rename(tempFolderPath, path.join(root, "retained-original"));
    await mkdir(tempFolderPath);
    await writeFile(path.join(tempFolderPath, "later-edit"), "do not delete");
    const applied = { commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined) };
    const remove = vi.fn<typeof rm>(rm);
    const wrapped = withSuccessfulSaveArtifactCleanup(applied, {
      tempFolderPath, backupFolderPath, remove, preparationDirectory
    } as any);
    try {
      await expect(wrapped.commit()).rejects.toMatchObject({ recoveryIncomplete: true, retainedPaths: [tempFolderPath] });
      expect(applied.commit).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(await readFile(path.join(tempFolderPath, "later-edit"), "utf8")).toBe("do not delete");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
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
        preparationDirectory: fixture.preparationDirectory,
        backupDirectory: fixture.backupDirectory,
        remove
      });
      try {
        expect(await readFile(fixture.targetPath)).toEqual(fixture.newBytes);
        expect(await readFile(fixture.backupPath)).toEqual(fixture.oldBytes);
        let saveError: unknown;
        // Cleanup failure must be an explicit incomplete result, never success
        // or a rollback after backup deletion has started.
        try {
          await wrapped.commit();
        } catch (error) {
          saveError = error;
          await expect(recoverFailedSave(error, { appliedTiffReplacements: wrapped })).rejects.toMatchObject({ recoveryIncomplete: true });
        }
        const targetBytes = await readFile(fixture.targetPath).catch(() => null);
        expect(targetBytes).toEqual(fixture.newBytes);
        expect(saveError).toMatchObject({ recoveryIncomplete: true, retainedPaths: [fixture[failedFolder]] });
        expect(rollback).not.toHaveBeenCalled();
        expect(remove.mock.calls.map(([folder]) => folder)).toEqual([
          fixture.tempFolderPath, fixture.backupFolderPath
        ]);
        expect(warning).not.toHaveBeenCalled();
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
    const fixture = await prepareReplacement();
    const applied = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    };
    const remove = vi.fn<typeof rm>(rm);
    const wrapped = withSuccessfulSaveArtifactCleanup(applied, { ...fixture, remove });
    try {
      await wrapped.commit();
      expect(applied.commit).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith(fixture.tempFolderPath, { recursive: true, force: true });
      expect(remove).toHaveBeenCalledWith(fixture.backupFolderPath, { recursive: true, force: true });
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
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
      preparationDirectory: fixture.preparationDirectory,
      backupDirectory: fixture.backupDirectory,
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
    }, { tempFolderPath: "/synthetic/temp", backupFolderPath: "/synthetic/backup", remove,
      preparationDirectory: { directoryPath: "/synthetic/temp", identity: { dev: "unused", ino: "unused" } } });
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
      preparationDirectory: { directoryPath: "/scene/.storyboard-workbench/save-tmp/save-123", identity: { dev: "unused", ino: "unused" } },
      remove
    });

    await wrapped.rollback();

    expect(applied.rollback).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });
});
