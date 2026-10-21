import { it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { createImportPathReservation } from "./importPaths";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery";
import { ProtectedLayerWriteError } from "./protectedLayerFileWriter";
import { workspaceEffectFailure } from "./workspaceEffectFailure";
import { normalSaveImportFailure } from "./normalSaveImportFailure";
import { decodeNormalSaveImportResult } from "../shared/normalSaveImportIpc";
import * as preparation from "./tiffPreparation";
import { prepareImportStaging } from "./importPreparation";

afterEach(() => vi.restoreAllMocks());
const failure = new Error("controlled encoder/fingerprint failure");

async function fixture() {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "f4-files-"));
  const sourcePath = path.join(root, "source.png");
  const oldPng = path.join(root, "old.png");
  await fs.writeFile(sourcePath, "original source bytes");
  await fs.writeFile(oldPng, "old layer bytes");
  let staging = "";
  const bindings: Record<string, unknown> = { ...fs, path, process, randomUUID,
    withLayerFileOperation, mapWithConcurrency, createImportPathReservation, prepareImportStaging,
    recoverFailedImport, ImportRecoveryIncompleteError,
    archiveStamp: () => "fixed-second", uniquePath: async (dir: string, name: string) => path.join(dir, name),
    compatibleExternalEditImportMode: () => "replace", pathExists: async () => false,
    isLikelyTiffPath: () => false,
    writeSwbImportWorkingTiff: async ({ outputPath }: { outputPath: string }) => {
      staging = outputPath; await fs.writeFile(outputPath, "real partial staging bytes"); throw failure;
    },
    pixelFingerprint: async () => { throw failure; }
  };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations[0].name.getText(tree) === "importProjectToSwbFormat")!;
  const code = ts.transpileModule(node.getText(tree) + ";return importProjectToSwbFormat;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const run = () => {
    const entries = Object.entries(bindings).filter(([name]) => name !== "default");
    return new Function(...entries.map(([name]) => name), code)(...entries.map(([, value]) => value))(
    { shots: [{ id: "s", imagePath: sourcePath, fileName: "source.png", swb: { status: "non-swb" } }] }, root);
  };
  const invoke = async () => { try { await run(); throw new Error("unexpected success"); } catch (error) { return error; } };
  const stagingRoot = async () => {
    const parent = path.join(root, ".storyboard-workbench/import-tmp");
    const entries = await fs.readdir(parent); expect(entries).toHaveLength(1); return path.join(parent, entries[0]);
  };
  const unchanged = async () => {
    expect(await fs.readFile(sourcePath, "utf8")).toBe("original source bytes");
    expect(await fs.readFile(oldPng, "utf8")).toBe("old layer bytes");
  };
  return { root, bindings, invoke, staging: () => staging, stagingRoot, unchanged,
    dispose: () => fs.rm(root, { recursive: true, force: true }) };
}

it.each(["encoding", "fingerprint"])("Import %s failure cleans authenticated staging and retains the primary error", async phase => {
  const f = await fixture();
  if (phase === "fingerprint") f.bindings.writeSwbImportWorkingTiff = async ({ outputPath }: { outputPath: string }) => {
    await fs.writeFile(outputPath, "encoded bytes");
  };
  try {
    expect(await f.invoke()).toBe(failure);
    expect(await fs.readdir(path.join(f.root, ".storyboard-workbench/import-tmp"))).toEqual([]);
    await f.unchanged();
  } finally { await f.dispose(); }
});

it("Import unknown production effect retains staging and reports both actual paths in the plain classifier", async () => {
  const f = await fixture(); let unknown!: ProtectedLayerWriteError;
  f.bindings.writeSwbImportWorkingTiff = async ({ outputPath }: { outputPath: string }) => {
    await fs.writeFile(outputPath, "unknown bytes");
    unknown = new ProtectedLayerWriteError("unknown", outputPath, "unknown encoding effect", path.join(f.root, "uncertain-temp.png"));
    throw unknown;
  };
  try {
    const error = await f.invoke();
    expect(error).toBeInstanceOf(ImportRecoveryIncompleteError);
    const plain = workspaceEffectFailure(error, "save");
    expect(plain.error.recoveryIncomplete).toBe(true);
    expect(plain.error.retainedPaths).toEqual(expect.arrayContaining([unknown.filePath, unknown.retainedTemporary, await f.stagingRoot()]));
    const importPlain = structuredClone(normalSaveImportFailure(error));
    if (importPlain.ok) throw new Error("unexpected Import success");
    expect(importPlain.error.retainedPaths).toEqual(plain.error.retainedPaths);
    try { decodeNormalSaveImportResult(importPlain); throw new Error("unexpected success"); }
    catch (decoded) { expect(decoded).toMatchObject({ code: "IMPORT_RECOVERY_INCOMPLETE", recoveryIncomplete: true,
      retainedPaths: plain.error.retainedPaths }); }
    expect(await fs.readFile(unknown.filePath, "utf8")).toBe("unknown bytes");
    await f.unchanged();
  } finally { await f.dispose(); }
});

it("Import cleanup rejection preserves staging and reports the real namespace", async () => {
  const f = await fixture();
  vi.spyOn(preparation, "removeSavePreparationDirectory").mockRejectedValue(new Error("controlled cleanup denied"));
  try {
    const error = await f.invoke();
    expect(error).toBeInstanceOf(ImportRecoveryIncompleteError);
    expect(workspaceEffectFailure(error, "save").error.retainedPaths).toContain(await f.stagingRoot());
    expect(await fs.readFile(f.staging(), "utf8")).toBe("real partial staging bytes");
    await f.unchanged();
  } finally { await f.dispose(); }
});

it("Import changed directory identity retains the replacement directory and displaced bytes", async () => {
  const f = await fixture(); let displaced = "";
  f.bindings.writeSwbImportWorkingTiff = async ({ outputPath }: { outputPath: string }) => {
    await fs.writeFile(outputPath, "owned bytes");
    const directory = path.dirname(outputPath); displaced = directory + "-displaced";
    await fs.rename(directory, displaced); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "unowned.png"), "unrelated user asset"); throw failure;
  };
  try {
    const error = await f.invoke(); expect(error).toBeInstanceOf(ImportRecoveryIncompleteError);
    expect(workspaceEffectFailure(error, "save").error.retainedPaths).toContain(displaced.replace(/-displaced$/, ""));
    expect(await fs.readFile(path.join(displaced, "s.tiff"), "utf8")).toBe("owned bytes");
    expect(await fs.readFile(path.join(displaced.replace(/-displaced$/, ""), "unowned.png"), "utf8")).toBe("unrelated user asset");
    await f.unchanged();
  } finally { await f.dispose(); }
});

it("Import created directory with unreadable identity retains it as typed incomplete", async () => {
  const f = await fixture();
  vi.spyOn(preparation, "createSavePreparationDirectory").mockImplementation(async directoryPath => {
    await fs.mkdir(path.dirname(directoryPath), { recursive: true }); await fs.mkdir(directoryPath);
    // Same production typed result as lstat rejecting after exclusive mkdir.
    throw new preparation.TiffPreparationRecoveryIncompleteError([new Error("identity read denied")], [directoryPath]);
  });
  try {
    const error = await f.invoke(); expect(error).toBeInstanceOf(ImportRecoveryIncompleteError);
    expect(workspaceEffectFailure(error, "save").error.retainedPaths).toContain(await f.stagingRoot());
    await f.unchanged();
  } finally { await f.dispose(); }
});
