import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { previewIsFresh } from "./previewCache.js";
import { previewPathForImage } from "./previewPaths.js";

const sharpSourceOptions = { unlimited: true } as const;

// Encoding contract shared by legacy cache creation and admitted normal-open.
export const writePreviewImage = async (imagePath: string, previewPath: string): Promise<void> => {
  await sharp(imagePath, sharpSourceOptions)
    .rotate()
    .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true })
    .png()
    .toFile(previewPath);
};

export const createPreview = async (imagePath: string, previewRoot: string, readOnly = false): Promise<string> => {
  const previewPath = previewPathForImage(imagePath, previewRoot);

  if (readOnly) {
    // Discovery may reuse an existing browser-readable cache, never repair it.
    // Missing/stale/unsafe media is an incomplete open, not a successful shot
    // with an undefined path that the browser cannot display as TIFF.
    try {
      for (const directory of [path.dirname(previewRoot), previewRoot]) {
        if (!(await lstat(directory)).isDirectory()) throw new Error("unsafe directory");
      }
      if (!(await lstat(previewPath)).isFile() ||
          path.dirname(await realpath(previewPath)) !== await realpath(previewRoot) ||
          !await previewIsFresh(imagePath, previewPath)) throw new Error("missing or stale preview");
      const preview = sharp(previewPath, sharpSourceOptions);
      if ((await preview.metadata()).format !== "png") throw new Error("invalid preview");
      await preview.raw().toBuffer();
      return previewPath;
    } catch {
      throw new Error("TIFF preview unavailable for read-only open; existing files retained");
    }
  }

  await mkdir(previewRoot, { recursive: true });

  if (await previewIsFresh(imagePath, previewPath)) {
    return previewPath;
  }

  await writePreviewImage(imagePath, previewPath);

  return previewPath;
};
