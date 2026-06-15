import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  copyBitmapLayerFile,
  flattenBitmapLayerBuffersToPng,
  mergeBitmapLayerFilesToPng
} from "./bitmapLayers.js";

export type LayerAssetPayload = {
  folderPath: string;
  bitmapPath: string;
};

export type WriteLayerAssetPayload = LayerAssetPayload & {
  dataUrl: string;
};

export type MergeLayerDownPayload = {
  folderPath: string;
  sourceBitmapPath: string;
  targetBitmapPath: string;
  width: number;
  height: number;
  sourceOpacity: number;
  sourceBlendMode: "normal" | "multiply" | "screen";
  targetOpacity: number;
  targetBlendMode: "normal" | "multiply" | "screen";
};

export type MergeVisibleLayersPayload = {
  folderPath: string;
  targetBitmapPath: string;
  width: number;
  height: number;
  layers: Array<{
    bitmapPath: string;
    opacity: number;
    blendMode: "normal" | "multiply" | "screen";
  }>;
  deleteBitmapPaths: string[];
};

export type CopyLayerPngPayload = {
  folderPath: string;
  sourceBitmapPath: string;
  targetBitmapPath: string;
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

export const resolveLayerAssetPath = (folderPath: string, bitmapPath: string): string => {
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

const pngBufferFromDataUrl = (dataUrl: string): Buffer => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);

  if (!match) {
    throw new Error("Layer asset must be a PNG data URL");
  }

  return Buffer.from(match[1], "base64");
};

export const sharpBlendMode = (blendMode: string | undefined): "over" | "multiply" | "screen" => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "over";
};

export const writeLayerPng = async (
  payload: WriteLayerAssetPayload
): Promise<WriteLayerAssetPayload & { filePath: string }> => {
  const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
  const pngBuffer = pngBufferFromDataUrl(payload.dataUrl);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, pngBuffer);
  return { ...payload, filePath };
};

export const readLayerPng = async (payload: LayerAssetPayload): Promise<string | undefined> => {
  const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
  if (!(await pathExists(filePath))) {
    return undefined;
  }

  const pngBuffer = await readFile(filePath);
  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
};

export const deleteLayerPng = async (payload: LayerAssetPayload): Promise<LayerAssetPayload> => {
  const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
  return payload;
};

export const copyLayerPng = async (
  payload: CopyLayerPngPayload
): Promise<CopyLayerPngPayload & { targetFilePath: string }> => {
  const sourcePath = resolveLayerAssetPath(payload.folderPath, payload.sourceBitmapPath);
  const targetPath = resolveLayerAssetPath(payload.folderPath, payload.targetBitmapPath);
  await copyBitmapLayerFile(sourcePath, targetPath);
  return { ...payload, targetFilePath: targetPath };
};

export const mergeLayerDown = async (
  payload: MergeLayerDownPayload
): Promise<MergeLayerDownPayload & { targetFilePath: string }> => {
  const sourcePath = resolveLayerAssetPath(payload.folderPath, payload.sourceBitmapPath);
  const targetPath = resolveLayerAssetPath(payload.folderPath, payload.targetBitmapPath);

  if (!(await pathExists(sourcePath))) {
    throw new Error(`Layer asset missing: ${payload.sourceBitmapPath}`);
  }

  if (!(await pathExists(targetPath))) {
    throw new Error(`Layer asset missing: ${payload.targetBitmapPath}`);
  }

  const width = Math.max(1, Math.round(payload.width));
  const height = Math.max(1, Math.round(payload.height));
  const targetInput = await sharp(targetPath)
    .resize({ width, height, fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const sourceInput = await sharp(sourcePath)
    .resize({ width, height, fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const mergedPng = await flattenBitmapLayerBuffersToPng(width, height, [
    {
      input: targetInput,
      opacity: payload.targetOpacity,
      blend: sharpBlendMode(payload.targetBlendMode)
    },
    {
      input: sourceInput,
      opacity: payload.sourceOpacity,
      blend: sharpBlendMode(payload.sourceBlendMode)
    }
  ]);

  await writeFile(targetPath, mergedPng);
  await unlink(sourcePath);
  return { ...payload, targetFilePath: targetPath };
};

export const mergeVisibleLayers = async (
  payload: MergeVisibleLayersPayload
): Promise<MergeVisibleLayersPayload & { targetFilePath: string }> => {
  const targetPath = resolveLayerAssetPath(payload.folderPath, payload.targetBitmapPath);

  if (payload.layers.length < 2) {
    throw new Error("At least two visible layers are required to merge");
  }

  await mergeBitmapLayerFilesToPng(
    payload.width,
    payload.height,
    await Promise.all(
      payload.layers.map(async (layer) => {
        const filePath = resolveLayerAssetPath(payload.folderPath, layer.bitmapPath);
        if (!(await pathExists(filePath))) {
          throw new Error(`Layer asset missing: ${layer.bitmapPath}`);
        }

        return {
          filePath,
          opacity: layer.opacity,
          blend: sharpBlendMode(layer.blendMode)
        };
      })
    ),
    targetPath,
    payload.deleteBitmapPaths.map((bitmapPath) =>
      resolveLayerAssetPath(payload.folderPath, bitmapPath)
    )
  );
  return { ...payload, targetFilePath: targetPath };
};
