import { lstat, realpath, open, readFile, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeProtectedLayerFile } from "./protectedLayerFileWriter.js";
import { decodeControlledBase64, withControlledBufferOutput, checkControlledMemoryPressure } from './controlledMemory.js';
import { recordProducerPng, beforeProducerPngDelete, recordProducerPngDelete, performProducerPngPhysicalWrite } from './producerPngEffects.js';

import path from "node:path";
import sharp from "sharp";
import { hasPendingFileTransaction } from "./pendingFileTransactionService.js";
import { hasCertifiedPendingBakeState } from "../shared/pendingBakeRules.js";
import type { MergeSourceIdentity } from "./mergeSourceCleanup.js";
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

export type CreateLayerAssetPayload = WriteLayerAssetPayload & {
  project: {
    shots: CreateLayerSourceShot[];
    parkedShots?: CreateLayerSourceShot[];
    pendingBake?: { version: number; shots: Record<string, { state: string; editToken?: string; acceptedOutputIdentity?: string }> };
  };
  shotId: string;
  layerId: string;
  width: number;
  height: number;
};

export type CreateLayerAssetResult =
  | { ok: true; folderPath: string; bitmapPath: string; dataUrl: string; filePath: string }
  | { ok: false; effect: "refused" | "unknown"; message: string; filePath?: string };

type CreateLayerSourceShot = {
  id: string;
  imagePath: string;
  swb?: { status: string; canvasWidth: number; canvasHeight: number };
  layers?: Array<{ id: string; bitmapPath: string }>;
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

  return decodeControlledBase64(match[1]);
};

export const sharpBlendMode = (blendMode: string | undefined): "over" | "multiply" | "screen" => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "over";
};

/** Pure preparation only. The returned Main-owned closure retains parsed bytes
 * and paths, but still uses the full protected writer when actually executed. */
export const prepareLayerPngWrite = (
  payload: WriteLayerAssetPayload
): (() => Promise<WriteLayerAssetPayload & { filePath: string }>) => {
  const captured = { ...payload };
  const filePath = resolveLayerAssetPath(captured.folderPath, captured.bitmapPath);
  const pngBuffer = pngBufferFromDataUrl(captured.dataUrl);
  return async () => {
    await writeProtectedLayerFile(captured.folderPath, filePath, pngBuffer);
    return { ...captured, filePath };
  };
};
export const writeLayerPng = async (payload: WriteLayerAssetPayload): Promise<WriteLayerAssetPayload & { filePath: string }> => prepareLayerPngWrite(payload)();

/** Add-only final-target reservation. Never replaces an existing file. A failed
 * write/close can leave a new partial file; do not unlink an uncertain effect.
 * Known aliases are refused; hostile concurrent parent replacement is out of scope. */
