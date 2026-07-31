import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { BitmapLayer, Project } from "./types.js";
import { atomicWriteTextFile } from "../fileRenames.js";
import {
  isVisiblePendingPath,
  visiblePendingFolderPath
} from "../pendingShotFilesService.js";

export type AiCandidateMetadata = {
  id: string;
  shotId: string;
  bitmapPath: string;
  filePath: string;
  width: number;
  height: number;
  prompt: string;
  createdAt: string;
};

export type WriteAiCandidateInput = {
  folderPath: string;
  shotId: string;
  width: number;
  height: number;
  imageBuffer: Buffer;
  prompt: string;
};

export type ApplyAiCandidateInput = {
  folderPath: string;
  project: Project;
  candidateId: string;
};

const aiCandidateRoot = ".storyboard-workbench/ai-candidates";

export const aiCandidateFolderPath = (folderPath: string): string =>
  path.join(folderPath, aiCandidateRoot);

const aiCandidateMetadataPath = (folderPath: string, candidateId: string): string =>
  path.join(aiCandidateFolderPath(folderPath), `${candidateId}.json`);

const candidateBitmapPath = (candidateId: string): string =>
  `${aiCandidateRoot}/${candidateId}.png`;

const candidateVisibleFileName = (candidateId: string, createdAt: string): string => {
  const timestamp = createdAt.replace(/\D/g, "").slice(0, 14) || "undated";
  return `AI_${timestamp}_${candidateId.replace(/^ai-/, "").slice(0, 8)}.png`;
};

const availableCandidatePath = async (
  folderPath: string,
  candidateId: string,
  createdAt: string
): Promise<string> => {
  const pendingFolder = visiblePendingFolderPath(folderPath);
  const originalName = candidateVisibleFileName(candidateId, createdAt);
  const extension = path.extname(originalName);
  const baseName = path.basename(originalName, extension);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targetPath = path.join(
      pendingFolder,
      `${baseName}${attempt === 0 ? "" : `_${attempt}`}${extension}`
    );
    try {
      await stat(targetPath);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        return targetPath;
      }
      throw error;
    }
  }
  throw new Error("Could not create a unique visible AI candidate filename");
};

const projectRelativePath = (folderPath: string, filePath: string): string =>
  path.relative(folderPath, filePath).split(path.sep).join("/");

const resolveProjectRelativePath = (folderPath: string, relativePath: string): string =>
  path.join(folderPath, relativePath);

const normalizeAiCandidateMetadata = (
  folderPath: string,
  candidateId: string,
  value: unknown
): AiCandidateMetadata => {
  if (!value || typeof value !== "object") {
    throw new Error("AI candidate metadata is invalid");
  }
  const metadata = value as Partial<AiCandidateMetadata>;
  if (
    metadata.id !== candidateId ||
    typeof metadata.shotId !== "string" ||
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    typeof metadata.prompt !== "string" ||
    typeof metadata.createdAt !== "string"
  ) {
    throw new Error("AI candidate metadata is incomplete");
  }
  const legacyBitmapPath = candidateBitmapPath(candidateId);
  const bitmapPath =
    typeof metadata.bitmapPath === "string" &&
    (metadata.bitmapPath === legacyBitmapPath ||
      isVisiblePendingPath(folderPath, resolveProjectRelativePath(folderPath, metadata.bitmapPath)))
      ? metadata.bitmapPath
      : legacyBitmapPath;
  return {
    id: candidateId,
    shotId: metadata.shotId,
    bitmapPath,
    filePath: resolveProjectRelativePath(folderPath, bitmapPath),
    width: metadata.width,
    height: metadata.height,
    prompt: metadata.prompt,
    createdAt: metadata.createdAt
  };
};

