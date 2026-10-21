import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyFileReplacements, applyFileRenamePlan, type AppliedFileReplacements, type AppliedFileRenamePlan, FileReplacementRecoveryIncompleteError, FileRenameRecoveryIncompleteError } from "./fileRenames.js";
import { stagePendingDeletedShotFiles } from "./deletedShotFiles.js";
import { recoverFailedSave } from "./saveRecovery.js";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const fixture = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "save-recovery-"));
  directories.push(directory);
  const file = (name: string) => path.join(directory, name);
  const originals = { "a.png": Buffer.from([0, 1, 255]), "b.png": Buffer.from([2, 0, 254]), "c.png": Buffer.from([3, 0, 253]) };
  for (const [name, bytes] of Object.entries(originals)) await fs.writeFile(file(name), bytes);
  const staged = await stagePendingDeletedShotFiles({
    updatedAt: "fixture", pendingDeletedShots: [{ id: "deleted-b", imagePath: file("b.png"), fileName: "b.png" }]
  }, directory);
  const stagedPath = staged.project.pendingDeletedShots[0].imagePath;
  const deleted = { rollback: vi.fn(() => staged.appliedMoves!.rollback()) };
  const plan = [["a", "b"], ["c", "d"]].map(([from, to]) => ({
    shotId: from, fromPath: file(`${from}.png`), temporaryPath: file(`.rename-${from}.png`),
    finalPath: file(`${to}.png`), finalFileName: `${to}.png`
  }));
  const ops = {
    mkdir: async (directoryPath: string) => { await fs.mkdir(directoryPath, { recursive: true }); },
    rename: vi.fn(async (from: string, to: string) => fs.rename(from, to))
  };
  const restored = async () => {
    for (const [name, bytes] of Object.entries(originals)) expect(await fs.readFile(file(name))).toEqual(bytes);
    await expect(fs.stat(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
    for (const item of plan) await expect(fs.stat(item.temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(file("d.png"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(deleted.rollback).toHaveBeenCalledTimes(1);
  };
  return { file, originals, stagedPath, deleted, plan, ops, restored };
};

const caught = async (action: () => Promise<unknown>): Promise<unknown> => {
  try { await action(); } catch (error) { return error; }
  throw new Error("Expected rejection");
};

describe("Save recovery dependencies with real files", () => {
  it.each([false, true])("gates replacement recovery without a handle when automatic restore fails=%s", async (restoreFails) => {
    const f = await fixture();
    const renamed = await applyFileRenamePlan(f.plan, f.ops);
    const renameRollback = vi.fn(() => renamed.rollback());
    const importRollback = vi.fn(async () => undefined);
    const items = ["b", "d"].map((name) => ({
      targetPath: f.file(`${name}.png`), tempPath: f.file(`${name}.temp`), backupPath: f.file(`${name}.backup`)
    }));
    const fresh = Buffer.from([9, 0, 249]);
    for (const item of items) await fs.writeFile(item.tempPath, fresh);
    const forward = new Error("replacement install failure");
    const restore = new Error("replacement restore failure");
    let calls = 0;
    let handle: AppliedFileReplacements | undefined;
    const error = await caught(async () => {
      handle = await applyFileReplacements(items, {
        mkdir: f.ops.mkdir, unlink: fs.unlink,
        rename: async (from, to) => {
          if (++calls === 4) throw forward;
          if (restoreFails && calls === 5) throw restore;
          await fs.rename(from, to);
        }
      });
    });
    expect(handle).toBeUndefined();
    const reported = await caught(() => recoverFailedSave(error, {
      appliedTiffReplacements: handle, swbImport: { rollback: importRollback },
      appliedRenamePlan: { rollback: renameRollback }, stagedPendingDeletedFiles: f.deleted
    }));
    if (restoreFails) {
      expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError);
      expect(reported).toMatchObject({ errors: [error], recoveryIncomplete: true });
      expect((error as AggregateError).errors).toEqual([forward, restore]);
      expect((reported as Error).message).toContain(forward.message);
      expect((reported as Error).message).toContain(restore.message);
      expect(importRollback).not.toHaveBeenCalled();
      expect(renameRollback).not.toHaveBeenCalled();
      expect(f.deleted.rollback).not.toHaveBeenCalled();
      expect(await fs.readFile(items[0].targetPath)).toEqual(fresh);
      expect(await fs.readFile(items[0].backupPath)).toEqual(f.originals["a.png"]);
      expect(await fs.readFile(items[1].backupPath)).toEqual(f.originals["c.png"]);
      expect(await fs.readFile(items[1].tempPath)).toEqual(fresh);
      expect(await fs.readFile(f.stagedPath)).toEqual(f.originals["b.png"]);
    } else {
      expect(reported).toBe(forward);
      expect(importRollback).toHaveBeenCalledOnce();
      expect(renameRollback).toHaveBeenCalledOnce();
      await f.restored();
    }
  });
  it.each(["restore", "commit"] as const)("stops dependent recovery after real replacement %s failure", async (phase) => {
    const f = await fixture();
    const renamed = await applyFileRenamePlan(f.plan, f.ops);
    const renameRollback = vi.fn(() => renamed.rollback());
    const importRollback = vi.fn(async () => undefined);
    const item = { targetPath: f.file("b.png"), tempPath: f.file("b.temp"), backupPath: f.file("b.backup") };
    const fresh = Buffer.from([8, 0, 248]);
    await fs.writeFile(item.tempPath, fresh);
    const restoreError = new Error("explicit TIFF restore failure");
    const cleanupError = new Error("TIFF backup cleanup failure");
    let restoring = false;
    const applied = await applyFileReplacements([item], {
      mkdir: f.ops.mkdir,
      rename: async (from, to) => {
        if (restoring && from === item.backupPath) throw restoreError;
        await fs.rename(from, to);
      },
      unlink: async () => { throw cleanupError; }
    });
    const saveError = phase === "commit"
      ? await caught(() => applied.commit()) : new Error("Save metadata failure");
    restoring = true;
    const reported = await caught(() => recoverFailedSave(saveError, {
      appliedTiffReplacements: applied, swbImport: { rollback: importRollback },
      appliedRenamePlan: { rollback: renameRollback }, stagedPendingDeletedFiles: f.deleted
    }));
    expect(reported).toMatchObject({ recoveryIncomplete: true });
    expect((reported as AggregateError).errors[0]).toBe(saveError);
    expect((reported as Error).message).toContain((saveError as Error).message);
    expect((reported as Error).message).toContain(phase === "commit" ? "rollback is no longer safe" : restoreError.message);
    expect(importRollback).not.toHaveBeenCalled();
    expect(renameRollback).not.toHaveBeenCalled();
    expect(f.deleted.rollback).not.toHaveBeenCalled();
    expect(await fs.readFile(item.backupPath)).toEqual(f.originals["a.png"]);
    expect(await fs.readFile(phase === "commit" ? item.targetPath : item.tempPath)).toEqual(fresh);
    expect(await fs.readFile(f.stagedPath)).toEqual(f.originals["b.png"]);
    expect(await fs.readFile(f.file("d.png"))).toEqual(f.originals["c.png"]);
  });

  it("restores staging when rename has not run, without interpreting error text as a marker", async () => {
    const f = await fixture();
    const failure = new Error("rollback failed; recovery incomplete (preflight text only)");
    expect(await caught(() => recoverFailedSave(failure, { stagedPendingDeletedFiles: f.deleted }))).toBe(failure);
    await f.restored();
  });

  it.each(["appliedTiffReplacements", "swbImport"] as const)("stops before rename and deletion when %s recovery rejects", async (step) => {
    const f = await fixture();
    const handle = await applyFileRenamePlan(f.plan, f.ops);
    const renameRollback = vi.fn(() => handle.rollback());
    const original = new Error("Save failed");
    const rollback = new Error("prerequisite rollback failed");
    const reported = await caught(() => recoverFailedSave(original, {
      [step]: { rollback: async () => { throw rollback; } },
      appliedRenamePlan: { rollback: renameRollback }, stagedPendingDeletedFiles: f.deleted
    }));
    expect(reported).toMatchObject({ errors: [original, rollback], recoveryIncomplete: true });
    expect(renameRollback).not.toHaveBeenCalled();
    expect(f.deleted.rollback).not.toHaveBeenCalled();
    expect(await fs.readFile(f.file("b.png"))).toEqual(f.originals["a.png"]);
    expect(await fs.readFile(f.file("d.png"))).toEqual(f.originals["c.png"]);
    expect(await fs.readFile(f.stagedPath)).toEqual(f.originals["b.png"]);
  });

  it("restores deleted files after a forward failure with successful automatic rollback", async () => {
    const f = await fixture();
    const failure = new Error("forward failure");
    f.ops.rename.mockImplementation(async (from, to) => {
      if (to === f.file("d.png")) throw failure;
      await fs.rename(from, to);
    });
    let handle: AppliedFileRenamePlan | undefined;
    const error = await caught(async () => { handle = await applyFileRenamePlan(f.plan, f.ops); });
    expect(handle).toBeUndefined();
    expect(error).toBe(failure);
    expect(await caught(() => recoverFailedSave(error, { appliedRenamePlan: handle, stagedPendingDeletedFiles: f.deleted }))).toBe(failure);
    await f.restored();
  });

  it("preserves active bytes occupying the deleted path when automatic rollback fails without a handle", async () => {
    const f = await fixture();
    const forward = new Error("forward failure");
    const rollback = new Error("automatic rollback failure");
    f.ops.rename.mockImplementation(async (from, to) => {
      if (to === f.file("d.png")) throw forward;
      if (from === f.file("b.png")) throw rollback;
      await fs.rename(from, to);
    });
    let handle: AppliedFileRenamePlan | undefined;
    const error = await caught(async () => { handle = await applyFileRenamePlan(f.plan, f.ops); });
    expect(handle).toBeUndefined();
    expect(error).toBeInstanceOf(FileRenameRecoveryIncompleteError);
    const reported = await caught(() => recoverFailedSave(error, { appliedRenamePlan: handle, stagedPendingDeletedFiles: f.deleted }));
    expect(f.deleted.rollback).not.toHaveBeenCalled();
    expect(await fs.readFile(f.file("b.png"))).toEqual(f.originals["a.png"]);
    expect(await fs.readFile(f.stagedPath)).toEqual(f.originals["b.png"]);
    expect(await fs.readFile(f.plan[1].temporaryPath)).toEqual(f.originals["c.png"]);
    expect(reported).toMatchObject({ errors: [error], recoveryIncomplete: true, message: expect.stringMatching(/recovery incomplete.*staged.*retained/i) });
    expect((error as AggregateError).errors).toEqual([forward, rollback]);
    expect((reported as Error).message).toContain(forward.message);
    expect((reported as Error).message).toContain(rollback.message);
  });

  it("retains the Save error and explicit rollback error and stops dependent restoration", async () => {
    const f = await fixture();
    const handle = await applyFileRenamePlan(f.plan, f.ops);
    const saveError = new Error("Save metadata failed");
    const rollbackError = new Error("explicit rollback failed");
    f.ops.rename.mockImplementation(async (from, to) => {
      if (from === f.file("b.png")) throw rollbackError;
      await fs.rename(from, to);
    });
    const reported = await caught(() => recoverFailedSave(saveError, { appliedRenamePlan: handle, stagedPendingDeletedFiles: f.deleted }));
    expect(reported).toMatchObject({ errors: [saveError, rollbackError], recoveryIncomplete: true,
      message: expect.stringMatching(/Save metadata failed.*explicit rollback failed.*recovery incomplete.*staged.*retained/i) });
    expect(f.deleted.rollback).not.toHaveBeenCalled();
    expect(await fs.readFile(f.file("b.png"))).toEqual(f.originals["a.png"]);
    expect(await fs.readFile(f.stagedPath)).toEqual(f.originals["b.png"]);
    expect(await fs.readFile(f.plan[1].temporaryPath)).toEqual(f.originals["c.png"]);
  });

  it("normally restores rename paths before deleted files after a later Save failure", async () => {
    const f = await fixture();
    const handle = await applyFileRenamePlan(f.plan, f.ops);
    const failure = new Error("later Save failure");
    expect(await caught(() => recoverFailedSave(failure, { appliedRenamePlan: handle, stagedPendingDeletedFiles: f.deleted }))).toBe(failure);
    await f.restored();
  });
});
