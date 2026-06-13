import { describe, expect, it } from "vitest";
import type { Project } from "../../shared/types";
import {
  aiPanelSelectionState,
  canCopyAiRequestPreview,
  nextAiEditableDialogueProject,
  nextAiEditableScriptProject,
  visibleAiStatusMessage
} from "./aiPanelState";

const project = {
  id: "project-1",
  name: "Scene",
  shots: [
    {
      id: "shot-1",
      imagePath: "/scene/shot-1.tiff",
      fileName: "shot-1.tiff",
      order: 0,
      scriptText: "A pilot checks the warning light."
    },
    {
      id: "shot-2",
      imagePath: "/scene/shot-2.tiff",
      fileName: "shot-2.tiff",
      order: 1
    }
  ],
  dialogues: [{ id: "dialogue-1", shotId: "shot-1", text: "What was that?", order: 0 }],
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
} satisfies Project;

describe("AI panel state", () => {
  it("requires exactly one selected storyboard", () => {
    expect(aiPanelSelectionState(project, [])).toMatchObject({ kind: "empty" });
    expect(aiPanelSelectionState(project, ["shot-1", "shot-2"])).toMatchObject({ kind: "multi" });
  });

  it("summarizes selected shot script and dialogue", () => {
    expect(aiPanelSelectionState(project, ["shot-1"])).toEqual({
      kind: "ready",
      shot: project.shots[0],
      scriptText: "A pilot checks the warning light.",
      dialogueText: "What was that?"
    });
  });

  it("updates selected shot script text through the AI panel", () => {
    const updated = nextAiEditableScriptProject(
      project,
      "shot-1",
      "The pilot studies the warning light.",
      "2026-06-12T01:00:00.000Z"
    );

    expect(updated.shots[0].scriptText).toBe("The pilot studies the warning light.");
    expect(updated.shots[1].scriptText).toBeUndefined();
    expect(updated.updatedAt).toBe("2026-06-12T01:00:00.000Z");
  });

  it("updates selected shot dialogue text through the AI panel", () => {
    const updated = nextAiEditableDialogueProject(
      project,
      "shot-1",
      "Keep moving.\nWe are almost there.",
      () => "dialogue-2",
      "2026-06-12T01:00:00.000Z"
    );

    expect(updated.dialogues).toEqual([
      { id: "dialogue-1", shotId: "shot-1", text: "Keep moving.", order: 0 },
      { id: "dialogue-2", shotId: "shot-1", text: "We are almost there.", order: 1 }
    ]);
    expect(updated.updatedAt).toBe("2026-06-12T01:00:00.000Z");
  });

  it("hides the idle AI panel status message", () => {
    expect(visibleAiStatusMessage("Ready")).toBe("");
    expect(visibleAiStatusMessage("")).toBe("");
    expect(visibleAiStatusMessage("AI candidate ready")).toBe("AI candidate ready");
  });

  it("enables request preview copying only for a ready single-shot selection", () => {
    expect(canCopyAiRequestPreview({ kind: "empty" })).toBe(false);
    expect(canCopyAiRequestPreview({ kind: "multi", count: 2 })).toBe(false);
    expect(canCopyAiRequestPreview({ kind: "missing" })).toBe(false);
    expect(
      canCopyAiRequestPreview({
        kind: "ready",
        shot: project.shots[0],
        scriptText: "A pilot checks the warning light.",
        dialogueText: "What was that?"
      })
    ).toBe(true);
  });
});
