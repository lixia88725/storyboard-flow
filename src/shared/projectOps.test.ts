import { describe, expect, it } from "vitest";
import {
  addDialogue,
  addGeneratedShot,
  clearSketch,
  createRenamePlan,
  getNextStoryboardIndex,
  validateRenamePlan,
  mergeFolderImages,
  moveDialogueToShot,
  removeDialogue,
  reorderShots,
  reorderShotGroup,
  updateSketch
} from "./projectOps";
import type { Project, SketchStroke } from "./types";

const makeProject = (): Project => ({
  id: "project-1",
  name: "Test Project",
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
  shots: [
    {
      id: "shot-a",
      imagePath: "/tmp/a.png",
      fileName: "a.png",
      order: 0,
      sketchData: []
    },
    {
      id: "shot-b",
      imagePath: "/tmp/b.png",
      fileName: "b.png",
      order: 1,
      sketchData: []
    },
    {
      id: "shot-c",
      imagePath: "/tmp/c.png",
      fileName: "c.png",
      order: 2,
      sketchData: []
    }
  ],
  dialogues: [
    {
      id: "dialogue-1",
      shotId: "shot-a",
      text: "First line",
      order: 0
    }
  ]
});

describe("project operations", () => {
  it("reorders shots and normalizes their order values", () => {
    const project = makeProject();

    const updated = reorderShots(project, "shot-c", "shot-a");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-c", 0],
      ["shot-a", 1],
      ["shot-b", 2]
    ]);
    expect(project.shots.map((shot) => shot.id)).toEqual(["shot-a", "shot-b", "shot-c"]);
  });

  it("moves selected shots as a group while preserving their internal order", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        ...makeProject().shots,
        {
          id: "shot-d",
          imagePath: "/tmp/d.png",
          fileName: "d.png",
          order: 3,
          sketchData: []
        }
      ]
    };

    const updated = reorderShotGroup(project, ["shot-b", "shot-c"], "shot-a");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-b", 0],
      ["shot-c", 1],
      ["shot-a", 2],
      ["shot-d", 3]
    ]);
  });

  it("moves selected shots after a later target when requested", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        ...makeProject().shots,
        {
          id: "shot-d",
          imagePath: "/tmp/d.png",
          fileName: "d.png",
          order: 3,
          sketchData: []
        }
      ]
    };

    const updated = reorderShotGroup(project, ["shot-a", "shot-b"], "shot-d", "after");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-c", 0],
      ["shot-d", 1],
      ["shot-a", 2],
      ["shot-b", 3]
    ]);
  });

  it("navigates storyboard grid horizontally and vertically by column count", () => {
    expect(getNextStoryboardIndex(1, 6, 3, "right")).toBe(2);
    expect(getNextStoryboardIndex(1, 6, 3, "left")).toBe(0);
    expect(getNextStoryboardIndex(1, 6, 3, "down")).toBe(4);
    expect(getNextStoryboardIndex(4, 6, 3, "up")).toBe(1);
  });

  it("clamps storyboard grid navigation at the edges", () => {
    expect(getNextStoryboardIndex(0, 6, 3, "left")).toBe(0);
    expect(getNextStoryboardIndex(2, 6, 3, "right")).toBe(2);
    expect(getNextStoryboardIndex(4, 6, 3, "down")).toBe(4);
    expect(getNextStoryboardIndex(1, 6, 3, "up")).toBe(1);
  });

  it("uses linear left and right navigation in animation mode", () => {
    expect(getNextStoryboardIndex(2, 6, 3, "right", true)).toBe(3);
    expect(getNextStoryboardIndex(2, 6, 3, "left", true)).toBe(1);
    expect(getNextStoryboardIndex(2, 6, 3, "down", true)).toBe(2);
    expect(getNextStoryboardIndex(2, 6, 3, "up", true)).toBe(2);
  });

  it("moves a dialogue to another shot and appends it after existing dialogue", () => {
    const project = addDialogue(makeProject(), "shot-b", "Existing on B", "dialogue-2");

    const updated = moveDialogueToShot(project, "dialogue-1", "shot-b");
    const moved = updated.dialogues.find((dialogue) => dialogue.id === "dialogue-1");

    expect(moved).toMatchObject({
      id: "dialogue-1",
      shotId: "shot-b",
      order: 1
    });
  });

  it("removes an empty dialogue and normalizes remaining dialogue order", () => {
    const project = addDialogue(
      addDialogue(makeProject(), "shot-a", "", "dialogue-2"),
      "shot-a",
      "Last line",
      "dialogue-3"
    );

    const updated = removeDialogue(project, "dialogue-2");

    expect(updated.dialogues.map((dialogue) => [dialogue.id, dialogue.order])).toEqual([
      ["dialogue-1", 0],
      ["dialogue-3", 1]
    ]);
  });

  it("updates sketch data for one shot without touching other shots", () => {
    const project = makeProject();
    const stroke: SketchStroke = {
      id: "stroke-1",
      tool: "brush",
      color: "#f15b2a",
      size: 5,
      points: [0, 0, 20, 20]
    };

    const updated = updateSketch(project, "shot-b", [stroke]);

    expect(updated.shots.find((shot) => shot.id === "shot-b")?.sketchData).toEqual([stroke]);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchData).toEqual([]);
  });

  it("clears sketch data for one shot", () => {
    const stroke: SketchStroke = {
      id: "stroke-1",
      tool: "brush",
      color: "#f15b2a",
      size: 5,
      points: [0, 0, 20, 20]
    };
    const project = updateSketch(makeProject(), "shot-a", [stroke]);

    const updated = clearSketch(project, "shot-a");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchData).toEqual([]);
  });

  it("merges a folder scan with saved metadata and preserves shot data", () => {
    const project = updateSketch(makeProject(), "shot-b", [
      {
        id: "stroke-1",
        tool: "brush",
        color: "#f15b2a",
        size: 5,
        points: [0, 0, 20, 20]
      }
    ]);

    const updated = mergeFolderImages(project, [
      { imagePath: "/tmp/b.png", fileName: "b.png" },
      { imagePath: "/tmp/d.png", fileName: "d.png" }
    ]);

    expect(updated.shots.map((shot) => [shot.imagePath, shot.order])).toEqual([
      ["/tmp/b.png", 0],
      ["/tmp/d.png", 1]
    ]);
    expect(updated.shots[0].sketchData).toHaveLength(1);
    expect(updated.dialogues).toEqual([]);
  });

  it("inserts a generated shot after the selected shot", () => {
    const project = makeProject();

    const updated = addGeneratedShot(
      project,
      {
        imagePath: "/tmp/new_shot.tiff",
        fileName: "new_shot.tiff"
      },
      "shot-a"
    );

    expect(updated.shots.map((shot) => [shot.fileName, shot.order])).toEqual([
      ["a.png", 0],
      ["new_shot.tiff", 1],
      ["b.png", 2],
      ["c.png", 3]
    ]);
  });

  it("plans stable ordered filenames without stacking numeric prefixes", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          id: "shot-a",
          imagePath: "/tmp/001_alpha.png",
          fileName: "001_alpha.png",
          order: 1,
          sketchData: []
        },
        {
          id: "shot-b",
          imagePath: "/tmp/beta.tiff",
          fileName: "beta.tiff",
          order: 0,
          sketchData: []
        }
      ],
      dialogues: []
    };

    const plan = createRenamePlan(project);

    expect(plan.map((item) => [item.shotId, item.finalPath, item.finalFileName])).toEqual([
      ["shot-b", "/tmp/001_beta.tiff", "001_beta.tiff"],
      ["shot-a", "/tmp/002_alpha.png", "002_alpha.png"]
    ]);
  });

  it("reports rename preflight conflicts for existing final and temporary paths", () => {
    const plan = createRenamePlan(makeProject());

    const result = validateRenamePlan(plan, new Set(["/tmp/001_a.png", "/tmp/.storyboard-renaming-shot-b.png"]));

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        path: "/tmp/001_a.png",
        reason: "final-exists",
        message: "Target file already exists: /tmp/001_a.png"
      },
      {
        path: "/tmp/.storyboard-renaming-shot-b.png",
        reason: "temporary-exists",
        message: "Temporary rename file already exists: /tmp/.storyboard-renaming-shot-b.png"
      }
    ]);
  });

  it("allows rename targets that are part of the same rename plan", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          id: "shot-a",
          imagePath: "/tmp/001_a.png",
          fileName: "001_a.png",
          sourceFileName: "a.png",
          order: 0,
          sketchData: []
        },
        {
          id: "shot-b",
          imagePath: "/tmp/002_b.png",
          fileName: "002_b.png",
          sourceFileName: "b.png",
          order: 1,
          sketchData: []
        }
      ],
      dialogues: []
    };
    const plan = createRenamePlan(project);

    const result = validateRenamePlan(plan, new Set(["/tmp/001_a.png", "/tmp/002_b.png"]));

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
