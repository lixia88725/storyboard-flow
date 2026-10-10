import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyFileMoves, applyFileReplacements, type AppliedFileReplacements, FileReplacementRecoveryIncompleteError } from "./fileRenames.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
const caught = async (action: () => Promise<unknown>) => {
  try { await action(); } catch (error) { return error; }
  throw new Error("Expected rejection");
};
// Exercise the actual protected main.ts catch bodies without launching Electron.
// Inject real file handles at the boundary, not mock replacement/move algorithms.
const mainCatch = async (marker: string, bindings: Record<string, unknown>) => {
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const end = source.indexOf(marker);
  expect(end).toBeGreaterThan(0);
  const start = source.lastIndexOf("} catch (error) {", end);
  const body = source.slice(start + "} catch (error) {".length, end);
  const helper = await import("./importRecovery.js");
  const ipc = await import("../shared/normalSaveImportIpc.js");
  const args = { appliedTiffReplacements: undefined, ...bindings, ...helper,
    normalSaveImportFailure: ipc.normalSaveImportFailure };
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  return new AsyncFunction(...Object.keys(args), body)(...Object.values(args));
};
const fixture = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "import-recovery-"));
  directories.push(dir);
  const file = (name: string) => path.join(dir, name);
  const bytes = {
    original: Buffer.from([1, 0, 255]), working: Buffer.from([2, 0, 254]),
    oldLayer: Buffer.from([3, 0, 253]), newLayer: Buffer.from([4, 0, 252]),
    placeholder: Buffer.from([5, 0, 251])
  };
  const mkdir = async (p: string) => { await fs.mkdir(p, { recursive: true }); };
  const ops = { mkdir, rename: fs.rename };
  await fs.writeFile(file("active.tiff"), bytes.original);
  await fs.writeFile(file("working.tmp"), bytes.working);
  await fs.writeFile(file("layer.png"), bytes.oldLayer);
  await fs.writeFile(file("layer.tmp"), bytes.newLayer);
  const archived = await applyFileMoves([{ fromPath: file("active.tiff"), toPath: file("Archive/original.tiff") }], ops);
  // Import's fresh working TIFF occupies the original active path.
  const target = await applyFileMoves([{ fromPath: file("working.tmp"), toPath: file("active.tiff") }], ops);
  const targetRollback = vi.fn(() => target.rollback());
  const archiveRollback = vi.fn(() => archived.rollback());
  const scriptRollback = vi.fn(async () => {
    expect(await fs.readFile(file("active.tiff"))).toEqual(bytes.original);
    await fs.unlink(file("active.tiff"));
  });
  const replacement = { targetPath: file("layer.png"), tempPath: file("layer.tmp"), backupPath: file("layer.backup") };
  const preserved = async () => {
    expect(await fs.readFile(file("active.tiff"))).toEqual(bytes.working);
    expect(await fs.readFile(file("Archive/original.tiff"))).toEqual(bytes.original);
    expect(await fs.readFile(file("working.tmp"))).toEqual(bytes.placeholder);
    expect(await fs.readFile(file("layer.backup"))).toEqual(bytes.oldLayer);
    expect(await fs.readFile(file("layer.tmp"))).toEqual(bytes.newLayer);
    expect(targetRollback).not.toHaveBeenCalled();
    expect(archiveRollback).not.toHaveBeenCalled();
    expect(scriptRollback).not.toHaveBeenCalled();
  };
  return { file, bytes, mkdir, replacement, preserved, targetRollback, archiveRollback, scriptRollback };
};
it.each([false, true])("actual Import inner/outer catches gate no-handle automatic recovery failure=%s", async (restoreFails) => {
  const f = await fixture();
  const forward = new Error("install failed");
  const restore = new Error("restore failed");
  let handle: AppliedFileReplacements | undefined;
  let calls = 0;
  const error = await caught(async () => {
    handle = await applyFileReplacements([f.replacement], {
      mkdir: f.mkdir, unlink: fs.unlink,
      rename: async (from, to) => {
        if (++calls === 2) throw forward;
        if (restoreFails && calls === 3) throw restore;
        await fs.rename(from, to);
      }
    });
  });
  expect(handle).toBeUndefined();
  if (restoreFails) {
    expect(error).toBeInstanceOf(FileReplacementRecoveryIncompleteError);
    // A retained/reoccupied temporary destination must never be overwritten by
    // dependent target rollback after incomplete replacement recovery.
    await fs.writeFile(f.file("working.tmp"), f.bytes.placeholder);
  }
  const rollbackImportMoves = async () => {
    await handle?.rollback();
    await f.targetRollback();
    await f.archiveRollback();
  };
  const inner = await caught(() => mainCatch("\n  }\n\n  const applyPreparedImports", { error, rollbackImportMoves }));
  const outerMarker = "\n    }\n  });\n\n  registerWorkspaceExternalChanges";
  const outerBindings = { error: inner, swbImport: undefined, scriptImport: { rollback: f.scriptRollback } };
  if (restoreFails) {
    // A recovery-incomplete Import crosses IPC as a RETURNED serializable envelope (never a thrown
    // custom Error whose name/properties the boundary would drop).
    const envelope = await mainCatch(outerMarker, outerBindings) as { ok: boolean; error: { code: string; message: string } };
    expect(envelope).toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
    expect(envelope.error.message).toContain(forward.message);
    expect(envelope.error.message).toContain(restore.message);
    await f.preserved();
  } else {
    const outer = await caught(() => mainCatch(outerMarker, outerBindings));
    expect(inner).toBe(forward);
    expect(outer).toBe(forward);
    expect(f.targetRollback).toHaveBeenCalledOnce();
    expect(f.archiveRollback).toHaveBeenCalledOnce();
    expect(f.scriptRollback).toHaveBeenCalledOnce();
    expect(await fs.readFile(f.file("working.tmp"))).toEqual(f.bytes.working);
    expect(await fs.readFile(f.file("layer.png"))).toEqual(f.bytes.oldLayer);
    expect(await fs.readFile(f.file("layer.tmp"))).toEqual(f.bytes.newLayer);
  }
});

