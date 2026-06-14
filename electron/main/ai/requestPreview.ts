import { assembleAiImagePrompt, type AiSelectedReference } from "./context.js";
import type { Project } from "./types.js";
import { listAiResources } from "./resources.js";
import type { AiImageProviderName } from "./generate.js";
import {
  aiBatchResourceIdsForGroup,
  assembleAiBatchImagePrompt,
  groupAiBatchShotIds,
  summarizeAiBatchGroups,
  type AiBatchResourceAssignments
} from "./batch.js";
import { validateComfyUiWorkflow } from "./comfyUiWorkflow.js";
import type { ComfyUiSettings } from "./settings.js";

export type AiRequestPreviewInput = {
  folderPath: string;
  project: Project;
  shotId?: string;
  shotIds?: string[];
  selectedShotContext?: string;
  selectedResourceIds?: string[];
  resourceAssignments?: AiBatchResourceAssignments;
  generationSettings?: {
    provider?: AiImageProviderName;
    model?: string;
  };
  comfyUiSettings?: ComfyUiSettings;
};

const imageInputLine = (index: number, fileName: string, role?: string, note?: string): string => {
  const details = [role, note?.trim()].filter((item): item is string => Boolean(item));
  return `${index}. ${fileName}${details.length > 0 ? ` - ${details.join(" - ")}` : ""}`;
};

const providerPreviewLines = ({
  provider,
  model,
  comfyUiSettings,
  imageCount
}: {
  provider: AiImageProviderName;
  model: string;
  comfyUiSettings?: ComfyUiSettings;
  imageCount: number;
}): string[] => {
  if (provider !== "comfyui") {
    return [`Provider: ${provider}`, `Model: ${model}`];
  }

  if (!comfyUiSettings) {
    return ["Provider: comfyui", "ComfyUI settings: not loaded"];
  }

  const validation = validateComfyUiWorkflow(comfyUiSettings.workflowJson, imageCount);
  return [
    "Provider: comfyui",
    `ComfyUI server: ${comfyUiSettings.serverUrl}`,
    `ComfyUI workflow image placeholders: ${validation.imagePlaceholderCount}`,
    `ComfyUI workflow status: ${validation.ok ? "ready" : validation.errors.join("; ")}`
  ];
};

export const buildAiRequestPreview = async ({
  folderPath,
  project,
  shotId,
  shotIds,
  selectedShotContext,
  selectedResourceIds = [],
  resourceAssignments = {},
  generationSettings,
  comfyUiSettings
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
  const provider = generationSettings?.provider ?? "openai";
  const model = provider === "comfyui" ? "(ComfyUI workflow)" : generationSettings?.model?.trim() || "(provider default)";
  const batchShotIds = shotIds ?? [];

  if (batchShotIds.length > 1) {
    const groups = groupAiBatchShotIds(project, batchShotIds);
    const groupPreviews = groups.map((group) => {
      const groupResourceIds = new Set(
        aiBatchResourceIdsForGroup({
          shotIds: group.shotIds,
          selectedResourceIds,
          resourceAssignments
        })
      );
      const groupReferences = selectedReferences.filter((reference) => groupResourceIds.has(reference.id));
      const prompt = [
        `Group ${group.index + 1} (${group.shotIds.length} panel${group.shotIds.length === 1 ? "" : "s"}):`,
        assembleAiBatchImagePrompt({
          project,
          shotIds: group.shotIds,
          references: groupReferences,
          resourceAssignments
        })
      ].join("\n");
      const imageInputs = [
        imageInputLine(1, "selected-storyboards-contact-sheet.png"),
        ...groupReferences.map((reference, index) =>
          imageInputLine(index + 2, reference.fileName, reference.role, reference.note)
        )
      ];
      return { prompt, imageInputs };
    });
    const maxImageCount = Math.max(1, ...groupPreviews.map((preview) => preview.imageInputs.length));
    return [
      "AI request preview",
      "",
      ...providerPreviewLines({ provider, model, comfyUiSettings, imageCount: maxImageCount }),
      `Batch: ${summarizeAiBatchGroups(batchShotIds.length, groups)}`,
      "",
      "Prompt:",
      groupPreviews.map((preview) => preview.prompt).join("\n\n---\n\n"),
      "",
      "Image inputs per generation:",
      ...groupPreviews.flatMap((preview, index) => [
        `Group ${index + 1}:`,
        ...preview.imageInputs
      ])
    ].join("\n");
  }

  if (!shotId) {
    throw new Error("Shot not found for AI request preview");
  }

  const prompt = assembleAiImagePrompt({
    project,
    shotId,
    selectedShotContext,
    references: selectedReferences
  });
  const imageInputs = [
    imageInputLine(1, "selected-storyboard.png"),
    ...selectedReferences.map((reference, index) =>
      imageInputLine(index + 2, reference.fileName, reference.role, reference.note)
    )
  ];

  return [
    "AI request preview",
    "",
    ...providerPreviewLines({ provider, model, comfyUiSettings, imageCount: imageInputs.length }),
    "",
    "Prompt:",
    prompt,
    "",
    "Image inputs:",
    ...imageInputs
  ].join("\n");
};
