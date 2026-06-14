import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assembleAiImagePrompt, type AiSelectedReference } from "./context.js";
import type { BitmapBlendMode, BitmapLayer, Project, Shot } from "./types.js";
import { flattenBitmapLayerBuffersToPng, type BitmapLayerComposite } from "../bitmapLayers.js";
import { writeAiCandidate, type AiCandidateMetadata } from "./candidates.js";
import { createOpenAiImageProvider, type AiImageProvider } from "./openAiImageProvider.js";
import { listAiResources } from "./resources.js";

export type AiImageProviderName = "openai" | "seedream";

export type GenerateAiCandidateInput = {
  folderPath: string;
  project: Project;
  shotId: string;
  selectedShotContext?: string;
  selectedResourceIds?: string[];
  generationSettings?: {
    provider?: AiImageProviderName;
    model?: string;
  };
  provider?: AiImageProvider;
};

const sharpBlendMode = (blendMode: BitmapBlendMode): BitmapLayerComposite["blend"] => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }
  return "over";
};

const resolveProjectPath = (folderPath: string, filePath: string): string =>
  path.isAbsolute(filePath) ? filePath : path.join(folderPath, filePath);

export const shotCanvasSize = (shot: Shot): { width: number; height: number } => ({
  width: Math.max(1, Math.round(shot.swb?.canvasWidth ?? shot.layers?.[0]?.width ?? 1024)),
  height: Math.max(1, Math.round(shot.swb?.canvasHeight ?? shot.layers?.[0]?.height ?? 1024))
});

const bitmapLayersForShot = (shot: Shot): BitmapLayer[] =>
  [...(shot.layers ?? [])]
    .filter((layer) => !layer.cleared)
    .sort((a, b) => a.order - b.order);

export const readShotReferencePng = async (folderPath: string, shot: Shot): Promise<Buffer> => {
  const { width, height } = shotCanvasSize(shot);
  const layers = bitmapLayersForShot(shot).filter((layer) => layer.visible);
  const composites: BitmapLayerComposite[] = [];

  for (const layer of layers) {
    try {
      const input = await sharp(resolveProjectPath(folderPath, layer.bitmapPath))
        .resize({ width, height, fit: "fill" })
        .ensureAlpha()
        .png()
        .toBuffer();
      composites.push({ input, opacity: layer.opacity, blend: sharpBlendMode(layer.blendMode) });
    } catch {
      // Missing layer assets are ignored here; normal layer validation still happens on Save.
    }
  }

  if (composites.length > 0) {
    return flattenBitmapLayerBuffersToPng(width, height, composites);
  }

  return sharp(resolveProjectPath(folderPath, shot.previewPath ?? shot.imagePath))
    .resize({ width, height, fit: "contain", background: "#ffffff" })
    .ensureAlpha()
    .png()
    .toBuffer();
};

export const generateAiCandidate = async ({
  folderPath,
  project,
  shotId,
  selectedShotContext,
  selectedResourceIds = [],
  generationSettings,
  provider = createOpenAiImageProvider()
}: GenerateAiCandidateInput): Promise<AiCandidateMetadata> => {
  const shot = [...project.shots, ...(project.parkedShots ?? [])].find((item) => item.id === shotId);
  if (!shot) {
    throw new Error(`Shot not found: ${shotId}`);
  }

  const resources = await listAiResources(folderPath);
  const selected = new Set(selectedResourceIds);
  const selectedReferences = resources.resources
    .filter((resource) => selected.has(resource.id))
    .map((resource): AiSelectedReference => ({
      id: resource.id,
      fileName: resource.fileName,
      role: resource.role,
      note: resource.note
    }));
  const prompt = assembleAiImagePrompt({
    project,
    shotId,
    selectedShotContext,
    references: selectedReferences
  });
  const shotImage = await readShotReferencePng(folderPath, shot);
  const referenceImages = await Promise.all(
    resources.resources
      .filter((resource) => selected.has(resource.id))
      .map(async (resource) => ({
        name: resource.fileName,
        buffer: await readFile(resource.filePath)
      }))
  );
  const result = await provider.generate({
    prompt,
    model: generationSettings?.model,
    images: [{ name: "selected-storyboard.png", buffer: shotImage }, ...referenceImages]
  });
  const { width, height } = shotCanvasSize(shot);
  return writeAiCandidate({
    folderPath,
    shotId: shot.id,
    width,
    height,
    imageBuffer: result,
    prompt
  });
};
