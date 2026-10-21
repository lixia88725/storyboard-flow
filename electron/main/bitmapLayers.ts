import { lstat, readFile, unlink } from "node:fs/promises";
import { writeProtectedLayerFile } from "./protectedLayerFileWriter.js";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
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
  /** Exact bytes captured with the source identity by the main service. */
  bytes?: Buffer;
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
  deleteFilePaths: string[] = [],
  root?: string
): Promise<void> => withLayerFileOperation(async () => {
  if (deleteFilePaths.includes(targetFilePath) || new Set(deleteFilePaths).size !== deleteFilePaths.length) {
    throw new Error("Merge cleanup must not delete its target or duplicate a source");
  }
  const targetIdentity = await lstat(targetFilePath).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  const deletionIdentities = new Map<string, { dev: number; ino: number; bytes: Buffer }>();
  for (const filePath of deleteFilePaths) {
    const info = await lstat(filePath);
    if (!info.isFile() || info.nlink !== 1 || targetIdentity && info.dev === targetIdentity.dev && info.ino === targetIdentity.ino) {
      throw new Error("Merge cleanup must retain aliases and its physical target");
    }
    deletionIdentities.set(filePath, { dev: info.dev, ino: info.ino, bytes: await readFile(filePath) });
  }
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const layerInputs = await Promise.all(
    layers.map(async (layer) => ({
      input: await sharp(layer.bytes ?? await readFile(layer.filePath))
        .resize({ width: targetWidth, height: targetHeight, fit: "fill" })
        .ensureAlpha()
        .png()
        .toBuffer(),
      opacity: layer.opacity,
      blend: layer.blend
    }))
  );
  const mergedPng = await flattenBitmapLayerBuffersToPng(targetWidth, targetHeight, layerInputs);

  await writeProtectedLayerFile(root ?? await layerOperationRoot(targetFilePath), targetFilePath, mergedPng,
    layers.some(layer => layer.filePath === targetFilePath) ? "upsert" : "create-only");
  // Keep the caller (and its exclusive queue) pending until every started deletion settles.
  const deletionErrors: unknown[] = [];
  await Promise.all(deleteFilePaths.map(async (filePath) => {
    try {
      const expected = deletionIdentities.get(filePath)!;
      const current = await lstat(filePath);
      if (!current.isFile() || current.nlink !== 1 || current.dev !== expected.dev || current.ino !== expected.ino ||
          !(await readFile(filePath)).equals(expected.bytes)) {
        throw new Error("Merge source changed; retained after target commit");
      }
      await unlink(filePath);
    } catch (error) {
      deletionErrors.push(error);
    }
  }));
  if (deletionErrors.length === 1) throw deletionErrors[0];
  if (deletionErrors.length > 1) {
    const primary = deletionErrors[0];
    const message = primary instanceof Error ? primary.message : String(primary);
    throw new AggregateError(deletionErrors, `${message}; ${deletionErrors.length - 1} additional bitmap layer deletion failure(s) after merge`);
  }
});

export const copyBitmapLayerFile = async (
  sourceFilePath: string,
  targetFilePath: string,
  root?: string,
  mode: "upsert" | "create-only" = "upsert",
  onCopied?: Parameters<typeof writeProtectedLayerFile>[4]
): Promise<void> => withLayerFileOperation(async () => {
  if (path.resolve(sourceFilePath) === path.resolve(targetFilePath)) throw new Error("Layer copy must have a distinct target");
  const bytes = await readFile(sourceFilePath);
  await writeProtectedLayerFile(root ?? await layerOperationRoot(targetFilePath), targetFilePath, bytes, mode, onCopied);
});

const layerOperationRoot = async (filePath: string): Promise<string> => {
  const marker = `${path.sep}.storyboard-workbench${path.sep}layers${path.sep}`;
  const index = filePath.indexOf(marker);
  if (index >= 0) return filePath.slice(0, index);
  // The generic low-level API also supports a new nested destination. Find an
  // existing lexical anchor without creating through an unvalidated alias.
  let directory = path.dirname(filePath);
  for (;;) {
    try { await lstat(directory); return directory; }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(directory);
      if (parent === directory) throw error;
      directory = parent;
    }
  }
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
