import { it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { applyFileMoves, FileReplacementRecoveryIncompleteError } from "./fileRenames";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { recoverFailedSave, SaveRecoveryIncompleteError } from "./saveRecovery";
import { ProtectedLayerWriteError } from "./protectedLayerFileWriter";

it.each(["unknown", "committed"] as const)("%s native write failures cannot enter dependent recovery as if no file effect occurred", async (effect) => {
  const error = new ProtectedLayerWriteError(effect, "/synthetic/target.png", "synthetic uncertain write", "/synthetic/retained-staging");
  const dependent = { rollback: vi.fn(async () => {}) };
  await expect(recoverFailedImport(error, [dependent])).rejects.toBeInstanceOf(ImportRecoveryIncompleteError);
  await expect(recoverFailedSave(error, { appliedRenamePlan: dependent })).rejects.toBeInstanceOf(SaveRecoveryIncompleteError);
  expect(dependent.rollback).not.toHaveBeenCalled();
});

it("a move apply that cannot compensate retains originals and blocks dependent Import and Save restores", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "move-no-handle-recovery-"));
  const a = path.join(root, "a"), b = path.join(root, "b"), x = path.join(root, "x"), y = path.join(root, "y");
  const originalError = new Error("synthetic second move failure");
  const recoveryError = new Error("synthetic archive restore EPERM");
  await fs.writeFile(a, "original-a"); await fs.writeFile(b, "original-b");
  try {
    const error = await applyFileMoves([{ fromPath: a, toPath: x }, { fromPath: b, toPath: y }], {
      mkdir: async directory => { await fs.mkdir(directory, { recursive: true }); },
      rename: async (from, to) => {
        if (from === b) throw originalError;
        if (from === x) throw recoveryError;
        await fs.rename(from, to);
      }
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError);
    expect((error as AggregateError).errors).toEqual([originalError, recoveryError]);
    const dependent = { rollback: vi.fn(async () => {}) };
    await expect(recoverFailedImport(error, [dependent])).rejects.toBeInstanceOf(ImportRecoveryIncompleteError);
    await expect(recoverFailedSave(error, { appliedRenamePlan: dependent })).rejects.toBeInstanceOf(SaveRecoveryIncompleteError);
    expect(dependent.rollback).not.toHaveBeenCalled();
    expect(await fs.readFile(x, "utf8")).toBe("original-a");
    expect(await fs.readFile(b, "utf8")).toBe("original-b");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("move rollback stops at the failed prerequisite and leaves later dependencies untouched", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "move-recovery-order-"));
  const a = path.join(root, "a"), b = path.join(root, "b"), x = path.join(root, "x"), y = path.join(root, "y");
  await fs.writeFile(a, "original-a"); await fs.writeFile(b, "original-b");
  let refuse = false;
  const rename = vi.fn(async (from: string, to: string) => {
    if (refuse && from === y) throw new Error("synthetic prerequisite restore failure");
    await fs.rename(from, to);
  });
  try {
    const applied = await applyFileMoves([{ fromPath: a, toPath: x }, { fromPath: b, toPath: y }], {
      mkdir: async directory => { await fs.mkdir(directory, { recursive: true }); }, rename
    });
    refuse = true; rename.mockClear();
    await expect(applied.rollback()).rejects.toBeInstanceOf(FileReplacementRecoveryIncompleteError);
    expect(rename.mock.calls).toEqual([[y, b]]);
    expect(await fs.readFile(x, "utf8")).toBe("original-a");
    expect(await fs.readFile(y, "utf8")).toBe("original-b");
    refuse = false; await applied.rollback();
    expect(await fs.readFile(a, "utf8")).toBe("original-a");
    expect(await fs.readFile(b, "utf8")).toBe("original-b");
    // A successful recovery consumes the ledger, so a retry is harmless.
    rename.mockClear(); await applied.rollback(); expect(rename).not.toHaveBeenCalled();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
