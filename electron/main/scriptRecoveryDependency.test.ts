import { expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import ts from "typescript";
import * as safety from "./pathSafety";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { normalSaveImportFailure } from "../shared/normalSaveImportIpc";
import { writeProtectedLayerFile } from "./protectedLayerFileWriter";
import { removeOwnedFile } from "./ownedFileCreation";
import { createProject } from "../../src/shared/projectOps";

it("actual outer Script recovery refuses PNG and TIFF deletion when shared preview recovery fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "script-recovery-dependency-"));
  try {
    const image = path.join(root, "blank.tiff"), bitmapPath = ".storyboard-workbench/layers/new/paint.png";
    await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).tiff().toFile(image);
    const project = createProject("Synthetic");
    const next = { ...project, shots: [{ id: "new", imagePath: image, layers: [{ bitmapPath, kind: "paint", width: 2, height: 2 }] }] };
    const restorePreview = vi.fn(async () => { throw new Error("preview restore EPERM"); });
    const removeBlank = vi.fn(async () => { await fs.unlink(image); });
    let handler!: (event: unknown, payload: unknown) => Promise<any>;
    // Controlled shared-preview failure; actual outer handler, native PNG creation
    // receipt and identity-checked cleanup stay real. No real user files involved.
    const bindings = { ...fs, ...safety, path, sharp, withLayerFileOperation, recoverFailedImport, ImportRecoveryIncompleteError,
      normalSaveImportFailure, removeOwnedFile, hasPendingFileTransaction: async () => false,
      assertNormalSaveAdmission: async () => {}, projectNeedsSwbImport: () => false,
      importStoryboardScriptMarkdown: async () => ({ project: next, rollbackPreviews: restorePreview,
        rollbackCreatedFiles: removeBlank, rollback: async () => { await restorePreview(); await removeBlank(); } }),
      resolveLayerAssetPath: (folder: string, relative: string) => path.join(folder, relative),
      shouldEnsureLayerAssetsForShot: () => true, sketchLayersForShot: () => [],
      writeProtectedLayerFile: async (...args: Parameters<typeof writeProtectedLayerFile>) => {
        await writeProtectedLayerFile(...args); throw new Error("failure after new PNG creation");
      }, ipcMain: { handle: (_name: string, fn: typeof handler) => { handler = fn; } } };
    const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
    const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
    const selected = tree.statements.filter(n => ts.isVariableStatement(n) && ["ensureProjectLayerAssets", "createTransparentLayerPng"].includes(n.declarationList.declarations[0].name.getText(tree)));
    expect(selected).toHaveLength(2);
    const outer = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
    const code = ts.transpileModule(selected.map(n => n.getText(tree)).join("\n") + outer, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const entries = Object.entries(bindings).filter(([key]) => key !== "default");
    new Function(...entries.map(([key]) => key), code)(...entries.map(([, value]) => value));
    const result = await handler({ sender: {} }, { normalSave: true, project, folderPath: root, metadataPath: path.join(root, "project.json") });
    expect(result).toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
    expect(restorePreview).toHaveBeenCalledOnce(); expect(removeBlank).not.toHaveBeenCalled();
    expect((await sharp(path.join(root, bitmapPath)).metadata()).format).toBe("png");
    expect((await sharp(image).metadata()).format).toBe("tiff");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
