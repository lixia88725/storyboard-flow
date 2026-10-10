import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport.js";
import { runPhotoshopTiffImporter, type ImportedPhotoshopTiffManifest } from "./photoshopTiffImport.js";
import { runPythonScript } from "./pythonRuntime.js";

// Structural subset shared with main's local Project; no main -> renderer runtime dependency.
type Layer = { id: string; kind: "image" | "paint"; name: string; visible: boolean; locked: boolean; opacity: number;
  blendMode: "normal" | "multiply" | "screen"; order: number; width: number; height: number; bitmapPath: string; cleared?: boolean };
type LegacyShot = { id: string; imagePath: string; fileName: string; order: number; layers?: Layer[];
  swb?: { version: number; status: string; canvasWidth: number; canvasHeight: number; sourcePath?: string; sourceKind?: string };
  presentation?: unknown; sketchLayers?: unknown[]; imageLayerEdits?: unknown[]; baseVisible?: boolean };
type LegacyProject = { name: string; shots: LegacyShot[]; parkedShots?: LegacyShot[]; pendingBake?: unknown };
export type LegacyProofOptions = { exportScriptPath: string; importScriptPath: string; probeScriptPath: string; env?: NodeJS.ProcessEnv };
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const inside = (folder: string, file: string) => { const r = path.relative(folder, file); return r !== "" && !r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r); };
const decoded = (file: string) => sharp(file, { unlimited: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const equalRaster = async (a: string, b: string) => {
  const left = await decoded(a), right = await decoded(b);
  return left.info.width === right.info.width && left.info.height === right.info.height && left.info.channels === right.info.channels && left.data.equals(right.data);
};

/** Returns evidence only for the finite subset actually proved. Never installs an
 * output, mutates source assets, initializes a whole project, or calls ensure.
 * Complex / absent Photoshop metadata and any ambiguity remain unknown.
 * This is not an arbitrary legacy TIFF/PSD compatibility guarantee. */
export const readTrustedLegacyOutputIdentity = async (
  project: LegacyProject, shotId: string, folderPath: string, options: LegacyProofOptions
): Promise<string | undefined> => {
  const shot = project.shots.find(s => s.id === shotId);
  if (project.pendingBake !== undefined || !shot || project.shots.filter(s => s.id === shotId).length !== 1 ||
      project.parkedShots?.some(s => s.id === shotId) || !path.isAbsolute(folderPath) || !path.isAbsolute(shot.imagePath) ||
      !inside(folderPath, shot.imagePath) || !/\.tiff?$/iu.test(shot.imagePath) || path.basename(shot.imagePath) !== shot.fileName ||
      shot.swb?.status !== "owned" || shot.swb.version !== 1 || shot.swb.sourceKind !== "photoshop-layered-tiff" || shot.swb.sourcePath && shot.swb.sourcePath !== shot.imagePath ||
      shot.presentation !== undefined || shot.sketchLayers?.length || shot.imageLayerEdits?.length || shot.baseVisible === false ||
      shot.layers?.length !== 1) return undefined;
  const layer = shot.layers[0];
  const normalized = path.normalize(layer.bitmapPath);
  const prefix = path.join(".storyboard-workbench", "layers");
  if (path.isAbsolute(normalized) || !normalized.startsWith(`${prefix}${path.sep}`) || normalized.split(path.sep).includes("..") ||
      layer.kind !== "image" || layer.visible !== true || layer.opacity !== 1 || layer.blendMode !== "normal" || layer.cleared ||
      layer.width !== shot.swb.canvasWidth || layer.height !== shot.swb.canvasHeight ||
      !Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height) || layer.width < 1 || layer.height < 1) return undefined;
  let scratch: string | undefined;
  try {
    const sourceBytes = await readFile(shot.imagePath);
    const assetPath = path.join(folderPath, normalized), assetBytes = await readFile(assetPath);
    const h0 = hash(sourceBytes), pngHash = hash(assetBytes);
    scratch = await mkdtemp(path.join(os.tmpdir(), "normal-legacy-proof-"));
    const source = path.join(scratch, "source.tiff"), scratchAsset = path.join(scratch, normalized);
    await mkdir(path.dirname(scratchAsset), { recursive: true });
    await writeFile(source, sourceBytes); await writeFile(scratchAsset, assetBytes);
    // Existing exporter generates only scratch output. Never replacement/rename.
    const generated = await writePhotoshopLayeredTiffsForInPlaceSave({ name: project.name, shots: [shot] }, scratch, {
      scriptPath: options.exportScriptPath, saveStamp: "equivalence", env: options.env
    });
    const output = generated.replacements[0].fromPath;
    const manifests: ImportedPhotoshopTiffManifest[] = [], probes: string[] = [];
    for (const [i, file] of [source, output].entries()) {
      const probe = path.join(scratch, `probe-${i}.json`), manifest = path.join(scratch, `manifest-${i}.json`);
      await runPythonScript({ scriptPath: options.probeScriptPath, scriptArgs: [options.importScriptPath, file, probe], env: options.env, errorPrefix: "Legacy TIFF proof failed" });
      await runPhotoshopTiffImporter(undefined, options.importScriptPath, file, path.join(scratch, `layers-${i}`), manifest, options.env);
      probes.push(await readFile(probe, "utf8"));
      manifests.push(JSON.parse(await readFile(manifest, "utf8")) as ImportedPhotoshopTiffManifest);
    }
    if (probes[0] !== probes[1] || manifests.some(m => m.warnings.length !== 0 || m.layers.length !== 1) ||
        manifests[0].width !== manifests[1].width || manifests[0].height !== manifests[1].height) return undefined;
    const a = manifests[0].layers[0], b = manifests[1].layers[0];
    if (["name", "visible", "locked", "opacity", "blendMode", "order"].some(key => a[key as keyof typeof a] !== b[key as keyof typeof b]) ||
        !await equalRaster(a.assetPath, b.assetPath) || !await equalRaster(source, output)) return undefined;
    // Copy-based proof cannot certify bytes which changed during its awaits.
    if (hash(await readFile(shot.imagePath)) !== h0 || hash(await readFile(assetPath)) !== pngHash) return undefined;
    return h0;
  } catch { return undefined; }
  finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
};
