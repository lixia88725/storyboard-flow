import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { BitmapLayer, Project } from "./types.js";

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

const resolveProjectRelativePath = (folderPath: string, relativePath: string): string =>
  path.join(folderPath, relativePath);

export const writeAiCandidate = async ({
  folderPath,
  shotId,
  width,
  height,
  imageBuffer,
  prompt
}: WriteAiCandidateInput): Promise<AiCandidateMetadata> => {
  const id = `ai-${randomUUID()}`;
  const bitmapPath = candidateBitmapPath(id);
  const filePath = resolveProjectRelativePath(folderPath, bitmapPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await sharp(imageBuffer)
    .resize({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), fit: "cover" })
    .ensureAlpha()
    .png()
    .toFile(filePath);
  const metadata: AiCandidateMetadata = {
    id,
    shotId,
    bitmapPath,
    filePath,
    width,
    height,
    prompt,
    createdAt: new Date().toISOString()
  };
  await writeFile(aiCandidateMetadataPath(folderPath, id), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
};

export const readAiCandidate = async (
  folderPath: string,
  candidateId: string
): Promise<AiCandidateMetadata> => {
  const metadata = JSON.parse(await readFile(aiCandidateMetadataPath(folderPath, candidateId), "utf8")) as AiCandidateMetadata;
  if (metadata.id !== candidateId) {
    throw new Error("AI candidate metadata id mismatch");
  }
  return metadata;
};

export const discardAiCandidate = async (folderPath: string, candidateId: string): Promise<void> => {
  const metadata = await readAiCandidate(folderPath, candidateId).catch(() => undefined);
  if (metadata) {
    await unlink(metadata.filePath).catch(() => undefined);
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
