import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFileMoves, applyFileReplacements } from "./fileRenames.js";
import { beginPendingFileTransaction } from "./pendingFileTransactionService.js";

const fault = vi.hoisted(() => ({ journalPath: "", error: new Error("journal unlink failed") }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: async (filePath: Parameters<typeof actual.unlink>[0]) => {
    if (filePath === fault.journalPath) throw fault.error;
    return actual.unlink(filePath);
  } };
});
import {
  isVisiblePendingPath,
  moveShotsToVisiblePending,
  restoreShotsFromVisiblePending,
  visiblePendingFolderPath
} from "./pendingShotFilesService.js";

const project = {
  shots: [
    { id: "shot-a", imagePath: "/scene/shot-a.tiff", fileName: "shot-a.tiff" }
  ],
  parkedShots: [
    { id: "shot-b", imagePath: "/scene/shot-b.tiff", fileName: "shot-b.tiff" }
  ]
};

const fixtureFolders: string[] = [];
afterEach(async () => {
  fault.journalPath = "";
  await Promise.all(fixtureFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const pendingFixture = async (restore = false) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "pending-commit-"));
  fixtureFolders.push(folder);
  await mkdir(path.join(folder, "Pending"));
  await mkdir(path.join(folder, ".storyboard-workbench"));
  const shots = ["a", "b"].map((id) => ({ id, fileName: `${id}.tiff`, imagePath: path.join(folder, restore ? "Pending" : "", `${id}.tiff`) }));
  const replacements = shots.map((shot) => ({ targetPath: shot.imagePath, tempPath: `${shot.imagePath}.tmp`, backupPath: `${shot.imagePath}.backup` }));
  const oldBytes = Buffer.from([0, 1, 255, 17]);
  const newBytes = Buffer.from([0, 2, 254, 18]);
  for (const item of replacements) {
    await writeFile(item.targetPath, oldBytes);
    await writeFile(item.tempPath, newBytes);
  }
  const metadataPath = path.join(folder, ".storyboard-workbench", "storyboard.project.json");
  await writeFile(metadataPath, JSON.stringify({ shots }));
  const journalPath = path.join(folder, ".storyboard-workbench", "pending-file-transaction.json");
  const options = {
    beginTransaction: (moves: Array<{ fromPath: string; toPath: string }>) => beginPendingFileTransaction(folder, moves),
    finalize: async (files: Array<{ shotId: string; imagePath: string }>) => writeFile(metadataPath, JSON.stringify({ shots: shots.map((shot) => ({ ...shot, imagePath: files.find((file) => file.shotId === shot.id)!.imagePath })) })),
    fingerprint: async (filePath: string) => (await readFile(filePath)).toString("hex"),
    materializeShots: () => applyFileReplacements(replacements, { mkdir: async (directory) => { await mkdir(directory, { recursive: true }); }, rename, unlink }),
    moveFiles: (moves: Array<{ fromPath: string; toPath: string }>) => applyFileMoves(moves, { mkdir: async (directory) => { await mkdir(directory, { recursive: true }); }, rename }),
    uniquePath: async (directory: string, fileName: string) => path.join(directory, fileName)
  };
  return { folder, shots, replacements, oldBytes, newBytes, metadataPath, journalPath, options };
};

const expectPersistedLocations = async (fixture: Awaited<ReturnType<typeof pendingFixture>>, bytes: Buffer) => {
  const saved = JSON.parse(await readFile(fixture.metadataPath, "utf8"));
  for (const shot of saved.shots) {
    expect(await readFile(shot.imagePath)).toEqual(bytes);
    expect(shot.imagePath).not.toBe(fixture.shots.find((original) => original.id === shot.id)!.imagePath);
  }
  expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ version: 1 });
};