it.each(["inner", "outer"])("actual Import %s catch preserves original and explicit rollback errors", async (boundary) => {
  const { ImportRecoveryIncompleteError } = await import("./importRecovery.js");
  const f = await fixture();
  const original = new Error("later Import operation failed");
  const restore = new Error("layer evacuation failed");
  let calls = 0;
  const handle = await applyFileReplacements([f.replacement], {
    mkdir: f.mkdir, unlink: fs.unlink,
    rename: async (from, to) => {
      if (++calls === 3) throw restore;
      await fs.rename(from, to);
    }
  });
  await fs.writeFile(f.file("working.tmp"), f.bytes.placeholder);
  const rollbackImportMoves = async () => {
    await handle.rollback();
    await f.targetRollback();
    await f.archiveRollback();
  };
  const inner = boundary === "inner"
    ? await caught(() => mainCatch("\n  }\n\n  const applyPreparedImports", { error: original, rollbackImportMoves }))
    : original;
  const envelope = await mainCatch("\n    }\n  });\n\n  registerWorkspaceExternalChanges", {
    error: inner, swbImport: boundary === "outer" ? { rollback: rollbackImportMoves } : undefined,
    scriptImport: { rollback: f.scriptRollback }
  }) as { ok: boolean; error: { code: string; message: string } };
  // The recovery-incomplete fact is a returned serializable envelope carrying both underlying errors.
  expect(envelope).toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
  expect(envelope.error.message).toContain(original.message);
  expect(envelope.error.message).toContain(restore.message);
  expect(await fs.readFile(f.file("active.tiff"))).toEqual(f.bytes.working);
  expect(await fs.readFile(f.file("Archive/original.tiff"))).toEqual(f.bytes.original);
  expect(await fs.readFile(f.file("working.tmp"))).toEqual(f.bytes.placeholder);
  expect(await fs.readFile(f.file("layer.png"))).toEqual(f.bytes.newLayer);
  expect(await fs.readFile(f.file("layer.backup"))).toEqual(f.bytes.oldLayer);
  expect(f.targetRollback).not.toHaveBeenCalled();
  expect(f.archiveRollback).not.toHaveBeenCalled();
  expect(f.scriptRollback).not.toHaveBeenCalled();
});

it("Save caller gates a typed Import failure before restoring dependent file paths", async () => {
  const { recoverFailedImport } = await import("./importRecovery.js");
  const { recoverFailedSave } = await import("./saveRecovery.js");
  const f = await fixture();
  const original = new Error("Import failed");
  const restore = new Error("Import rollback failed");
  const error = await caught(() => recoverFailedImport(original, [{ rollback: async () => { throw restore; } }]));
  const reported = await caught(() => recoverFailedSave(error, {
    appliedRenamePlan: { rollback: f.targetRollback },
    stagedPendingDeletedFiles: { rollback: f.archiveRollback }
  }));
  expect(reported).toMatchObject({ recoveryIncomplete: true, errors: [error] });
  expect((reported as Error).message).toContain(original.message);
  expect((reported as Error).message).toContain(restore.message);
  expect(f.targetRollback).not.toHaveBeenCalled();
  expect(f.archiveRollback).not.toHaveBeenCalled();
  expect(await fs.readFile(f.file("active.tiff"))).toEqual(f.bytes.working);
  expect(await fs.readFile(f.file("Archive/original.tiff"))).toEqual(f.bytes.original);
});
