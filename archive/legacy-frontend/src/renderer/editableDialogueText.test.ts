import { describe, expect, it } from "vitest";
import type { Project } from "../shared/types";
import {
  nextEditableDialogueTextProject,
  shotDialogueText
} from "./editableDialogueText";

const project = {
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
  dialogues: [
    { id: "dialogue-b", shotId: "shot-a", text: "Second line", order: 1 },
    { id: "dialogue-a", shotId: "shot-a", text: "First line", order: 0 }
  ]
} satisfies Project;

describe("editableDialogueText", () => {
  it("joins shot dialogue in order for textarea editing", () => {
    expect(shotDialogueText(project, "shot-a")).toBe("First line\nSecond line");
  });

  it("updates dialogue rows from non-empty textarea lines", () => {
    const updated = nextEditableDialogueTextProject(
      project,
      "shot-a",
      "One\n\nTwo",
      () => "dialogue-new",
      "2026-06-01T01:00:00.000Z"
    );

    expect(updated.dialogues).toEqual([
      { id: "dialogue-a", shotId: "shot-a", text: "One", order: 0 },
      { id: "dialogue-b", shotId: "shot-a", text: "Two", order: 1 }
    ]);
    expect(updated.updatedAt).toBe("2026-06-01T01:00:00.000Z");
  });

  it("does not add sound or duration fields while editing dialogue", () => {
    const updated = nextEditableDialogueTextProject(
      project,
      "shot-a",
      "One",
      () => "dialogue-new",
      "2026-06-01T01:00:00.000Z"
    );

    expect(Object.keys(updated.shots[0])).not.toContain("soundText");
    expect(Object.keys(updated.shots[0])).not.toContain("durationText");
  });
});
