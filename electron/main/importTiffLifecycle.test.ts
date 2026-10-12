import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { applyFileReplacements } from "./fileRenames.js";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { normalSaveImportFailure } from "../shared/normalSaveImportIpc.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
it.each(["preview", "persist", "success", "restore"])("actual Import TIFF handle lifecycle: %s", async (phase) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "import-tiff-lifecycle-"));
  directories.push(root);
  const targetPath = path.join(root, "shot.tiff");
  const tempPath = path.join(root, "prepared.tiff");
  const backupPath = path.join(root, "backup.tiff");
  await fs.writeFile(targetPath, "old");
  await fs.writeFile(tempPath, "new");
  const order: string[] = [];
  const failure = new Error(`${phase} failed`);
  let calls = 0;
  const handle = await applyFileReplacements([{ targetPath, tempPath, backupPath }], {
    mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }); }, unlink: fs.unlink,
    rename: async (from, to) => {
      if (++calls === 3 && phase === "restore") throw new Error("restore blocked");
      await fs.rename(from, to);
    }
  });
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  const compiled = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let handler: (event: unknown, payload: unknown) => Promise<unknown> = async () => { throw new Error("missing handler"); };
  const project = { shots: [] };
  const bindings = {
    ipcMain: { handle: (_name: string, callback: typeof handler) => { handler = callback; } },
    projectNeedsSwbImport: () => true,
    importStoryboardScriptMarkdown: async () => ({ project, rollback: async () => { order.push("script"); } }),
    importProjectToSwbFormat: async () => ({ project, tiffWriteShotIds: [], importedShotIds: [], rollback: async () => {
      order.push("import"); expect(await fs.readFile(targetPath, "utf8")).toBe("old");
    } }),
    createWorkspaceTaskProgressReporter: () => undefined,
    writeSwbMetadataToTiffs: async () => ({
      rollback: async () => { order.push("tiff"); await handle.rollback(); },
      commit: async () => { order.push("commit"); await handle.commit(); }
    }),
    createProjectPreviewsForShots: async () => { if (phase === "preview" || phase === "restore") throw failure; return project; },
    writeProjectFiles: async () => { order.push("persist"); if (phase === "persist") throw failure; },
    recoverFailedImport, path, ImportRecoveryIncompleteError, normalSaveImportFailure, withLayerFileOperation
  };
  new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  const action = handler({ sender: {} }, { project, folderPath: root, metadataPath: path.join(root, "project.json") });
  if (phase === "success") {
    await action;
    expect(order).toEqual(["persist", "commit"]);
    expect(await fs.readFile(targetPath, "utf8")).toBe("new");
    await expect(fs.stat(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  } else if (phase === "persist") {
    // A requested metadata publisher can have installed JSON before failing MD.
    // Without a no-effect receipt, preserve matching assets and backup, not a
    // guessed rollback that can leave the installed JSON pointing at no TIFF.
    await expect(action).resolves.toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
    expect(order).toEqual(["persist"]);
    expect(await fs.readFile(targetPath, "utf8")).toBe("new");
    expect(await fs.readFile(backupPath, "utf8")).toBe("old");
  } else if (phase === "restore") {
    // The recovery-incomplete fact is RETURNED as a serializable envelope, not thrown.
    await expect(action).resolves.toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
    expect(order).toEqual(["tiff"]);
    expect(await fs.readFile(backupPath, "utf8")).toBe("old");
  } else {
    await expect(action).rejects.toBe(failure);
    expect(order).toEqual(["tiff", "import", "script"]);
    expect(await fs.readFile(targetPath, "utf8")).toBe("old");
  }
});
