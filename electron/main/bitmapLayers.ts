import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type SharpBlendMode = "over" | "multiply" | "screen";

export type BitmapLayerComposite = {
  input: Buffer;
  blend: SharpBlendMode;
  opacity: number;
};

export type BitmapLayerFileComposite = Omit<BitmapLayerComposite, "input"> & {
  filePath: string;
};

export const shouldEnsureLayerAssetsForShot = (
  shot: { swb?: { status?: string } },
  options: { includeExternalShots?: boolean } = {}
): boolean => {
  return options.includeExternalShots !== false || shot.swb?.status === "owned";
};

export const applyBitmapLayerOpacity = async (
  pngBuffer: Buffer,
  opacity: number
): Promise<Buffer> => {
  return sharp(pngBuffer)
    .ensureAlpha()
    .linear([1, 1, 1, opacity], [0, 0, 0, 0])
    .png()
    .toBuffer();
};

export const flattenBitmapLayerBuffersToTiff = async (
  width: number,
  height: number,
  layers: BitmapLayerComposite[]
): Promise<Buffer> => {
  return flattenBitmapLayerBuffers(width, height, layers, {
    r: 255,
    g: 255,
    b: 255,
    alpha: 1
  }).then((image) => image.tiff({ compression: "none" }).toBuffer());
};

export const flattenBitmapLayerBuffersToPng = async (
  width: number,
  height: number,
  layers: BitmapLayerComposite[]
): Promise<Buffer> => {
  return flattenBitmapLayerBuffers(width, height, layers, {
    r: 0,
    g: 0,
    b: 0,
    alpha: 0
  }).then((image) => image.png().toBuffer());
};

export const mergeBitmapLayerFilesToPng = async (
  width: number,
  height: number,
  layers: BitmapLayerFileComposite[],
  targetFilePath: string,
  deleteFilePaths: string[] = []
): Promise<void> => {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const layerInputs = await Promise.all(
    layers.map(async (layer) => ({
      input: await sharp(await readFile(layer.filePath))
        .resize({ width: targetWidth, height: targetHeight, fit: "fill" })
        .ensureAlpha()
        .png()
        .toBuffer(),
      opacity: layer.opacity,
      blend: layer.blend
    }))
  );
  const mergedPng = await flattenBitmapLayerBuffersToPng(targetWidth, targetHeight, layerInputs);

  await mkdir(path.dirname(targetFilePath), { recursive: true });
  await writeFile(targetFilePath, mergedPng);
  await Promise.all(deleteFilePaths.map((filePath) => unlink(filePath)));
};

export const copyBitmapLayerFile = async (
  sourceFilePath: string,
  targetFilePath: string
): Promise<void> => {
  await mkdir(path.dirname(targetFilePath), { recursive: true });
  await copyFile(sourceFilePath, targetFilePath);
};

const flattenBitmapLayerBuffers = async (
  width: number,
  height: number,
  layers: BitmapLayerComposite[],
  background: { r: number; g: number; b: number; alpha: number }
) => {
  const composites = await Promise.all(
    layers.map(async (layer) => {
      const opacity = Math.min(1, Math.max(0, layer.opacity));
      return {
        input: opacity < 1 ? await applyBitmapLayerOpacity(layer.input, opacity) : layer.input,
        blend: layer.blend
      };
    })
  );

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background
    }
  })
    .composite(composites);
};
