import { describe, expect, it } from "vitest";
import type { Dialogue, Project } from "../shared/types";
import { useDialogueActionController } from "./dialogueActionController";

const projectWithDialogues = (dialogues: Dialogue[] = []): Project =>
  ({
    id: "project",
    name: "Project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    shots: [
      {
        id: "shot-a",
        imagePath: "/tmp/a.tif",
        fileName: "a.tif",
        order: 0
      }
    ],
    dialogues
  }) as Project;

const setupController = (project: Project = projectWithDialogues()) => {
  let currentProject = project;
  const editingDialogueIds: Array<string | undefined> = [];

  const controller = useDialogueActionController({
    createDialogueId: () => "dialogue-new",
    setEditingDialogueId: (dialogueId) => editingDialogueIds.push(dialogueId),
    updateProject: (projectUpdate) => {
      currentProject =
        typeof projectUpdate === "function" ? projectUpdate(currentProject) : projectUpdate;
    }
  });

  return {
    controller,
    editingDialogueIds,
    project: () => currentProject
  };
};

describe("useDialogueActionController", () => {
  it("creates a blank dialogue and starts editing it", () => {
    const { controller, editingDialogueIds, project } = setupController();

    controller.handleCreateDialogue("shot-a");

    expect(project().dialogues).toMatchObject([
      {
        id: "dialogue-new",
        shotId: "shot-a",
        text: "",
        order: 0
      }
    ]);
    expect(editingDialogueIds).toEqual(["dialogue-new"]);
  });

  it("updates dialogue text by id", () => {
    const { controller, project } = setupController(
      projectWithDialogues([
        { id: "dialogue-a", shotId: "shot-a", text: "Old", order: 0 }
      ])
    );

    controller.handleDialogueText("dialogue-a", "New");

    expect(project().dialogues[0].text).toBe("New");
  });

  it("removes an empty dialogue on blur and exits editing", () => {
    const { controller, editingDialogueIds, project } = setupController(
      projectWithDialogues([
        { id: "dialogue-a", shotId: "shot-a", text: "   ", order: 0 }
      ])
    );

    controller.handleDialogueBlur({ id: "dialogue-a", shotId: "shot-a", text: "   ", order: 0 });

    expect(project().dialogues).toEqual([]);
    expect(editingDialogueIds).toEqual([undefined]);
  });

  it("keeps a non-empty dialogue on blur and exits editing", () => {
    const { controller, editingDialogueIds, project } = setupController(
      projectWithDialogues([
        { id: "dialogue-a", shotId: "shot-a", text: "Keep", order: 0 }
      ])
    );

    controller.handleDialogueBlur({ id: "dialogue-a", shotId: "shot-a", text: "Keep", order: 0 });

    expect(project().dialogues).toMatchObject([
      { id: "dialogue-a", shotId: "shot-a", text: "Keep", order: 0 }
    ]);
    expect(editingDialogueIds).toEqual([undefined]);
  });
});
