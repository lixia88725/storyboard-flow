import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, readdir } from "node:fs/promises";
import { readTrustedLegacyOutputIdentity } from "./trustedLegacyOutputIdentity.js";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport.js";
import { createProject } from "../../src/shared/projectOps";
import { runPythonScript } from "./pythonRuntime.js";
import ts from "typescript";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import type { Project } from "../../src/shared/types";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const options = { exportScriptPath: path.resolve("scripts/photoshop-layered-tiff-export.py"), importScriptPath: path.resolve("scripts/photoshop-layered-tiff-import.py"), probeScriptPath: path.resolve("scripts/legacy-single-layer-proof.py") };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "m3b-legacy-")); dirs.push(folder);
  const bitmapPath = ".storyboard-workbench/layers/s/layer-image.png";
  await mkdir(path.dirname(path.join(folder, bitmapPath)), { recursive: true });
  await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 47, g: 103, b: 211, alpha: 1 } } }).png().toFile(path.join(folder, bitmapPath));
  const project: Project = { ...createProject("legacy"), shots: [{ id: "s", imagePath: path.join(folder, "original.tiff"), fileName: "original.tiff", order: 0,
    layers: [{ id: "layer-image", kind: "image", name: "Image", visible: true, locked: true, opacity: 1, blendMode: "normal", order: 0, width: 3, height: 2, bitmapPath }],
    swb: { version: 1, status: "owned", canvasWidth: 3, canvasHeight: 2, baseFingerprint: "unused", sourceKind: "photoshop-layered-tiff" } }] };
  const output = await writePhotoshopLayeredTiffsForInPlaceSave(project, folder, { scriptPath: options.exportScriptPath, saveStamp: "fixture" });
  const { copyFile } = await import("node:fs/promises");
  await copyFile(output.replacements[0].fromPath, project.shots[0].imagePath);
  return { folder, project, bitmapPath };
}
it("real formal exporter single-layer legacy proof accepts original whole identity without changing original TIFF/PNG", async () => {
  const f = await fixture(); const source = await readFile(f.project.shots[0].imagePath), png = await readFile(path.join(f.folder, f.bitmapPath));
  // lcms stamps each generated sRGB profile with wall-clock creation time.
  // Crossing a second boundary must not turn equivalent color transforms unknown.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const modulePath = "./trustedLegacyOutputIdentity.js";
  const module = await import(modulePath).catch(() => undefined);
  const result = await module?.readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options);
  expect(result).toBe(sha(source));
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(source);
  expect(await readFile(path.join(f.folder, f.bitmapPath))).toEqual(png);
  // Actual main handler body -> dormant App adapter -> owner -> epoch/hash recheck.
  // Local no-Electron transport; not a preload/lifecycle certification.
  const sourceText = await readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", sourceText, ts.ScriptTarget.Latest, true);
  let callback = "";
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(tree) === "ipcMain.handle" && n.arguments[0]?.getText(tree) === '\"workspace:readOutputIdentity\"') callback = n.arguments[1].getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  expect(callback).not.toBe("");
  const compiled = ts.transpileModule(`const handler = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const bindings = { path, createHash, readFile, readTrustedLegacyOutputIdentity, app: { getAppPath: () => process.cwd() }, process, resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR };
  const handler = new Function(...Object.keys(bindings), compiled + "return handler;")(...Object.values(bindings));
  const projectRef = { current: createProject("before-open") };
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, freshToken: () => "t", queue: createBitmapLayerWriteQueue(),
    api: () => ({ readOutputIdentity: (imagePath, legacy) => handler({}, imagePath, legacy), autosaveWorkspace: async () => {}, saveWorkspace: async p => p }),
    paths: () => ({ folderPath: f.folder, metadataPath: path.join(f.folder, "p.json") }), onSave: () => {}, onError: () => {} });
  expect(await adapter.load(async () => ({ folderPath: f.folder, folderName: "legacy", metadataPath: path.join(f.folder, "p.json"), images: [], project: f.project }), () => {})).toBe(true);
  expect(projectRef.current.pendingBake?.shots.s).toEqual({ state: "synced", acceptedOutputIdentity: sha(source) });
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(source);
});
it("unclassified legacy sourceKind is not a trusted single-layer candidate", async () => {
  const f = await fixture(); delete f.project.shots[0].swb!.sourceKind;
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
});
it("ICC normalization ignores only the clock stamp, not other profile metadata", async () => {
  const f = await fixture(); const imagePath = f.project.shots[0].imagePath;
  const beforePixels = await sharp(imagePath).ensureAlpha().raw().toBuffer();
  const edit = path.join(f.folder, "mutate-icc.py");
  await writeFile(edit, `import sys,tifffile\np=sys.argv[1]\nwith tifffile.TiffFile(p) as tf:\n o=tf.pages[0].tags[34675].valueoffset\nwith open(p,'r+b') as f:\n f.seek(o+48); b=f.read(1); f.seek(o+48); f.write(bytes([b[0]^1]))\n`);
  await runPythonScript({ scriptPath: edit, scriptArgs: [imagePath], errorPrefix: "ICC fixture edit" });
  expect(await sharp(imagePath).ensureAlpha().raw().toBuffer()).toEqual(beforePixels);
  const original = await readFile(imagePath);
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
  expect(await readFile(imagePath)).toEqual(original);
});
it("unsupported legacy SWB metadata version cannot be certified by otherwise equivalent raster data", async () => {
  const f = await fixture(); f.project.shots[0].swb!.version = 99;
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
});
it("legacy proof conservatively rejects complex, raw unknown/corrupt, missing asset and source conflict inputs without changing originals", async () => {
  const f = await fixture(), original = await readFile(f.project.shots[0].imagePath);
  const changes: Array<(p: Project) => void> = [
    p => { p.shots[0].layers!.push({ ...p.shots[0].layers![0], id: "extra" }); },
    p => { p.shots[0].presentation = { matte: { mode: "embedded", top: 1, bottom: 1 } }; },
    p => { p.shots[0].imageLayerEdits = [{} as any]; },
    p => { p.shots[0].swb!.sourcePath = path.join(f.folder, "external.tiff"); },
    p => { p.shots[0].layers![0].bitmapPath = ".storyboard-workbench/layers/s/missing.png"; },
    p => { p.shots[0].layers![0].name = "different layer metadata"; },
    p => { p.pendingBake = { version: 1, shots: { s: { state: "unknown" } } }; },
    p => { p.pendingBake = { version: 7, shots: {} } as any; },
    p => { p.pendingBake = "corrupt" as any; },
    p => { p.parkedShots = p.shots; p.shots = []; }
  ];
  for (const change of changes) {
    const p = structuredClone(f.project); change(p);
    expect(await readTrustedLegacyOutputIdentity(p, "s", f.folder, options)).toBeUndefined();
    expect(await readFile(f.project.shots[0].imagePath)).toEqual(original);
  }
  await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toFile(path.join(f.folder, f.bitmapPath));
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(original);
});
it("plain TIFF and raw two-layer TIFF remain unknown even when composite/visible-filtered source appears simple", async () => {
  const f = await fixture();
  await sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 47, g: 103, b: 211 } } }).tiff({ compression: "none" }).toFile(f.project.shots[0].imagePath);
  const plain = await readFile(f.project.shots[0].imagePath);
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(plain);
  const two = structuredClone(f.project);
  two.shots[0].layers!.push({ ...two.shots[0].layers![0], id: "hidden", kind: "paint", visible: false, order: 1 });
  const made = await writePhotoshopLayeredTiffsForInPlaceSave(two, f.folder, { scriptPath: options.exportScriptPath, saveStamp: "two-layer" });
  await copyFile(made.replacements[0].fromPath, f.project.shots[0].imagePath);
  const raw = await readFile(f.project.shots[0].imagePath);
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(raw);
});
it("XMP present or non-upright TIFF cannot be silently certified by pixel equivalence", async () => {
  const f = await fixture();
  const made = await writePhotoshopLayeredTiffsForInPlaceSave(f.project, f.folder, { scriptPath: options.exportScriptPath, saveStamp: "xmp", xmpByShotId: { s: "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">unproved</x:xmpmeta>" } });
  await copyFile(made.replacements[0].fromPath, f.project.shots[0].imagePath);
  const raw = await readFile(f.project.shots[0].imagePath);
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(raw);
  await sharp({ create: { width: 3, height: 2, channels: 3, background: "white" } }).withMetadata({ orientation: 6 }).tiff({ compression: "none" }).toFile(f.project.shots[0].imagePath);
  const rotated = await readFile(f.project.shots[0].imagePath);
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, options)).toBeUndefined();
  expect(await readFile(f.project.shots[0].imagePath)).toEqual(rotated);
});
it("whole original bytes changing during real proof awaits remain modified and unaccepted; proof scratch is cleaned", async () => {
  const f = await fixture(), original = await readFile(f.project.shots[0].imagePath);
  const wrapper = path.join(f.folder, "mutation-probe.py");
  await writeFile(wrapper, `import runpy,sys\nfrom pathlib import Path\nrunpy.run_path(${JSON.stringify(options.probeScriptPath)}, run_name='__main__')\np = Path(${JSON.stringify(f.project.shots[0].imagePath)})\np.write_bytes(p.read_bytes() + b'changed-during-proof')\n`);
  const before = (await readdir(os.tmpdir())).filter(n => n.startsWith("normal-legacy-proof-"));
  expect(await readTrustedLegacyOutputIdentity(f.project, "s", f.folder, { ...options, probeScriptPath: wrapper })).toBeUndefined();
  expect((await readFile(f.project.shots[0].imagePath)).subarray(0, original.length)).toEqual(original);
  expect((await readFile(f.project.shots[0].imagePath)).length).toBeGreaterThan(original.length);
  expect((await readdir(os.tmpdir())).filter(n => n.startsWith("normal-legacy-proof-"))).toEqual(before);
});
