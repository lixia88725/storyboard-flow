import { dialoguesForShot } from "../../shared/projectOps";
import type { Dialogue, Project, Shot } from "../../shared/types";

export type AiPanelSelectionState =
  | { kind: "empty" }
  | { kind: "multi"; count: number; shots: Shot[] }
  | { kind: "missing" }
  | {
      kind: "ready";
      shot: Shot;
      scriptText: string;
      dialogueText: string;
    };

const currentTimestamp = () => new Date().toISOString();

const uniqueInOrder = (items: string[]): string[] => [...new Set(items)];

const normalizeShotResourceExclusions = (
  project: Project,
  knownResourceIds: string[]
): Record<string, string[]> | undefined => {
  const knownShotIds = new Set(project.shots.map((shot) => shot.id));
  const knownResources = new Set(knownResourceIds);
  const entries = Object.entries(project.ai?.shotResourceExclusions ?? {})
    .filter(([shotId]) => knownShotIds.has(shotId))
    .map(([shotId, resourceIds]) => [
      shotId,
      uniqueInOrder((resourceIds ?? []).filter((resourceId) => knownResources.has(resourceId)))
    ] as const)
    .filter(([, resourceIds]) => resourceIds.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const exclusionsEqual = (
  left: Record<string, string[]> | undefined,
  right: Record<string, string[]> | undefined
): boolean => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

const editableDialogueLines = (dialogueText: string): string[] =>
  dialogueText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const visibleAiStatusMessage = (status: string): string => (status === "Ready" ? "" : status);

export const canCopyAiRequestPreview = (selection: AiPanelSelectionState): boolean =>
  selection.kind === "ready" || (selection.kind === "multi" && selection.shots.length > 0);

export const canCleanAiResourceExclusions = ({
  isOpen,
  hasLoadedResources
}: {
  isOpen: boolean;
  hasLoadedResources: boolean;
}): boolean => isOpen && hasLoadedResources;

export const aiResourceIdsAvailableForShot = (
  project: Project,
  shotId: string,
  resourceIds: string[]
): string[] => {
  const excluded = new Set(project.ai?.shotResourceExclusions?.[shotId] ?? []);
  return resourceIds.filter((resourceId) => !excluded.has(resourceId));
};

export const nextAiResourceAvailabilityProject = (
  project: Project,
  shotId: string,
  resourceId: string,
  isAvailable: boolean,
  updatedAt = currentTimestamp()
): Project => {
  const currentExclusions = project.ai?.shotResourceExclusions ?? {};
  const currentShotExclusions = currentExclusions[shotId] ?? [];
  const nextShotExclusions = isAvailable
    ? currentShotExclusions.filter((id) => id !== resourceId)
    : uniqueInOrder([...currentShotExclusions, resourceId]);
  const nextExclusions = { ...currentExclusions };
  if (nextShotExclusions.length > 0) {
    nextExclusions[shotId] = nextShotExclusions;
  } else {
    delete nextExclusions[shotId];
  }
  return {
    ...project,
    ai: {
      ...project.ai,
      shotResourceExclusions: Object.keys(nextExclusions).length > 0 ? nextExclusions : undefined
    },
    updatedAt
  };
};

export const cleanAiResourceExclusionsProject = (
  project: Project,
  knownResourceIds: string[],
  updatedAt = currentTimestamp()
): Project => {
  const shotResourceExclusions = normalizeShotResourceExclusions(project, knownResourceIds);
  if (exclusionsEqual(project.ai?.shotResourceExclusions, shotResourceExclusions)) {
    return project;
  }
  return {
    ...project,
    ai: {
      ...project.ai,
      shotResourceExclusions
    },
    updatedAt
  };
};

export const aiShotNumberLabel = (project: Project, shotId: string): string => {
  const index = project.shots.findIndex((shot) => shot.id === shotId);
  return index >= 0 ? String(index + 1).padStart(3, "0") : "???";
};

export const nextAiEditableScriptProject = (
  project: Project,
  shotId: string,
  scriptText: string,
  updatedAt = currentTimestamp()
): Project => {
  let foundShot = false;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotId) {
      return shot;
    }
    foundShot = true;
    return { ...shot, scriptText };
  });

  if (!foundShot) {
    return project;
  }

  return {
    ...project,
    shots,
    updatedAt
  };
};

export const nextAiEditableDialogueProject = (
  project: Project,
  shotId: string,
  dialogueText: string,
  createDialogueId: () => string = () => crypto.randomUUID(),
  updatedAt = currentTimestamp()
): Project => {
  const existingDialogues = dialoguesForShot(project, shotId);
  const nextDialoguesForShot: Dialogue[] = editableDialogueLines(dialogueText).map((text, order) => {
    const existing = existingDialogues[order];
    return existing
      ? { ...existing, text, order }
      : {
          id: createDialogueId(),
          shotId,
          text,
          order
        };
  });

  return {
    ...project,
    dialogues: [
      ...project.dialogues.filter((dialogue) => dialogue.shotId !== shotId),
      ...nextDialoguesForShot
    ],
    updatedAt
  };
};

export const aiPanelSelectionState = (
  project: Project,
  selectedShotIds: string[]
): AiPanelSelectionState => {
  if (selectedShotIds.length === 0) {
    return { kind: "empty" };
  }
  if (selectedShotIds.length > 1) {
    const selected = new Set(selectedShotIds);
    return {
      kind: "multi",
      count: selectedShotIds.length,
      shots: project.shots.filter((shot) => selected.has(shot.id)).sort((a, b) => a.order - b.order)
    };
  }
  const shot = project.shots.find((item) => item.id === selectedShotIds[0]);
  if (!shot) {
    return { kind: "missing" };
  }
  return {
    kind: "ready",
    shot,
    scriptText: shot.scriptText ?? "",
    dialogueText: dialoguesForShot(project, shot.id).map((dialogue) => dialogue.text).join("\n")
  };
};