describe("pendingShotFilesService", () => {
  it.each([false, true])("commits real file moves and clears the journal (restore=%s)", async (restore) => {
    const fixture = await pendingFixture(restore);
    const operation = restore ? restoreShotsFromVisiblePending : moveShotsToVisiblePending;
    const files = await operation(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options);
    const saved = JSON.parse(await readFile(fixture.metadataPath, "utf8"));
    expect(files).toHaveLength(2);
    for (const shot of saved.shots) expect(await readFile(shot.imagePath)).toEqual(restore ? fixture.oldBytes : fixture.newBytes);
    await expect(readFile(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    if (!restore) for (const item of fixture.replacements) await expect(readFile(item.backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([false, true])("restores real files and clears the journal after a precommit failure (restore=%s)", async (restore) => {
    const fixture = await pendingFixture(restore);
    const originalError = new Error("fingerprint verification failed");
    vi.spyOn(fixture.options, "fingerprint").mockRejectedValue(originalError);
    const operation = restore ? restoreShotsFromVisiblePending : moveShotsToVisiblePending;
    await expect(operation(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options)).rejects.toBe(originalError);
    for (const item of fixture.replacements) {
      expect(await readFile(item.targetPath)).toEqual(fixture.oldBytes);
      expect(await readFile(item.tempPath)).toEqual(fixture.newBytes);
      await expect(readFile(item.backupPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(JSON.parse(await readFile(fixture.metadataPath, "utf8"))).toEqual({ shots: fixture.shots });
    await expect(readFile(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("clears the journal when replacement automatic recovery succeeds without a handle", async () => {
    const fixture = await pendingFixture();
    const originalError = new Error("second install failed");
    fixture.options.materializeShots = () => applyFileReplacements(fixture.replacements, {
      mkdir: async (directory) => { await mkdir(directory, { recursive: true }); }, unlink,
      rename: async (from, to) => {
        if (from === fixture.replacements[1].tempPath) throw originalError;
        await rename(from, to);
      }
    });
    await expect(moveShotsToVisiblePending(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options)).rejects.toBe(originalError);
    for (const item of fixture.replacements) {
      expect(await readFile(item.targetPath)).toEqual(fixture.oldBytes);
      expect(await readFile(item.tempPath)).toEqual(fixture.newBytes);
      await expect(readFile(item.backupPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(readFile(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([false, true])("stops dependent recovery after a rejected move rollback (restore=%s)", async (restore) => {
    const fixture = await pendingFixture(restore);
    const originalError = new Error("fingerprint failed");
    const rollbackError = new Error("move restore failed");
    const materialized = { rollback: vi.fn(async () => undefined) };
    vi.spyOn(fixture.options, "fingerprint").mockRejectedValue(originalError);
    const options = { ...fixture.options,
      materializeShots: async () => materialized,
      moveFiles: async () => ({ rollback: async () => { throw rollbackError; } })
    };
    const operation = restore ? restoreShotsFromVisiblePending : moveShotsToVisiblePending;
    const error = await operation(fixture.folder, { shots: fixture.shots }, ["a", "b"], options).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "PendingRecoveryIncompleteError", errors: [originalError, rollbackError] });
    expect((error as AggregateError).errors[0]).toBe(originalError);
    expect((error as AggregateError).errors[1]).toBe(rollbackError);
    expect(materialized.rollback).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ version: 1 });
  });
  it.each([false, true])("preserves both errors when precommit journal rollback rejects (restore=%s)", async (restore) => {
    const fixture = await pendingFixture(restore);
    const originalError = new Error("fingerprint failed");
    vi.spyOn(fixture.options, "fingerprint").mockRejectedValue(originalError);
    fault.journalPath = fixture.journalPath;
    const operation = restore ? restoreShotsFromVisiblePending : moveShotsToVisiblePending;
    const error = await operation(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "PendingRecoveryIncompleteError", errors: [originalError, fault.error] });
    for (const shot of fixture.shots) expect(await readFile(shot.imagePath)).toEqual(fixture.oldBytes);
    expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ version: 1 });
  });
  it("preserves the triggering error when explicit replacement rollback fails and does not clear the journal", async () => {
    const fixture = await pendingFixture();
    const originalError = new Error("fingerprint failed before commit");
    const recoveryError = new Error("explicit backup restore failed");
    const fingerprint = vi.spyOn(fixture.options, "fingerprint").mockRejectedValue(originalError);
    fixture.options.materializeShots = () => applyFileReplacements(fixture.replacements, {
      mkdir: async (directory) => { await mkdir(directory, { recursive: true }); }, unlink,
      rename: async (from, to) => {
        if (from === fixture.replacements[1].backupPath) throw recoveryError;
        await rename(from, to);
      }
    });
    const error = await moveShotsToVisiblePending(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options).catch((error: unknown) => error);
    expect(fingerprint).toHaveBeenCalled();
    expect(error).toMatchObject({ name: "PendingRecoveryIncompleteError", errors: [originalError, recoveryError] });
    expect((error as Error).message).toContain(originalError.message);
    expect((error as Error).message).toContain(recoveryError.message);
    expect(await readFile(fixture.replacements[0].targetPath)).toEqual(fixture.newBytes);
    expect(await readFile(fixture.replacements[0].backupPath)).toEqual(fixture.oldBytes);
    expect(await readFile(fixture.replacements[1].tempPath)).toEqual(fixture.newBytes);
    expect(await readFile(fixture.replacements[1].backupPath)).toEqual(fixture.oldBytes);
    await expect(readFile(fixture.replacements[1].targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(fixture.metadataPath, "utf8"))).toEqual({ shots: fixture.shots });
    expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ version: 1 });
  });
  it("retains the journal when replacement automatic recovery fails without a handle", async () => {
    const fixture = await pendingFixture();
    const originalError = new Error("second install failed");
    const recoveryError = new Error("second backup restore failed");
    fixture.options.materializeShots = () => applyFileReplacements(fixture.replacements, {
      mkdir: async (directory) => { await mkdir(directory, { recursive: true }); }, unlink,
      rename: async (from, to) => {
        if (from === fixture.replacements[1].tempPath) throw originalError;
        if (from === fixture.replacements[1].backupPath) throw recoveryError;
        await rename(from, to);
      }
    });
    const moveFiles = vi.spyOn(fixture.options, "moveFiles");
    const error = await moveShotsToVisiblePending(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "FileReplacementRecoveryIncompleteError", errors: [originalError, recoveryError] });
    expect(moveFiles).not.toHaveBeenCalled();
    expect(await readFile(fixture.replacements[0].targetPath)).toEqual(fixture.newBytes);
    expect(await readFile(fixture.replacements[0].backupPath)).toEqual(fixture.oldBytes);
    expect(await readFile(fixture.replacements[1].tempPath)).toEqual(fixture.newBytes);
    expect(await readFile(fixture.replacements[1].backupPath)).toEqual(fixture.oldBytes);
    await expect(readFile(fixture.replacements[1].targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(fixture.metadataPath, "utf8"))).toEqual({ shots: fixture.shots });
    expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ version: 1 });
  });
  it.each([false, true])("retains persisted locations when journal cleanup fails (restore=%s)", async (restore) => {
    const fixture = await pendingFixture(restore);
    fault.journalPath = fixture.journalPath;
    const operation = restore ? restoreShotsFromVisiblePending : moveShotsToVisiblePending;
    await expect(operation(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options)).rejects.toMatchObject({
      errors: [fault.error],
      message: expect.stringMatching(/journal unlink failed.*commit.*retained/i)
    });
    await expectPersistedLocations(fixture, restore ? fixture.oldBytes : fixture.newBytes);
    if (!restore) {
      for (const item of fixture.replacements) await expect(readFile(item.backupPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    for (const shot of fixture.shots) await expect(readFile(shot.imagePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([0, 1])("retains persisted Pending locations on backup unlink failure %s", async (failureIndex) => {
    const fixture = await pendingFixture();
    const cleanupError = new Error(`backup unlink ${failureIndex} failed`);
    fixture.options.materializeShots = () => applyFileReplacements(fixture.replacements, {
      mkdir: async (directory) => { await mkdir(directory, { recursive: true }); }, rename,
      unlink: async (filePath) => {
        if (filePath === fixture.replacements[failureIndex].backupPath) throw cleanupError;
        await unlink(filePath);
      }
    });
    await expect(moveShotsToVisiblePending(fixture.folder, { shots: fixture.shots }, ["a", "b"], fixture.options)).rejects.toMatchObject({
      errors: [cleanupError],
      message: expect.stringMatching(/backup unlink.*commit.*retained/i)
    });
    await expectPersistedLocations(fixture, fixture.newBytes);
    for (let index = 0; index < 2; index++) {
      if (index < failureIndex) await expect(readFile(fixture.replacements[index].backupPath)).rejects.toMatchObject({ code: "ENOENT" });
      else expect(await readFile(fixture.replacements[index].backupPath)).toEqual(fixture.oldBytes);
      await expect(readFile(fixture.shots[index].imagePath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it("materializes and moves active or historical parked shots into the visible Pending folder", async () => {
    const materialized = { commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined) };
    const moved = { rollback: vi.fn(async () => undefined) };
    const materializeShots = vi.fn(async () => materialized);
    const moveFiles = vi.fn(async () => moved);

    const result = await moveShotsToVisiblePending(
      "/scene",
      project,
      ["shot-a", "shot-b"],
      {
        fingerprint: async (filePath) => `fingerprint:${path.basename(filePath)}`,
        materializeShots,
        moveFiles,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      }
    );

    expect(materializeShots).toHaveBeenCalledWith(project, new Set(["shot-a", "shot-b"]));
    expect(moveFiles).toHaveBeenCalledWith([
      { fromPath: "/scene/shot-a.tiff", toPath: "/scene/Pending/shot-a.tiff" },
      { fromPath: "/scene/shot-b.tiff", toPath: "/scene/Pending/shot-b.tiff" }
    ]);
    expect(result).toEqual([
      {
        shotId: "shot-a",
        imagePath: "/scene/Pending/shot-a.tiff",
        fileName: "shot-a.tiff",
        baseFingerprint: "fingerprint:shot-a.tiff"
      },
      {
        shotId: "shot-b",
        imagePath: "/scene/Pending/shot-b.tiff",
        fileName: "shot-b.tiff",
        baseFingerprint: "fingerprint:shot-b.tiff"
      }
    ]);
    expect(materialized.commit).toHaveBeenCalledOnce();
    expect(materialized.rollback).not.toHaveBeenCalled();
  });

  it("rolls moved files and materialized TIFFs back when final verification fails", async () => {
    const materialized = { commit: vi.fn(), rollback: vi.fn(async () => undefined) };
    const moved = { rollback: vi.fn(async () => undefined) };

    await expect(
      moveShotsToVisiblePending("/scene", project, ["shot-a"], {
        fingerprint: async () => {
          throw new Error("fingerprint failed");
        },
        materializeShots: async () => materialized,
        moveFiles: async () => moved,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      })
    ).rejects.toThrow("fingerprint failed");

    expect(moved.rollback).toHaveBeenCalledOnce();
    expect(materialized.rollback).toHaveBeenCalledOnce();
    expect(materialized.commit).not.toHaveBeenCalled();
  });

  it("keeps the move reversible until the project metadata has persisted", async () => {
    const materialized = { commit: vi.fn(), rollback: vi.fn(async () => undefined) };
    const moved = { rollback: vi.fn(async () => undefined) };
    const transaction = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    };

    await expect(
      moveShotsToVisiblePending("/scene", project, ["shot-a"], {
        beginTransaction: async () => transaction,
        finalize: async () => {
          throw new Error("metadata write failed");
        },
        fingerprint: async () => "fingerprint",
        materializeShots: async () => materialized,
        moveFiles: async () => moved,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      })
    ).rejects.toThrow("metadata write failed");

    expect(moved.rollback).toHaveBeenCalledOnce();
    expect(materialized.rollback).toHaveBeenCalledOnce();
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it("restores only files that are currently inside the visible Pending folder", async () => {
    const pendingProject = {
      shots: [],
      parkedShots: [
        {
          id: "shot-a",
          imagePath: "/scene/Pending/shot-a.tiff",
          fileName: "shot-a.tiff"
        },
        { id: "shot-b", imagePath: "/scene/shot-b.tiff", fileName: "shot-b.tiff" }
      ]
    };
    const moveFiles = vi.fn(async () => ({ rollback: vi.fn(async () => undefined) }));

    const result = await restoreShotsFromVisiblePending(
      "/scene",
      pendingProject,
      ["shot-a", "shot-b"],
      {
        fingerprint: async () => "restored-fingerprint",
        moveFiles,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      }
    );

    expect(moveFiles).toHaveBeenCalledWith([
      { fromPath: "/scene/Pending/shot-a.tiff", toPath: "/scene/shot-a.tiff" }
    ]);
    expect(result).toEqual([
      {
        shotId: "shot-a",
        imagePath: "/scene/shot-a.tiff",
        fileName: "shot-a.tiff",
        baseFingerprint: "restored-fingerprint"
      }
    ]);
  });

  it("recognizes only descendants of the project Pending folder", () => {
    expect(visiblePendingFolderPath("/scene")).toBe("/scene/Pending");
    expect(isVisiblePendingPath("/scene", "/scene/Pending/shot.tiff")).toBe(true);
    expect(isVisiblePendingPath("/scene", "/scene/Pending-other/shot.tiff")).toBe(false);
    expect(isVisiblePendingPath("/scene", "/scene/shot.tiff")).toBe(false);
  });
});
