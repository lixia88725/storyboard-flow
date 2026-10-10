import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { pathExists } from "./pathSafety.js";
import { pixelFingerprint } from "./imageFingerprintService.js";
import { compatibleExternalEditImportMode, writeSwbImportWorkingTiff } from "./photoshopTiffImport.js";
import { applyFileMoves } from "./fileRenames.js";
import { createImportPathReservation } from "./importPaths.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
const fixture = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "import-paths-"));
  directories.push(dir);
  const image = async (name: string, color: string) => {
    const imagePath = path.join(dir, name);
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await sharp({ create: { width: 3, height: 2, channels: 3, background: color } }).toFile(imagePath);
    return { id: randomUUID(), imagePath };
  };
  return { dir, image };
};

// Execute the real main preparation entry without Electron startup, Python, or GUI.
// Image conversion/fingerprinting and disk existence are real; stop before moves.
const prepare = async (dir: string, shots: Array<{ id: string; imagePath: string; swb?: { status: string } }>, options = {}) => {
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const start = source.indexOf("const importProjectToSwbFormat =");
  const end = source.indexOf("  let archivedOriginals:", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const unique = source.slice(source.indexOf("const uniquePath ="));
  const bindings = {
    createImportPathReservation, path, pathExists, mkdir: fs.mkdir, randomUUID, sharp,
    archiveStamp: () => "batch", compatibleExternalEditImportMode,
    isLikelyTiffPath: () => false, writeSwbImportWorkingTiff, pixelFingerprint,
    sharpSourceOptions: { unlimited: true }
  };
  const code = ts.transpileModule(`${unique}\n${source.slice(start, end)}\nreturn prepared;\n};\nreturn importProjectToSwbFormat(project, folderPath, undefined, options);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  return new AsyncFunction(...Object.keys(bindings), "project", "folderPath", "options", code)(
    ...Object.values(bindings), { shots }, dir, options
  ) as Promise<Array<{ shot: { id: string }; targetPath: string; archivePath?: string; tempPath: string }>>;
};

it("actual Import preparation reserves distinct same-stem targets in shot order", async () => {
  const f = await fixture();
  const shots = [await f.image("panel.jpg", "red"), await f.image("panel.png", "blue")];
  const prepared = await prepare(f.dir, shots);
  expect(prepared.map((item) => item.shot.id)).toEqual(shots.map((shot) => shot.id));
  expect(prepared.map((item) => path.basename(item.targetPath))).toEqual(["panel.tiff", "panel_1.tiff"]);
  expect(await pixelFingerprint(prepared[0].tempPath)).not.toBe(await pixelFingerprint(prepared[1].tempPath));
  const originals = await Promise.all(shots.map((shot) => fs.readFile(shot.imagePath)));
  const working = await Promise.all(prepared.map((item) => fs.readFile(item.tempPath)));
  const ops = { mkdir: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); }, rename: fs.rename };
  const archived = await applyFileMoves(prepared.map((item, i) => ({ fromPath: shots[i].imagePath, toPath: item.archivePath! })), ops);
  const targets = await applyFileMoves(prepared.map((item) => ({ fromPath: item.tempPath, toPath: item.targetPath })), ops);
  expect(await Promise.all(prepared.map((item) => fs.readFile(item.targetPath)))).toEqual(working);
  expect(await Promise.all(prepared.map((item) => fs.readFile(item.archivePath!)))).toEqual(originals);
  await targets.rollback();
  await archived.rollback();
  expect(await Promise.all(shots.map((shot) => fs.readFile(shot.imagePath)))).toEqual(originals);
});

it("avoids existing TIFFs and keeps deterministic suffixes across the batch", async () => {
  const f = await fixture();
  await f.image("panel.tiff", "green");
  await f.image("panel_1.tiff", "white");
  const shots = [await f.image("panel.jpg", "red"), await f.image("panel.png", "blue")];
  const existing = await fs.readFile(path.join(f.dir, "panel.tiff"));
  const prepared = await prepare(f.dir, shots);
  expect(prepared.map((item) => path.basename(item.targetPath))).toEqual(["panel_2.tiff", "panel_3.tiff"]);
  expect(await fs.readFile(path.join(f.dir, "panel.tiff"))).toEqual(existing);
});

it("reserves Archive basenames shared by source directories and avoids existing archives", async () => {
  const f = await fixture();
  const shots = [await f.image("a/panel.jpg", "red"), await f.image("b/panel.jpg", "blue")];
  await f.image("Archive/batch/panel.jpg", "green");
  const existing = await fs.readFile(path.join(f.dir, "Archive/batch/panel.jpg"));
  const prepared = await prepare(f.dir, shots);
  expect(prepared.map((item) => path.basename(item.archivePath!))).toEqual(["panel_1.jpg", "panel_2.jpg"]);
  expect(prepared.map((item) => path.basename(item.targetPath))).toEqual(["panel.tiff", "panel.tiff"]);
  expect(await fs.readFile(path.join(f.dir, "Archive/batch/panel.jpg"))).toEqual(existing);
});

it.each([false, true])("compatible external edit retains its exact path, preserve dirty layers=%s", async (preserveDirtyShotLayers) => {
  const f = await fixture();
  const external = { ...await f.image("panel.tiff", "red"), swb: { status: "compatible-external-edit" } };
  const fresh = await f.image("panel.png", "blue");
  const prepared = await prepare(f.dir, [fresh, external], {
    preserveDirtyShotLayers, dirtyShotIds: preserveDirtyShotLayers ? new Set([external.id]) : new Set()
  });
  expect(prepared[0].targetPath).toBe(path.join(f.dir, "panel_1.tiff"));
  expect(prepared[1].targetPath).toBe(external.imagePath);
  expect(prepared[1].archivePath).toBeUndefined();
  expect(await pathExists(prepared[1].tempPath)).toBe(false);
});

it("dirty external duplicate keeps the Photoshop naming convention and reserves it", async () => {
  const f = await fixture();
  const external = { ...await f.image("panel.tiff", "red"), swb: { status: "compatible-external-edit" } };
  const fresh = await f.image("panel-photoshop.png", "blue");
  const prepared = await prepare(f.dir, [external, fresh], { dirtyShotIds: new Set([external.id]) });
  expect(prepared.map((item) => path.basename(item.targetPath))).toEqual(["panel-photoshop.tiff", "panel-photoshop_1.tiff"]);
  expect(prepared[0].archivePath).toBeUndefined();
  expect(await pathExists(external.imagePath)).toBe(true);
});

it("imports into writable traversable Archive without directory enumeration permission", async () => {
  const f = await fixture();
  const shots = [await f.image("a/Panel.jpg", "red"), await f.image("b/panel.jpg", "blue")];
  const originalBytes = await Promise.all(shots.map((shot) => fs.readFile(shot.imagePath)));
  const archive = path.join(f.dir, "Archive");
  await fs.mkdir(archive);
  const caseInsensitive = await pathExists(path.join(f.dir, "a/panel.jpg"));
  await fs.chmod(archive, 0o300);
  try {
    // Real unprivileged permission fixture: enumeration denied, traversal/write allowed.
    await expect(fs.readdir(archive)).rejects.toMatchObject({ code: "EACCES" });
    expect(await pathExists(path.join(archive, "batch"))).toBe(false);
    const prepared = await prepare(f.dir, shots);
    expect(prepared.map((item) => path.basename(item.archivePath!))).toEqual([
      "Panel.jpg", caseInsensitive ? "panel_1.jpg" : "panel.jpg"
    ]);
    const ops = { mkdir: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); }, rename: fs.rename };
    const archived = await applyFileMoves(prepared.map((item, i) => ({ fromPath: shots[i].imagePath, toPath: item.archivePath! })), ops);
    const working = await Promise.all(prepared.map((item) => fs.readFile(item.tempPath)));
    const targets = await applyFileMoves(prepared.map((item) => ({ fromPath: item.tempPath, toPath: item.targetPath })), ops);
    expect(await Promise.all(prepared.map((item) => fs.readFile(item.archivePath!)))).toEqual(originalBytes);
    expect(await Promise.all(prepared.map((item) => fs.readFile(item.targetPath)))).toEqual(working);
    await targets.rollback();
    await archived.rollback();
    expect(await Promise.all(shots.map((shot) => fs.readFile(shot.imagePath)))).toEqual(originalBytes);
  } finally {
    await fs.chmod(archive, 0o700);
  }
});

it("propagates case probe permission errors instead of assuming case-sensitive", async () => {
  const f = await fixture();
  const shot = await f.image("panel.jpg", "red");
  const canonical = await fs.realpath(shot.imagePath);
  const alternate = path.join(path.dirname(canonical), "Panel.jpg");
  const denied = Object.assign(new Error("case probe denied"), { code: "EACCES" });
  // Bind an exact realpath EACCES at the probe boundary; all other lookups are real.
  const source = await fs.readFile(new URL("./importPaths.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source.replace(/^import .*;\n/gm, "").replace("export const", "const"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const allocator = new Function("realpath", "path", `${code}\nreturn createImportPathReservation;`)(
    async (input: string) => { if (input === alternate) throw denied; return fs.realpath(input); }, path
  );
  const uniquePath = vi.fn();
  await expect(allocator(uniquePath)(f.dir, "panel.tiff", shot.imagePath)).rejects.toBe(denied);
  expect(uniquePath).not.toHaveBeenCalled();
  expect(await fs.readFile(shot.imagePath)).toBeDefined();
});

it("keeps empty Archive symlink reservations under the canonical destination identity", async () => {
  const f = await fixture();
  const destination = path.join(f.dir, "Store", "123");
  await fs.mkdir(destination, { recursive: true });
  await fs.symlink(destination, path.join(f.dir, "Archive"));
  const shots = [await f.image("a/Panel.jpg", "red"), await f.image("b/panel.jpg", "blue")];
  const insensitive = await pathExists(path.join(f.dir, "a/panel.jpg"));
  const prepared = await prepare(f.dir, shots);
  expect(prepared.map((item) => path.basename(item.archivePath!))).toEqual([
    "Panel.jpg", insensitive ? "panel_1.jpg" : "panel.jpg"
  ]);
  expect(await fs.realpath(path.join(f.dir, "Archive"))).toBe(await fs.realpath(destination));
});

it("uses actual filesystem case semantics for target and Archive reservations", async () => {
  const f = await fixture();
  const shots = [await f.image("a/Panel.jpg", "red"), await f.image("b/panel.jpg", "blue"), await f.image("a/panel.png", "green")];
  const caseInsensitive = await pathExists(path.join(f.dir, "a/panel.jpg"));
  const prepared = await prepare(f.dir, shots);
  expect(prepared.map((item) => path.basename(item.targetPath))).toEqual([
    "Panel.tiff", "panel.tiff", caseInsensitive ? "panel_1.tiff" : "panel.tiff"
  ]);
  expect(prepared.map((item) => path.basename(item.archivePath!))).toEqual([
    "Panel.jpg", caseInsensitive ? "panel_1.jpg" : "panel.jpg", "panel.png"
  ]);
});
