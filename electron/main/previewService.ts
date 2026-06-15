import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { previewIsFresh } from "./previewCache.js";
import { previewPathForImage } from "./previewPaths.js";

const sharpSourceOptions = { unlimited: true } as const;

export const createPreview = async (imagePath: string, previewRoot: string): Promise<string> => {
  const previewPath = previewPathForImage(imagePath, previewRoot);

  await mkdir(previewRoot, { recursive: true });

  if (await previewIsFresh(imagePath, previewPath)) {
    return previewPath;
  }

  await sharp(imagePath, sharpSourceOptions)
    .rotate()
    .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true })
    .png()
    .toFile(previewPath);

  return previewPath;
};
