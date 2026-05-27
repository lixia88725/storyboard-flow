import {
  moveDialogueToShot as moveDialogueToShotInProject,
  sortedShots
} from "../shared/projectOps";
import type { Dialogue, Project, Shot } from "../shared/types";

const timestamp = () => new Date().toISOString();

export const createEmptyProject = (name: string): Project => {
  const now = timestamp();

  return {
    id: crypto.randomUUID(),
    name,
    shots: [],
    dialogues: [],
    createdAt: now,
    updatedAt: now
  };
};

export const createShot = (imagePath: string, previewPath?: string): Shot => {
  return {
    id: crypto.randomUUID(),
    imagePath,
    previewPath,
    fileName: imagePath.split(/[\\/]/).at(-1) ?? imagePath,
    order: 0,
    sketchData: []
  };
};

export const reorderShots = (project: Project, activeShotId: string, overShotId: string): Project => {
  if (activeShotId === overShotId) {
    return project;
  }

  const ordered = sortedShots(project.shots);
  const fromIndex = ordered.findIndex((shot) => shot.id === activeShotId);
  const toIndex = ordered.findIndex((shot) => shot.id === overShotId);

  if (fromIndex === -1 || toIndex === -1) {
    return project;
  }

  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);

  return {
    ...project,
    shots: ordered.map((shot, order) => ({ ...shot, order })),
    updatedAt: timestamp()
  };
};

export const moveDialogueToShot = (
  project: Project,
  dialogueId: string,
  targetShotId: string
): Project => {
  return moveDialogueToShotInProject(project, dialogueId, targetShotId);
};

export const normalizeProject = (project: Project): Project => {
  const shots = sortedShots(project.shots).map((shot, order) => ({ ...shot, order }));
  const shotOrder = new Map(shots.map((shot, index) => [shot.id, index]));
  const dialogues = [...project.dialogues]
    .sort((a, b) => {
      const shotDelta = (shotOrder.get(a.shotId) ?? 0) - (shotOrder.get(b.shotId) ?? 0);
      return shotDelta === 0 ? a.order - b.order : shotDelta;
    })
    .map((dialogue, index, allDialogues): Dialogue => {
      const priorInShot = allDialogues
        .slice(0, index)
        .filter((item) => item.shotId === dialogue.shotId).length;
      return { ...dialogue, order: priorInShot };
    });

  return {
    ...project,
    shots,
    dialogues,
    updatedAt: timestamp()
  };
};
