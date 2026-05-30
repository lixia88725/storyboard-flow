import { execFile } from "node:child_process";
import path from "node:path";
import sharp from "sharp";

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

export type ImportedPhotoshopTiffLayer = {
  name: string;
  assetPath: string;
  visible: boolean;
  locked?: boolean;
  opacity: number;
  blendMode: "normal" | "multiply" | "screen";
  order: number;
};

export type ImportedPhotoshopTiffManifest = {
  sourcePath: string;
  width: number;
  height: number;
  layers: ImportedPhotoshopTiffLayer[];
  warnings: string[];
};

export type PhotoshopTiffImportAssetPlan = {
  layers: BitmapLayer[];
  moves: Array<{ fromPath: string; toPath: string }>;
};

export const photoshopTiffNoLayersMarker = "SWB_PHOTOSHOP_TIFF_NO_LAYERS";
const sharpSourceOptions = { unlimited: true } as const;

export const isLikelyTiffPath = (filePath: string): boolean => {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".tif" || extension === ".tiff";
};

export const isPhotoshopTiffNoLayersError = (error: unknown): boolean => {
  return error instanceof Error && error.message.includes(photoshopTiffNoLayersMarker);
};

export const writeSwbImportWorkingTiff = async ({
  sourcePath,
  outputPath,
  usePlaceholder
}: {
  sourcePath: string;
  outputPath: string;
  usePlaceholder: boolean;
}): Promise<void> => {
  if (!usePlaceholder) {
    await sharp(sourcePath, sharpSourceOptions).rotate().tiff().toFile(outputPath);
    return;
  }

  await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .tiff()
    .toFile(outputPath);
};

export const ensureLayerMoveDestinationsAvailable = async (
  moves: Array<{ toPath: string }>,
  pathExists: (filePath: string) => Promise<boolean>
): Promise<void> => {
  for (const move of moves) {
    if (await pathExists(move.toPath)) {
      throw new Error(`Photoshop TIFF import layer asset already exists: ${move.toPath}`);
    }
  }
};

const bitmapLayerPath = (shotId: string, layerId: string): string =>
  `.storyboard-workbench/layers/${shotId}/${layerId}.png`;

const isPathInside = (childPath: string, parentPath: string): boolean => {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const importedLayerToBitmapLayer = (
  layer: ImportedPhotoshopTiffLayer,
  shotId: string,
  index: number,
  width: number,
  height: number
): BitmapLayer => {
  const isImageLayer = index === 0;
  const id = isImageLayer ? "layer-image" : `layer-${String(index).padStart(4, "0")}`;

  return {
    id,
    kind: isImageLayer ? "image" : "paint",
    name: layer.name || (isImageLayer ? "Image" : `Layer ${index + 1}`),
    visible: layer.visible,
    locked: layer.locked ?? false,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    order: index,
    bitmapPath: bitmapLayerPath(shotId, id),
    width,
    height
  };
};

export const buildPhotoshopTiffImportAssetPlan = (
  manifest: ImportedPhotoshopTiffManifest,
  shotId: string,
  tempLayerRoot: string,
  extractedRoot: string
): PhotoshopTiffImportAssetPlan => {
  const sortedLayers = [...manifest.layers].sort((a, b) => a.order - b.order);
  const layers = sortedLayers.map((layer, index) =>
    importedLayerToBitmapLayer(layer, shotId, index, manifest.width, manifest.height)
  );

  return {
    layers,
    moves: sortedLayers.map((layer, index) => {
      const id = index === 0 ? "layer-image" : `layer-${String(index).padStart(4, "0")}`;
      const toPath = path.join(tempLayerRoot, shotId, `${id}.png`);

      if (!isPathInside(toPath, tempLayerRoot)) {
        throw new Error("Import layer destination must stay under the temp layer root");
      }

      if (!isPathInside(layer.assetPath, extractedRoot)) {
        throw new Error("Imported layer asset must stay under the extraction root");
      }

      return {
        fromPath: layer.assetPath,
        toPath
      };
    })
  };
};

export const topmostImportedLayerId = (layers: BitmapLayer[]): string | undefined => {
  return [...layers].sort((a, b) => b.order - a.order)[0]?.id;
};

export const runPhotoshopTiffImporter = (
  pythonPath: string,
  scriptPath: string,
  sourcePath: string,
  outputDir: string,
  manifestPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  return new Promise((resolve, reject) => {
    execFile(pythonPath, [scriptPath, sourcePath, outputDir, manifestPath], { env }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Photoshop TIFF import failed: ${error.message}\n${stdout.trim()}\n${stderr.trim()}`.trim()
        )
      );
    });
  });
};
