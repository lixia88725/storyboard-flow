import {
  addDialogue,
  removeDialogue,
  updateDialogueText
} from "../shared/projectOps";
import type { Dialogue, Project } from "../shared/types";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

export const useDialogueActionController = ({
  createDialogueId = () => crypto.randomUUID(),
  setEditingDialogueId,
  updateProject
}: {
  createDialogueId?: () => string;
  setEditingDialogueId: (dialogueId: string | undefined) => void;
  updateProject: (projectUpdate: ProjectUpdate) => void;
}) => {
  const handleCreateDialogue = (shotId: string) => {
    const dialogueId = createDialogueId();
    updateProject((currentProject) => addDialogue(currentProject, shotId, "", dialogueId));
    setEditingDialogueId(dialogueId);
  };

  const handleDialogueText = (dialogueId: string, text: string) => {
    updateProject((currentProject) => updateDialogueText(currentProject, dialogueId, text));
  };

  const handleDialogueBlur = (dialogue: Dialogue) => {
    if (!dialogue.text.trim()) {
      updateProject((currentProject) => removeDialogue(currentProject, dialogue.id));
    }
    setEditingDialogueId(undefined);
  };

  return {
    handleCreateDialogue,
    handleDialogueBlur,
    handleDialogueText
  };
};