export const createLayerPng = async (payload: CreateLayerAssetPayload): Promise<CreateLayerAssetResult> => {
  let attempted = false;
  let filePath: string | undefined;
  try {
    filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
    const root = path.resolve(payload.folderPath);
    if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("Create parent alias refused");
    const parent = path.dirname(filePath);
    let directory = root;
    for (const part of path.relative(root, parent).split(path.sep)) {
      directory = path.join(directory, part);
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("Create parent alias refused");
    }
    const project = payload.project, envelope = project?.pendingBake;
    if (await hasPendingFileTransaction(root)) throw new Error("Pending transaction prevents Add initialization; assets retained");
    const entries = envelope?.shots;
    if (!envelope || envelope.version !== 1 || !entries || typeof entries !== "object" || Array.isArray(entries) ||
        Object.values(entries).some(e => !e || !/^[a-f0-9]{64}$/u.test(e.acceptedOutputIdentity ?? "") ||
          !hasCertifiedPendingBakeState(e))) {
      throw new Error("Create ownership unknown; certified source required");
    }
    const shot = project.shots.filter(s => s.id === payload.shotId);
    if (shot.length !== 1 || shot[0].swb?.status !== "owned" ||
        !Number.isInteger(payload.width) || !Number.isInteger(payload.height) || payload.width <= 0 || payload.height <= 0 ||
        payload.width !== shot[0].swb.canvasWidth || payload.height !== shot[0].swb.canvasHeight ||
        !/^[A-Za-z0-9_-]+$/u.test(payload.shotId) || !/^[A-Za-z0-9_-]+$/u.test(payload.layerId) ||
        payload.bitmapPath !== `.storyboard-workbench/layers/${payload.shotId}/${payload.layerId}.png` ||
        [...project.shots, ...(project.parkedShots ?? [])].some(s => s.layers?.some(l => l.id === payload.layerId || l.bitmapPath === payload.bitmapPath))) {
      throw new Error("Create descriptor is not a new certified target");
    }
    for (const s of [...project.shots, ...(project.parkedShots ?? [])]) {
      const image = path.resolve(s.imagePath), relative = path.relative(root, image);
      if (s.swb?.status !== "owned" || !/\.tiff?$/iu.test(image) || relative.startsWith("..") || path.isAbsolute(relative) ||
          (await lstat(image)).isSymbolicLink() || await realpath(image) !== image ||
          createHash("sha256").update(await readFile(image)).digest("hex") !== entries[s.id]?.acceptedOutputIdentity) {
        throw new Error("Create source is not certified or changed externally");
      }
      for (const layer of s.layers ?? []) await readFile(resolveLayerAssetPath(root, layer.bitmapPath));
    }
    const bytes = pngBufferFromDataUrl(payload.dataUrl);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Create asset must contain PNG bytes");
    checkControlledMemoryPressure();
    const metadata = await sharp(bytes).metadata();
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) || !metadata.width || !metadata.height) throw new Error("Create PNG dimensions unavailable");
    const maximumRawBytes = Number(BigInt(metadata.width) * BigInt(metadata.height) * 4n);
    let dimensions = { width: 0, height: 0 };
    await withControlledBufferOutput(maximumRawBytes, async () => {
      const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      dimensions = decoded.info;
      return decoded.data;
    });
    if (dimensions.width !== payload.width || dimensions.height !== payload.height) throw new Error("Create PNG dimensions differ from descriptor");
    let created: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>> | undefined;
    let physicalError: unknown, physicalFailed = false;
    try {
      await performProducerPngPhysicalWrite({root,filePath,bytes,mode:'create-only',kind:'node-exclusive-create'},async (_plan,control)=>{
        // wx remains the sole absence authority. No rename, new mode or retry.
        const handle = await open(filePath!, "wx");
        attempted = true;
        try {
          let observed: Awaited<ReturnType<typeof handle.stat>>;
          try { observed = await handle.stat(); await handle.writeFile(bytes); } finally { await handle.close(); }
          created = observed;
        } catch (error) { control?.unknown(); throw error; }
      });
    } catch (error) { physicalFailed = true; physicalError = error; }
    // A complete original stat/write/close remains a real created version even
    // if the later census fails. Partial/uncertain close never mints a receipt.
    if(created){
      try { await recordProducerPng({ filePath, identity: { dev: String(created.dev), ino: String(created.ino) }, bytes, kind: 'created', originalAbsence: { project: structuredClone(project), shotId: payload.shotId, layerId: payload.layerId } }); }
      catch(error){if(physicalFailed)throw new AggregateError([physicalError,error],'Created PNG accounting and producer retention failed');throw error;}
    }
    if(physicalFailed)throw physicalError;
    return { ok: true, folderPath: payload.folderPath, bitmapPath: payload.bitmapPath, dataUrl: payload.dataUrl, filePath };
  } catch (error) {
    return { ok: false, effect: attempted ? "unknown" : "refused", message: error instanceof Error ? error.message : String(error), filePath };
  }
};

