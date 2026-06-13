import { dialoguesForShot } from "../projectOps";
import type { Project, Shot } from "../types";

export type AiReferenceRole =
  | "Reference image"
  | "Character reference"
  | "Scene reference"
  | "Style reference"
  | "Prop reference";

export type AiResourceMetadataItem = {
  fileName: string;
  role: AiReferenceRole;
  note: string;
};

export type AiResourceMetadata = {
  version: 1;
  resources: AiResourceMetadataItem[];
};

export type AiSelectedReference = AiResourceMetadataItem & {
  id: string;
};

export type AiPromptInput = {
  project: Project;
  shotId: string;
  selectedShotContext?: string;
  references?: AiSelectedReference[];
};

const aiReferenceRoles: AiReferenceRole[] = [
  "Reference image",
  "Character reference",
  "Scene reference",
  "Style reference",
  "Prop reference"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const safeResourceFileName = (value: unknown): string | undefined => {
  const fileName = cleanText(value);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    return undefined;
  }
  return fileName;
};

const normalizeRole = (value: unknown): AiReferenceRole =>
  typeof value === "string" && aiReferenceRoles.includes(value as AiReferenceRole)
    ? (value as AiReferenceRole)
    : "Reference image";

export const defaultAiResourceMetadata = (fileName: string): AiResourceMetadataItem => ({
  fileName,
  role: "Reference image",
  note: ""
});

export const normalizeAiResourceMetadata = (
  value: unknown,
  knownFileNames: string[]
): AiResourceMetadata => {
  const known = new Set(knownFileNames);
  const incoming = new Map<string, AiResourceMetadataItem>();
  const resources = isRecord(value) && Array.isArray(value.resources) ? value.resources : [];

  for (const item of resources) {
    if (!isRecord(item)) {
      continue;
    }
    const fileName = safeResourceFileName(item.fileName);
    if (!fileName || !known.has(fileName)) {
      continue;
    }
    incoming.set(fileName, {
      fileName,
      role: normalizeRole(item.role),
      note: cleanText(item.note)
    });
  }

  return {
    version: 1,
    resources: knownFileNames.map((fileName) => incoming.get(fileName) ?? defaultAiResourceMetadata(fileName))
  };
};

export const aiResourceMetadataForFile = (
  metadata: AiResourceMetadata,
  fileName: string
): AiResourceMetadataItem =>
  metadata.resources.find((item) => item.fileName === fileName) ?? defaultAiResourceMetadata(fileName);

export const shotForAiPrompt = (project: Project, shotId: string): Shot => {
  const shot = [...project.shots, ...(project.parkedShots ?? [])].find((item) => item.id === shotId);
  if (!shot) {
    throw new Error(`Shot not found: ${shotId}`);
  }
  return shot;
};

export const assembleAiImagePrompt = ({
  project,
  shotId,
  selectedShotContext,
  references = []
}: AiPromptInput): string => {
  const shot = shotForAiPrompt(project, shotId);
  const shotDialogues = dialoguesForShot(project, shot.id);
  const sections: string[] = [
    "Generate one storyboard image for the selected storyboard panel.",
    "Use the selected storyboard image as composition and sketch reference.",
    "Do not render dialogue text, subtitles, captions, or speech bubbles into the image."
  ];

  const projectContext = project.ai?.projectContext?.trim();
  if (projectContext) {
    sections.push(`Project additional context:\n${projectContext}`);
  }

  const scriptText = shot.scriptText?.trim();
  if (scriptText) {
    sections.push(`Selected shot script:\n${scriptText}`);
  }

  if (shotDialogues.length > 0) {
    sections.push(`Dialogue for semantic reference only:\n${shotDialogues.map((dialogue) => `- ${dialogue.text}`).join("\n")}`);
  }

  const shotContext = selectedShotContext?.trim();
  if (shotContext) {
    sections.push(`Selected shot additional context:\n${shotContext}`);
  }

  if (references.length > 0) {
    sections.push(
      [
        "Selected reference images:",
        ...references.map((reference, index) => {
          const note = reference.note.trim();
          return `Reference ${index + 1}: ${reference.role}, ${reference.fileName}.${note ? ` ${note}` : ""}`;
        })
      ].join("\n")
    );
  }

  return sections.join("\n\n");
};
