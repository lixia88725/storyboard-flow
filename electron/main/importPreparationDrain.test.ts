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
import { createImportPathReservation } from "./importPaths";
import { prepareImportStaging } from "./importPreparation";
import * as preparation from "./tiffPreparation";
import { pixelFingerprint } from "./imageFingerprintService";
import { createProject } from "../../src/shared/projectOps";

it("Import drains a failed preparation batch before releasing the queue and never reuses its staging", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "import-preparation-drain-"));
  const [green, blue] = await Promise.all(["green", "blue"].map(background =>
    sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer()));
  const a = path.join(root, "a.tiff"), b = path.join(root, "b.tiff");
  await sharp(green).tiff().toFile(a); await sharp(green).tiff().toFile(b);
  const original = await fs.readFile(a);
  const originalB = await fs.readFile(b);
  const shot = (id: string, imagePath: string) => ({ id, imagePath, fileName: path.basename(imagePath),
    order: 0, swb: { status: "compatible-external-edit", version: 1 }, layers: [] });
  const project = { ...createProject("Synthetic"), shots: [shot("s", a), shot("t", b)] };
  let ready!: () => void, release!: () => void;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signalWriterClosed!: () => void;
  const closed = new Promise<void>(resolve => { signalWriterClosed = resolve; });
  const failure = new Error("synthetic second-shot decode failure");
  let firstWriter = true, finished = false, successorStarted = false, writerClosed = false;
  const cleanup = vi.spyOn(preparation, "removeSavePreparationDirectory");
  const assets: string[] = [];
  const bindings = { ...fs, ...renames, ...ports, ...safety, path, sharp, process, randomUUID, createHash,
    withLayerFileOperation, mapWithConcurrency, prepareProtectedLayerReplacement,
    recoverFailedImport, ImportRecoveryIncompleteError, createImportPathReservation, prepareImportStaging, pixelFingerprint,
    sharpSourceOptions: { unlimited: true }, swbFormatVersion: 1,
    archiveStamp: () => "fixed-production-second", uniquePath: async (dir: string, name: string) => path.join(dir, name),
    emptyDefaultSketchLayers: () => true, app: { getAppPath: () => process.cwd() },
    resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    // Decode is the fault seam. Descriptor writes, publication, main helper and
    // exclusive queue are production/native, not an alternative implementation.
    runPhotoshopTiffImporter: async (_python: unknown, _script: unknown, source: string, out: string, manifest: string) => {
      if (source === b) { await opened; throw failure; }
      await fs.mkdir(out, { recursive: true });
      const assetPath = path.join(out, "fixture.png"); assets.push(assetPath);
      if (firstWriter) {
        firstWriter = false;
        const fd = await fs.open(assetPath, "w");
        try { await fd.write(green, 0, green.length, 0); ready(); await gate; await fd.write(blue, 0, blue.length, 0); }
        finally { await fd.close(); writerClosed = true; signalWriterClosed(); }
      } else await fs.writeFile(assetPath, green);
      await fs.writeFile(manifest, JSON.stringify({ width: 2, height: 2, warnings: [], layers: [
        { assetPath, name: "Image", visible: true, opacity: 1, blendMode: "normal", order: 0 }
      ] }));
    }
  };
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const nodes = tree.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations[0].name.getText(tree) === "importProjectToSwbFormat");
  expect(nodes).toHaveLength(1);
  const compiled = ts.transpileModule(nodes[0].getText(tree) + ";return importProjectToSwbFormat;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const entries = Object.entries(bindings).filter(([name]) => name !== "default");
  const run = new Function(...entries.map(([name]) => name), compiled)(...entries.map(([, value]) => value));
  const importing: Promise<unknown> = run(project, root).then(() => undefined, (error: unknown) => error)
    .finally(() => { finished = true; });
  let successor: Promise<void> | undefined;
  try {
    await Promise.race([opened, importing.then(error => { throw new Error(`Import ended before writer start: ${String(error)}`); })]);
    successor = withLayerFileOperation(async () => { successorStarted = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect.soft(finished).toBe(false);
    expect.soft(successorStarted).toBe(false);
    expect.soft(cleanup).not.toHaveBeenCalled();
    expect.soft(writerClosed).toBe(false);
    expect.soft(await fs.readFile(assets[0])).toEqual(green);
    release();
    expect(await importing).toBe(failure);
    expect(writerClosed).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(await fs.lstat(assets[0]).then(() => "present", error => error.code)).toBe("ENOENT");
    await successor;
    expect(await fs.readFile(a)).toEqual(original);
    expect(await fs.readFile(b)).toEqual(originalB);
    const second = await run({ ...project, shots: [project.shots[0]] }, root);
    expect(assets).toHaveLength(2);
    expect(assets[1]).not.toBe(assets[0]);
    expect(await fs.lstat(assets[0]).then(() => "present", error => error.code)).toBe("ENOENT");
    expect(await fs.readFile(path.join(root, ".storyboard-workbench/layers/s/layer-image.png"))).toEqual(green);
    await second.rollback();
  } finally {
    release(); await importing; await successor;
    // Our injected writer must actually finish before deleting its fixture.
    if (assets.length) await closed;
    cleanup.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);
