import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createShot,
  moveDialogueToShot,
  normalizeProject,
  reorderShots,
} from "./storyboard";

describe("storyboard model", () => {
  it("reorders shots and rewrites contiguous order values", () => {
    const project = createEmptyProject("Board");
    const shotA = createShot("/tmp/a.png", "/tmp/a.png");
    const shotB = createShot("/tmp/b.png", "/tmp/b.png");
    const shotC = createShot("/tmp/c.png", "/tmp/c.png");

    const result = reorderShots(
      { ...project, shots: [shotA, shotB, shotC] },
      shotA.id,
      shotC.id,
    );

    expect(result.shots.map((shot) => shot.id)).toEqual([
      shotB.id,
      shotC.id,
      shotA.id,
    ]);
    expect(result.shots.map((shot) => shot.order)).toEqual([0, 1, 2]);
  });

  it("moves a dialogue to another shot and places it after existing dialogues", () => {
    const project = createEmptyProject("Board");
    const shotA = createShot("/tmp/a.png", "/tmp/a.png");
    const shotB = createShot("/tmp/b.png", "/tmp/b.png");
    const dialogueA = { id: "dialogue-a", shotId: shotA.id, text: "Line A", order: 0 };
    const dialogueB = { id: "dialogue-b", shotId: shotB.id, text: "Line B", order: 0 };

    const result = moveDialogueToShot(
      { ...project, shots: [shotA, shotB], dialogues: [dialogueA, dialogueB] },
      dialogueA.id,
      shotB.id,
    );

    expect(result.dialogues.find((dialogue) => dialogue.id === dialogueA.id)).toMatchObject({
      shotId: shotB.id,
      order: 1,
    });
  });

  it("normalizes loaded project shot and dialogue ordering", () => {
    const project = createEmptyProject("Board");
    const shotA = createShot("/tmp/a.png", "/tmp/a.png");
    const shotB = createShot("/tmp/b.png", "/tmp/b.png");

    const result = normalizeProject({
      ...project,
      shots: [
        { ...shotA, order: 10 },
        { ...shotB, order: 5 },
      ],
      dialogues: [
        { id: "dialogue-b", shotId: shotA.id, text: "B", order: 9 },
        { id: "dialogue-a", shotId: shotA.id, text: "A", order: 4 },
      ],
    });

    expect(result.shots.map((shot) => shot.id)).toEqual([shotB.id, shotA.id]);
    expect(result.shots.map((shot) => shot.order)).toEqual([0, 1]);
    expect(result.dialogues.map((dialogue) => dialogue.order)).toEqual([0, 1]);
  });
});
