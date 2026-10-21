import { it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import * as renames from "./fileRenames";
import * as ports from "./photoshopTiffImport";
import * as safety from "./pathSafety";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { normalSaveImportFailure } from "./normalSaveImportFailure";
import { createImportPathReservation } from "./importPaths";
import { prepareImportStaging } from "./importPreparation";
import { pixelFingerprint } from "./imageFingerprintService";
import { createProject } from "../../src/shared/projectOps";

it.each(["working", "metadata"] as const)("actual Import retains dependent assets and reports incomplete after %s failure", async (failureMode) => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "import-recovery-dependency-"));
  const original = path.join(root, "source.png");
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  await fs.writeFile(original, bytes);
  const project = { ...createProject("Synthetic"), shots: [{ id: "s", imagePath: original,
    fileName: "source.png", order: 0, layers: [] }] };
  let archive = "", working = "";
  let handler!: (event: unknown, payload: unknown) => Promise<any>;
  const scriptRollback = vi.fn(async () => {});
  const bindings = { ...fs, ...renames, ...ports, ...safety, path, sharp, process, randomUUID, createHash,
    withLayerFileOperation, mapWithConcurrency, prepareProtectedLayerReplacement, recoverFailedImport,
    ImportRecoveryIncompleteError, normalSaveImportFailure, createImportPathReservation, prepareImportStaging, pixelFingerprint,
    sharpSourceOptions: { unlimited: true }, swbFormatVersion: 1, archiveStamp: randomUUID,
    uniquePath: async (dir: string, name: string) => path.join(dir, name), emptyDefaultSketchLayers: () => true,
    projectNeedsSwbImport: () => true, assertNormalSaveAdmission: async () => {},
    hasPendingFileTransaction: async () => false,
    importStoryboardScriptMarkdown: async () => ({ project, rollback: scriptRollback }),
    createWorkspaceTaskProgressReporter: () => undefined, writeSwbMetadataToTiffs: async () => undefined,
    createProjectPreviewsForShots: async (p: unknown) => {
      if (failureMode === "working") throw new Error("synthetic preview failure");
      return p;
    },
    writeProjectFiles: async (metadata: string, _folder: string, p: unknown) => {
      await fs.writeFile(metadata, JSON.stringify(p));
      throw new Error("synthetic MD failure after JSON publication");
    },
    rename: async (from: string, to: string) => {
      if (failureMode === "working" && from === working && to.includes("/import-tmp/")) {
        throw Object.assign(new Error("synthetic working TIFF restore EPERM"), { code: "EPERM" });
      }
      await fs.rename(from, to);
      if (from === original && to.includes("/Archive/")) archive = to;
      if (from.includes("/import-tmp/") && to.endsWith(".tiff")) working = to;
    },
    ipcMain: { handle: (_name: string, fn: typeof handler) => { handler = fn; } }
  };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations[0].name.getText(tree) === "importProjectToSwbFormat")!;
  const outer = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'),
    source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  const compiled = ts.transpileModule(node.getText(tree) + "\n" + outer,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const entries = Object.entries(bindings).filter(([name]) => name !== "default");
  new Function(...entries.map(([name]) => name), compiled)(...entries.map(([, value]) => value));
  try {
    const result = await handler({ sender: {} }, { normalSave: failureMode === "working", project, folderPath: root,
      metadataPath: path.join(root, "project.json") });
    expect(result).toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
    if (failureMode === "working") {
      expect(result.error.message).toContain("synthetic preview failure");
      expect(result.error.message).toContain("synthetic working TIFF restore EPERM");
    } else {
      expect(result.error.message).toContain("synthetic MD failure after JSON publication");
      const written = JSON.parse(await fs.readFile(path.join(root, "project.json"), "utf8"));
      expect(await safety.pathEntryExists(written.shots[0].imagePath)).toBe(true);
    }
    expect.soft(await safety.pathEntryExists(original)).toBe(false);
    expect.soft(await safety.pathEntryExists(archive)).toBe(true);
    expect(await fs.readFile(archive)).toEqual(bytes);
    expect(await safety.pathEntryExists(working)).toBe(true);
    expect(scriptRollback).not.toHaveBeenCalled();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 15000);
