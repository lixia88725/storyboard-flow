import { assembleAiImagePrompt, type AiSelectedReference } from "./context.js";
import type { Project } from "./types.js";
import { listAiResources } from "./resources.js";
import type { AiImageProviderName } from "./generate.js";

export type AiRequestPreviewInput = {
  folderPath: string;
  project: Project;
  shotId: string;
  selectedShotContext?: string;
  selectedResourceIds?: string[];
  generationSettings?: {
    provider?: AiImageProviderName;
    model?: string;
  };
};

const imageInputLine = (index: number, fileName: string, role?: string, note?: string): string => {
  const details = [role, note?.trim()].filter((item): item is string => Boolean(item));
  return `${index}. ${fileName}${details.length > 0 ? ` - ${details.join(" - ")}` : ""}`;
};

export const buildAiRequestPreview = async ({
  folderPath,
  project,
  shotId,
  selectedShotContext,
  selectedResourceIds = [],
  generationSettings
}: AiRequestPreviewInput): Promise<string> => {
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
  const provider = generationSettings?.provider ?? "openai";
  const model = generationSettings?.model?.trim() || "(provider default)";
  const imageInputs = [
    imageInputLine(1, "selected-storyboard.png"),
    ...selectedReferences.map((reference, index) =>
      imageInputLine(index + 2, reference.fileName, reference.role, reference.note)
    )
  ];

  return [
    "AI request preview",
    "",
    `Provider: ${provider}`,
    `Model: ${model}`,
    "",
    "Prompt:",
    prompt,
    "",
    "Image inputs:",
    ...imageInputs
  ].join("\n");
};