export const readLayerPng = async (payload: LayerAssetPayload): Promise<string | undefined> => {
  const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
  if (!(await pathExists(filePath))) {
    return undefined;
  }

  const pngBuffer = await readFile(filePath);
  // The reply is a V8 string, not a Buffer backing, so it is admitted against the
  // live pressure policy with its exact base64 length before it is built.
  checkControlledMemoryPressure(Math.ceil(pngBuffer.byteLength / 3) * 4);
  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
};

export const deleteLayerPng = async (payload: LayerAssetPayload): Promise<LayerAssetPayload> => {
  const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
  await beforeProducerPngDelete(filePath);
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
  await recordProducerPngDelete(filePath);
  return payload;
};

export const copyLayerPng = async (
  payload: CopyLayerPngPayload
): Promise<CopyLayerPngPayload & { targetFilePath: string }> => {
  const sourcePath = resolveLayerAssetPath(payload.folderPath, payload.sourceBitmapPath);
  const targetPath = resolveLayerAssetPath(payload.folderPath, payload.targetBitmapPath);
  await copyBitmapLayerFile(sourcePath, targetPath, payload.folderPath);
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

  const sourceIdentity = await lstat(sourcePath), targetIdentity = await lstat(targetPath);
  if (!sourceIdentity.isFile() || !targetIdentity.isFile() || sourceIdentity.nlink !== 1 || targetIdentity.nlink !== 1 ||
      sourceIdentity.dev === targetIdentity.dev && sourceIdentity.ino === targetIdentity.ino) {
    throw new Error("Merge source and target must be distinct ordinary files; aliases refused");
  }
  const sourceBytes = await readFile(sourcePath);
  const width = Math.max(1, Math.round(payload.width));
  const height = Math.max(1, Math.round(payload.height));
  const targetInput = await sharp(targetPath)
    .resize({ width, height, fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const sourceInput = await sharp(sourceBytes)
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

  await writeProtectedLayerFile(payload.folderPath, targetPath, mergedPng);
  const currentSource = await lstat(sourcePath);
  if (currentSource.dev !== sourceIdentity.dev || currentSource.ino !== sourceIdentity.ino ||
      !currentSource.isFile() || currentSource.nlink !== 1 || !(await readFile(sourcePath)).equals(sourceBytes)) {
    throw new Error("[PNG_COMMITTED] Merge source changed; source retained after target commit");
  }
  await unlink(sourcePath);
  return { ...payload, targetFilePath: targetPath };
};

export const mergeVisibleLayers = async (
  payload: MergeVisibleLayersPayload
): Promise<MergeVisibleLayersPayload & { targetFilePath: string; sourceIdentities: MergeSourceIdentity[]; targetDataUrl: string }> => {
  const targetPath = resolveLayerAssetPath(payload.folderPath, payload.targetBitmapPath);

  if (payload.layers.length < 2) {
    throw new Error("At least two visible layers are required to merge");
  }

  const sourceIdentities = await Promise.all(payload.layers.map(async layer => {
    const file = resolveLayerAssetPath(payload.folderPath, layer.bitmapPath);
    const info = await lstat(file);
    return { bitmapPath: layer.bitmapPath, dev: info.dev, ino: info.ino,
      dataUrl: `data:image/png;base64,${(await readFile(file)).toString("base64")}` };
  }));

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
          bytes: decodeControlledBase64(sourceIdentities.find(identity => identity.bitmapPath === layer.bitmapPath)!.dataUrl.split(",")[1]),
          opacity: layer.opacity,
          blend: sharpBlendMode(layer.blendMode)
        };
      })
    ),
    targetPath,
    payload.deleteBitmapPaths.map((bitmapPath) =>
      resolveLayerAssetPath(payload.folderPath, bitmapPath)
    ),
    payload.folderPath
  );
  return { ...payload, targetFilePath: targetPath, sourceIdentities,
    targetDataUrl: `data:image/png;base64,${(await readFile(targetPath)).toString("base64")}` };
};
