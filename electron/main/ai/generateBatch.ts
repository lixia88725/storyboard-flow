import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  aiBatchResourceIdsForGroup,
  aiBatchPanelLayout,
  assembleAiBatchImagePrompt,
  groupAiBatchShotIds,
  normalizeAiBatchSize,
  orderedAiBatchShots,
  type AiBatchGroup,
  type AiBatchPanelRect,
  type AiBatchResourceAssignments,
  type AiBatchSize
} from "./batch.js";
import type { AiSelectedReference } from "./context.js";
import { writeAiCandidate, type AiCandidateMetadata } from "./candidates.js";
import { createOpenAiImageProvider, type AiImageProvider, type AiProviderImageInput } from "./openAiImageProvider.js";
import { readShotReferencePng, shotCanvasSize } from "./generate.js";
import { listAiResources } from "./resources.js";
import type { Project, Shot } from "./types.js";
import type { AiImageProviderName } from "./generate.js";

export type GenerateAiBatchCandidatesInput = {
  folderPath: string;
  project: Project;
  shotIds: string[];
  batchSize?: AiBatchSize;
  selectedResourceIds?: string[];
  resourceAssignments?: AiBatchResourceAssignments;
  generationSettings?: {
    provider?: AiImageProviderName;
    model?: string;
  };
  provider?: AiImageProvider;
};

export type AiBatchGenerationGroupResult = {
  index: number;
  shotIds: string[];
  candidateIds: string[];
  error?: string;
};

export type AiBatchGenerationResult = {
  groups: AiBatchGenerationGroupResult[];
  candidates: AiCandidateMetadata[];
};

const maxContactSheetPanelWidth = 960;

const contactSheetPanelSize = (shot: Shot): { width: number; height: number } => {
  const size = shotCanvasSize(shot);
  const scale = Math.min(1, maxContactSheetPanelWidth / size.width);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  };
};

const createInputContactSheet = async (
  folderPath: string,
  shots: Shot[]
): Promise<{ buffer: Buffer; width: number; height: number }> => {
  const layout = aiBatchPanelLayout(shots.length);
  const panelSize = contactSheetPanelSize(shots[0]);
  const width = panelSize.width * layout.columns;
  const height = panelSize.height * layout.rows;
  const composites = await Promise.all(
    shots.map(async (shot, index) => {
      const rect = layout.rects[index];
      const input = await sharp(await readShotReferencePng(folderPath, shot))
        .resize({ width: panelSize.width, height: panelSize.height, fit: "contain", background: "#ffffff" })
        .ensureAlpha()
        .png()
        .toBuffer();
      return {
        input,
        left: Math.round(rect.x * width),
        top: Math.round(rect.y * height)
      };
    })
  );

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#ffffff"
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
  return { buffer, width, height };
};

const cropPanel = async (imageBuffer: Buffer, rect: AiBatchPanelRect): Promise<Buffer> => {
  const metadata = await sharp(imageBuffer).metadata();
  const sourceWidth = metadata.width ?? 1;
  const sourceHeight = metadata.height ?? 1;
  const left = Math.max(0, Math.floor(rect.x * sourceWidth));
  const top = Math.max(0, Math.floor(rect.y * sourceHeight));
  const right = Math.min(sourceWidth, Math.round((rect.x + rect.width) * sourceWidth));
  const bottom = Math.min(sourceHeight, Math.round((rect.y + rect.height) * sourceHeight));
  return sharp(imageBuffer)
    .extract({
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    })
    .png()
    .toBuffer();
};

export const generateAiBatchCandidates = async ({
  folderPath,
  project,
  shotIds,
  batchSize,
  selectedResourceIds = [],
  resourceAssignments = {},
  generationSettings,
  provider = createOpenAiImageProvider()
}: GenerateAiBatchCandidatesInput): Promise<AiBatchGenerationResult> => {
  const groups = groupAiBatchShotIds(project, shotIds, normalizeAiBatchSize(batchSize));
  if (groups.length === 0) {
    throw new Error("No shots selected for AI batch generation");
  }

  const resources = await listAiResources(folderPath);
  const selected = new Set(selectedResourceIds);
  const selectedResources = resources.resources.filter((resource) => selected.has(resource.id));
  const resourceEntries = await Promise.all(
    selectedResources.map(async (resource) => ({
      id: resource.id,
      reference: {
        id: resource.id,
        fileName: resource.fileName,
        role: resource.role,
        note: resource.note
      } satisfies AiSelectedReference,
      image: {
        name: resource.fileName,
        buffer: await readFile(resource.filePath)
      } satisfies AiProviderImageInput
    }))
  );

  const candidates: AiCandidateMetadata[] = [];
  const groupResults: AiBatchGenerationGroupResult[] = [];

  for (const group of groups) {
    const groupResourceIds = new Set(
      aiBatchResourceIdsForGroup({
        shotIds: group.shotIds,
        selectedResourceIds,
        resourceAssignments
      })
    );
    const groupResources = resourceEntries.filter((resource) => groupResourceIds.has(resource.id));
    const result = await generateAiBatchGroup({
      folderPath,
      project,
      group,
      references: groupResources.map((resource) => resource.reference),
      referenceImages: groupResources.map((resource) => resource.image),
      resourceAssignments,
      model: generationSettings?.model,
      provider
    });
    groupResults.push(result.group);
    candidates.push(...result.candidates);
  }

  return {
    groups: groupResults,
    candidates
  };
};

const generateAiBatchGroup = async ({
  folderPath,
  project,
  group,
  references,
  referenceImages,
  resourceAssignments,
  model,
  provider
}: {
  folderPath: string;
  project: Project;
  group: AiBatchGroup;
  references: AiSelectedReference[];
  referenceImages: AiProviderImageInput[];
  resourceAssignments: AiBatchResourceAssignments;
  model?: string;
  provider: AiImageProvider;
}): Promise<{ group: AiBatchGenerationGroupResult; candidates: AiCandidateMetadata[] }> => {
  try {
    const shots = orderedAiBatchShots(project, group.shotIds);
    const prompt = assembleAiBatchImagePrompt({
      project,
      shotIds: group.shotIds,
      references,
      resourceAssignments
    });
    const contactSheet = await createInputContactSheet(folderPath, shots);
    const generatedSheet = await provider.generate({
      prompt,
      model,
      width: contactSheet.width,
      height: contactSheet.height,
      images: [{ name: "selected-storyboards-contact-sheet.png", buffer: contactSheet.buffer }, ...referenceImages]
    });
    const layout = aiBatchPanelLayout(shots.length);
    const candidates = await Promise.all(
      shots.map(async (shot, index) => {
        const { width, height } = shotCanvasSize(shot);
        return writeAiCandidate({
          folderPath,
          shotId: shot.id,
          width,
          height,
          imageBuffer: await cropPanel(generatedSheet, layout.rects[index]),
          prompt
        });
      })
    );
    return {
      group: {
        index: group.index,
        shotIds: group.shotIds,
        candidateIds: candidates.map((candidate) => candidate.id)
      },
      candidates
    };
  } catch (error) {
    return {
      group: {
        index: group.index,
        shotIds: group.shotIds,
        candidateIds: [],
        error: error instanceof Error ? error.message : String(error)
      },
      candidates: []
    };
  }
};
