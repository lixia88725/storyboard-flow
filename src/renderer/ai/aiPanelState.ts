import { dialoguesForShot } from "../../shared/projectOps";
import type { Dialogue, Project, Shot } from "../../shared/types";

export type AiPanelSelectionState =
  | { kind: "empty" }
  | { kind: "multi"; count: number }
  | { kind: "missing" }
  | {
      kind: "ready";
      shot: Shot;
      scriptText: string;
      dialogueText: string;
    };

const currentTimestamp = () => new Date().toISOString();

const editableDialogueLines = (dialogueText: string): string[] =>
  dialogueText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const visibleAiStatusMessage = (status: string): string => (status === "Ready" ? "" : status);

export const canCopyAiRequestPreview = (selection: AiPanelSelectionState): boolean =>
  selection.kind === "ready";

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
    return { kind: "multi", count: selectedShotIds.length };
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
