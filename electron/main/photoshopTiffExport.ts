import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { bitmapLayersForShot, type ElectronBitmapLayer } from "./bitmapLayerOrdering.js";
import { runPythonScript } from "./pythonRuntime.js";

type Project = {
  name: string;
  shots: Array<{
    id: string;
    imagePath: string;
    fileName: string;
    order: number;
    layers?: ElectronBitmapLayer[];
    swb?: {
      canvasWidth: number;
      canvasHeight: number;
    };
  }>;
};

export type PhotoshopTiffExportLayer = {
  name: string;
  path: string;
  opacity: number;
  blendMode: "normal" | "multiply" | "screen";
  visible: boolean;
  background: boolean;
};

export type PhotoshopTiffExportManifest = {
  outputPath: string;
  width: number;
  height: number;
  documentName: string;
  xmp?: string;
  swbMetadata?: unknown;
  layers: PhotoshopTiffExportLayer[];
};

export type PhotoshopTiffExportJob = {
  shotId: string;
  outputPath: string;
  manifest: PhotoshopTiffExportManifest;
};

export type PhotoshopTiffExportPlan = {
  exportFolderPath: string;
  manifestFolderPath: string;
  jobs: PhotoshopTiffExportJob[];
};

export type PhotoshopTiffExportResult = {
  exportFolderPath: string;
  exportedFiles: string[];
};

export type PhotoshopTiffInPlaceSaveResult = {
  tempFolderPath: string;
  replacements: Array<{ fromPath: string; toPath: string }>;
};

export type PhotoshopTiffInPlaceSaveJob = PhotoshopTiffExportJob & {
  finalPath: string;
};

export type PhotoshopTiffInPlaceSavePlan = {
  tempFolderPath: string;
  manifestFolderPath: string;
  jobs: PhotoshopTiffInPlaceSaveJob[];
};

export const photoshopTiffExportRootName = "Photoshop TIFF Export";
const defaultInPlaceSaveConcurrency = 2;

export const buildPhotoshopTiffExportPlan = (
  project: Project,
  folderPath: string,
  exportedAt = new Date()
): PhotoshopTiffExportPlan => {
  const exportFolderPath = path.join(
    folderPath,
    photoshopTiffExportRootName,
    timestampForFolder(exportedAt)
  );
  const manifestFolderPath = path.join(exportFolderPath, ".manifests");
  const sortedShots = [...project.shots].sort((a, b) => a.order - b.order);

  const jobs = sortedShots.map((shot, index) => {
    const shotNumber = String((index + 1) * 10).padStart(4, "0");
    const fileStem = safeFileStem(`${shotNumber}-${path.parse(shot.fileName).name || shot.id}`);
    const outputPath = path.join(exportFolderPath, `${fileStem}.tiff`);

    return {
      shotId: shot.id,
      outputPath,
      manifest: buildPhotoshopTiffManifestForShot(shot, folderPath, outputPath, fileStem)
    };
  });

  return { exportFolderPath, manifestFolderPath, jobs };
};

export const buildPhotoshopTiffInPlaceSavePlan = (
  project: Project,
  folderPath: string,
  saveStamp: string
): PhotoshopTiffInPlaceSavePlan => {
  const tempFolderPath = path.join(folderPath, ".storyboard-workbench", "save-tmp", saveStamp);
  const manifestFolderPath = path.join(tempFolderPath, ".manifests");
  const sortedShots = [...project.shots].sort((a, b) => a.order - b.order);

  const jobs = sortedShots.map((shot) => {
    const outputPath = path.join(tempFolderPath, shot.fileName);
    const documentName = path.parse(shot.fileName).name || shot.id;

    return {
      shotId: shot.id,
      outputPath,
      finalPath: shot.imagePath,
      manifest: buildPhotoshopTiffManifestForShot(shot, folderPath, outputPath, documentName)
    };
  });

  return { tempFolderPath, manifestFolderPath, jobs };
};

