import { dialoguesForShot } from "../shared/projectOps";
import type { Dialogue, Project } from "../shared/types";

const currentTimestamp = () => new Date().toISOString();

const editableDialogueLines = (dialogueText: string): string[] =>
  dialogueText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const shotDialogueText = (project: Project, shotId: string): string =>
  dialoguesForShot(project, shotId).map((dialogue) => dialogue.text).join("\n");

export const nextEditableDialogueTextProject = (
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
