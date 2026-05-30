import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type BitmapLayer = {
  id: string;
  kind: "image" | "paint";
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: "normal" | "multiply" | "screen";
  order: number;
  bitmapPath: string;
  width: number;
  height: number;
  cleared?: boolean;
};

type Project = {
  name: string;
  shots: Array<{
    id: string;
    imagePath: string;
    fileName: string;
    order: number;
    layers?: BitmapLayer[];
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

export const photoshopTiffExportRootName = "Photoshop TIFF Export";

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
    const layers = bitmapLayersForShot(shot);
    const width = shot.swb?.canvasWidth ?? layers[0]?.width;
    const height = shot.swb?.canvasHeight ?? layers[0]?.height;

    if (!width || !height) {
      throw new Error(`Cannot export Photoshop TIFF for ${shot.fileName}: missing canvas size`);
    }

    if (layers.length === 0) {
      throw new Error(`Cannot export Photoshop TIFF for ${shot.fileName}: no bitmap layers`);
    }

    const shotNumber = String((index + 1) * 10).padStart(4, "0");
    const fileStem = safeFileStem(`${shotNumber}-${path.parse(shot.fileName).name || shot.id}`);
    const outputPath = path.join(exportFolderPath, `${fileStem}.tiff`);

    return {
      shotId: shot.id,
      outputPath,
      manifest: {
        outputPath,
        width,
        height,
        documentName: fileStem,
        layers: layers.map((layer, layerIndex) => ({
          name: layer.name,
          path: resolveLayerAssetPath(folderPath, layer.bitmapPath),
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          visible: layer.visible,
          background: layerIndex === 0 && layer.kind === "image"
        }))
      }
    };
  });

  return { exportFolderPath, manifestFolderPath, jobs };
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
    await runPythonExporter(options.pythonPath ?? "python3", options.scriptPath, manifestPath, options.env);
  }

  return {
    exportFolderPath: plan.exportFolderPath,
    exportedFiles: plan.jobs.map((job) => job.outputPath)
  };
};

const runPythonExporter = (
  pythonPath: string,
  scriptPath: string,
  manifestPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  return new Promise((resolve, reject) => {
    execFile(pythonPath, [scriptPath, manifestPath], { env }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Photoshop TIFF export failed: ${error.message}\n${stdout.trim()}\n${stderr.trim()}`.trim()
        )
      );
    });
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

const bitmapLayersForShot = (shot: Project["shots"][number]): BitmapLayer[] => {
  return [...(shot.layers ?? [])]
    .sort((a, b) => {
      if (a.kind === "image" && b.kind !== "image") {
        return -1;
      }

      if (a.kind !== "image" && b.kind === "image") {
        return 1;
      }

      return a.order - b.order;
    })
    .map((layer, order) => ({
      ...layer,
      order,
      visible: layer.visible ?? true,
      locked: layer.locked ?? false,
      opacity: layer.opacity ?? 1,
      blendMode: layer.blendMode ?? "normal"
    }));
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