export const exportPhotoshopLayeredTiffs = async (
  project: Project,
  folderPath: string,
  options: {
    scriptPath: string;
    exportedAt?: Date;
    pythonPath?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<PhotoshopTiffExportResult> => {
  const plan = buildPhotoshopTiffExportPlan(project, folderPath, options.exportedAt);
  await mkdir(plan.manifestFolderPath, { recursive: true });

  for (const job of plan.jobs) {
    const manifestPath = path.join(plan.manifestFolderPath, `${job.shotId}.json`);
    await writeFile(manifestPath, `${JSON.stringify(job.manifest, null, 2)}\n`, "utf8");
    await runPythonExporter(options.pythonPath, options.scriptPath, manifestPath, options.env);
  }

  return {
    exportFolderPath: plan.exportFolderPath,
    exportedFiles: plan.jobs.map((job) => job.outputPath)
  };
};

export const writePhotoshopLayeredTiffsForInPlaceSave = async (
  project: Project,
  folderPath: string,
  options: {
    scriptPath: string;
    saveStamp: string;
    pythonPath?: string;
    env?: NodeJS.ProcessEnv;
    xmpByShotId?: Record<string, string>;
    swbMetadataByShotId?: Record<string, unknown>;
    onJobWritten?: () => void;
    concurrency?: number;
  }
): Promise<PhotoshopTiffInPlaceSaveResult> => {
  const plan = buildPhotoshopTiffInPlaceSavePlan(project, folderPath, options.saveStamp);
  await mkdir(plan.manifestFolderPath, { recursive: true });

  await runWithConcurrency(plan.jobs, options.concurrency ?? defaultInPlaceSaveConcurrency, async (job) => {
    const manifestPath = path.join(plan.manifestFolderPath, `${job.shotId}.json`);
    const xmp = options.xmpByShotId?.[job.shotId];
    const swbMetadata = options.swbMetadataByShotId?.[job.shotId];
    const manifest = { ...job.manifest, ...(xmp ? { xmp } : {}), ...(swbMetadata ? { swbMetadata } : {}) };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await runPythonExporter(options.pythonPath, options.scriptPath, manifestPath, options.env);
    options.onJobWritten?.();
  });

  return {
    tempFolderPath: plan.tempFolderPath,
    replacements: plan.jobs.map((job) => ({ fromPath: job.outputPath, toPath: job.finalPath }))
  };
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>
): Promise<void> => {
  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await run(item);
    }
  });

  await Promise.all(workers);
};

const runPythonExporter = (
  pythonPath: string | undefined,
  scriptPath: string,
  manifestPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  return runPythonScript({
    pythonPath,
    scriptPath,
    scriptArgs: [manifestPath],
    env,
    errorPrefix: "Photoshop TIFF export failed"
  });
};

const timestampForFolder = (date: Date): string =>
  date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "");

const safeFileStem = (value: string): string => {
  const safe = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return safe || "shot";
};

const buildPhotoshopTiffManifestForShot = (
  shot: Project["shots"][number],
  folderPath: string,
  outputPath: string,
  documentName: string
): PhotoshopTiffExportManifest => {
  const layers = bitmapLayersForShot(shot);
  const width = shot.swb?.canvasWidth ?? layers[0]?.width;
  const height = shot.swb?.canvasHeight ?? layers[0]?.height;

  if (!width || !height) {
    throw new Error(`Cannot export Photoshop TIFF for ${shot.fileName}: missing canvas size`);
  }

  if (layers.length === 0) {
    throw new Error(`Cannot export Photoshop TIFF for ${shot.fileName}: no bitmap layers`);
  }

  return {
    outputPath,
    width,
    height,
    documentName,
    layers: layers.map((layer, layerIndex) => ({
      name: layer.name,
      path: resolveLayerAssetPath(folderPath, layer.bitmapPath),
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      visible: layer.visible,
      background: layerIndex === 0 && layer.kind === "image"
    }))
  };
};

const resolveLayerAssetPath = (folderPath: string, bitmapPath: string): string => {
  if (path.isAbsolute(bitmapPath)) {
    throw new Error("Layer bitmap path must be relative");
  }

  const normalized = path.normalize(bitmapPath);
  const expectedPrefix = path.join(".storyboard-workbench", "layers");

  if (
    normalized === expectedPrefix ||
    !normalized.startsWith(`${expectedPrefix}${path.sep}`) ||
    normalized.split(path.sep).includes("..")
  ) {
    throw new Error(`Layer bitmap path must stay under ${expectedPrefix}`);
  }

  return path.join(folderPath, normalized);
};