export const writeAiCandidate = async ({
  folderPath,
  shotId,
  width,
  height,
  imageBuffer,
  prompt
}: WriteAiCandidateInput): Promise<AiCandidateMetadata> => {
  const id = `ai-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const filePath = path.join(
    visiblePendingFolderPath(folderPath),
    candidateVisibleFileName(id, createdAt)
  );
  const bitmapPath = projectRelativePath(folderPath, filePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await sharp(imageBuffer)
    .resize({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), fit: "cover" })
    .ensureAlpha()
    .png()
    .toFile(filePath);
  await mkdir(aiCandidateFolderPath(folderPath), { recursive: true });
  const metadata: AiCandidateMetadata = {
    id,
    shotId,
    bitmapPath,
    filePath,
    width,
    height,
    prompt,
    createdAt
  };
  try {
    await writeFile(aiCandidateMetadataPath(folderPath, id), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
  return metadata;
};

export const readAiCandidate = async (
  folderPath: string,
  candidateId: string
): Promise<AiCandidateMetadata> => {
  const metadata = normalizeAiCandidateMetadata(
    folderPath,
    candidateId,
    JSON.parse(await readFile(aiCandidateMetadataPath(folderPath, candidateId), "utf8"))
  );
  await stat(metadata.filePath);
  if (isVisiblePendingPath(folderPath, metadata.filePath)) {
    return metadata;
  }

  const targetPath = await availableCandidatePath(folderPath, candidateId, metadata.createdAt);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(metadata.filePath, targetPath);
  const migrated = {
    ...metadata,
    bitmapPath: projectRelativePath(folderPath, targetPath),
    filePath: targetPath
  };
  try {
    await atomicWriteTextFile(
      aiCandidateMetadataPath(folderPath, candidateId),
      `${JSON.stringify(migrated, null, 2)}\n`,
      {
        mkdir: async (directoryPath) => {
          await mkdir(directoryPath, { recursive: true });
        },
        rename,
        unlink,
        writeFile
      }
    );
  } catch (error) {
    await rename(targetPath, metadata.filePath).catch(() => undefined);
    throw error;
  }
  return migrated;
};

export const listAiCandidates = async (folderPath: string): Promise<AiCandidateMetadata[]> => {
  let entries;
  try {
    entries = await readdir(aiCandidateFolderPath(folderPath), { withFileTypes: true });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const candidateId = entry.name.slice(0, -".json".length);
        try {
          return await readAiCandidate(folderPath, candidateId);
        } catch (error) {
          console.warn(
            `Skipping invalid AI candidate ${entry.name}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return undefined;
        }
      })
  );

  return results
    .filter((candidate): candidate is AiCandidateMetadata => Boolean(candidate))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

export const promoteAiCandidateToShot = async (
  folderPath: string,
  candidateId: string
): Promise<string> => {
  const metadata = await readAiCandidate(folderPath, candidateId);
  await mkdir(folderPath, { recursive: true });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const imagePath = path.join(folderPath, `ai_draft_${Date.now()}_${attempt}.tiff`);
    try {
      await stat(imagePath);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        await sharp(metadata.filePath)
          .resize({
            width: Math.max(1, Math.round(metadata.width)),
            height: Math.max(1, Math.round(metadata.height)),
            fit: "fill"
          })
          .tiff()
          .toFile(imagePath);
        return imagePath;
      }
      throw error;
    }
  }

  throw new Error("Could not create a unique AI Draft shot filename");
};

export const rollbackPromotedAiCandidateShot = async (
  folderPath: string,
  imagePath: string
): Promise<void> => {
  const relativePath = path.relative(folderPath, imagePath);
  if (
    path.dirname(relativePath) !== "." ||
    !/^ai_draft_\d+_\d+\.tiff$/i.test(path.basename(relativePath))
  ) {
    throw new Error("AI Draft rollback path is invalid");
  }
  await unlink(imagePath).catch((error) => {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  });
};

export const discardAiCandidate = async (
  folderPath: string,
  candidateId: string,
  options: { trashItem?: (filePath: string) => Promise<void> } = {}
): Promise<void> => {
  const metadata = await readAiCandidate(folderPath, candidateId).catch(() => undefined);
  if (metadata) {
    if (isVisiblePendingPath(folderPath, metadata.filePath) && options.trashItem) {
      await options.trashItem(metadata.filePath);
    } else {
      await unlink(metadata.filePath);
    }
  }
  await unlink(aiCandidateMetadataPath(folderPath, candidateId)).catch(() => undefined);
};

export const applyAiCandidateAsLayer = async ({
  folderPath,
  project,
  candidateId
}: ApplyAiCandidateInput): Promise<{ project: Project; layer: BitmapLayer }> => {
  const metadata = await readAiCandidate(folderPath, candidateId);
  const shot = project.shots.find((item) => item.id === metadata.shotId);
  if (!shot) {
    throw new Error(`Shot not found for AI candidate: ${metadata.shotId}`);
  }

  const existingLayers = shot.layers ?? [];
  const nextOrder =
    existingLayers.length === 0 ? 0 : Math.max(...existingLayers.map((layer) => layer.order)) + 1;
  const layerId = `ai-draft-${randomUUID()}`;
  const layerBitmapPath = `.storyboard-workbench/layers/${shot.id}/${layerId}.png`;
  const layerFilePath = resolveProjectRelativePath(folderPath, layerBitmapPath);
  await mkdir(path.dirname(layerFilePath), { recursive: true });
  await copyFile(metadata.filePath, layerFilePath);

  const layer: BitmapLayer = {
    id: layerId,
    kind: "paint",
    name: "AI Draft",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    order: nextOrder,
    bitmapPath: layerBitmapPath,
    width: metadata.width,
    height: metadata.height
  };

  return {
    layer,
    project: {
      ...project,
      shots: project.shots.map((item) =>
        item.id === shot.id
          ? {
              ...item,
              layers: [...existingLayers, layer],
              activeLayerId: layer.id
            }
          : item
      )
    }
  };
};
