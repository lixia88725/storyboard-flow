import type { Project } from "./types.js";

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

const roles: AiReferenceRole[] = [
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

const safeFileName = (value: unknown): string | undefined => {
  const fileName = cleanText(value);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    return undefined;
  }
  return fileName;
};

const normalizeRole = (value: unknown): AiReferenceRole =>
  typeof value === "string" && roles.includes(value as AiReferenceRole)
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
    const fileName = safeFileName(item.fileName);
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

export const assembleAiImagePrompt = ({
  project,
  shotId,
  selectedShotContext,
  references
}: {
  project: Project;
  shotId: string;
  selectedShotContext?: string;
  references: AiSelectedReference[];
}): string => {
  const shot = [...project.shots, ...(project.parkedShots ?? [])].find((item) => item.id === shotId);
  if (!shot) {
    throw new Error(`Shot not found: ${shotId}`);
  }
  const dialogues = project.dialogues
    .filter((dialogue) => dialogue.shotId === shot.id)
    .sort((a, b) => a.order - b.order);
  const sections = [
    "Generate one storyboard image for the selected storyboard panel.",
    "Use the selected storyboard image as composition and sketch reference.",
    "Do not render dialogue text, subtitles, captions, or speech bubbles into the image."
  ];

  if (project.ai?.projectContext?.trim()) {
    sections.push(`Project additional context:\n${project.ai.projectContext.trim()}`);
  }
  if (shot.scriptText?.trim()) {
    sections.push(`Selected shot script:\n${shot.scriptText.trim()}`);
  }
  if (dialogues.length > 0) {
    sections.push(`Dialogue for semantic reference only:\n${dialogues.map((dialogue) => `- ${dialogue.text}`).join("\n")}`);
  }
  if (selectedShotContext?.trim()) {
    sections.push(`Selected shot additional context:\n${selectedShotContext.trim()}`);
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
