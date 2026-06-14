import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import {
  aiBatchResourceIdsForGroup,
  aiBatchPanelLayout,
  assembleAiBatchImagePrompt,
  groupAiBatchShotIds,
  summarizeAiBatchGroups
} from "./batch";

const makeProject = (count: number): Project => ({
  id: "project-1",
  name: "Scene",
  ai: { projectContext: "Keep the whole sequence in black and white." },
  shots: Array.from({ length: count }, (_item, index) => ({
    id: `shot-${index + 1}`,
    imagePath: `/scene/shot-${index + 1}.tiff`,
    fileName: `shot-${index + 1}.tiff`,
    order: index,
    scriptText: `Script for shot ${index + 1}.`
  })),
  dialogues: [
    { id: "dialogue-1", shotId: "shot-1", text: "Stay quiet.", order: 0 },
    { id: "dialogue-2", shotId: "shot-3", text: "Move.", order: 0 }
  ],
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z"
});

describe("AI batch generation planning", () => {
  it("groups selected shots into 4-up batches in storyboard order", () => {
    const project = makeProject(19);
    const groups = groupAiBatchShotIds(project, [
      "shot-8",
      "shot-1",
      "shot-19",
      "shot-2",
      "shot-3",
      "shot-4",
      "shot-5",
      "shot-6",
      "shot-7",
      "shot-9",
      "shot-10",
      "shot-11",
      "shot-12",
      "shot-13",
      "shot-14",
      "shot-15",
      "shot-16",
      "shot-17",
      "shot-18"
    ]);

    expect(groups.map((group) => group.shotIds.length)).toEqual([4, 4, 4, 4, 3]);
    expect(groups[0].shotIds).toEqual(["shot-1", "shot-2", "shot-3", "shot-4"]);
    expect(summarizeAiBatchGroups(19, groups)).toBe("19 shots -> 5 generations: 4, 4, 4, 4, 3");
  });

  it("returns fixed crop templates for 1, 2, 3, and 4 panels", () => {
    expect(aiBatchPanelLayout(1).rects).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
    expect(aiBatchPanelLayout(2).rects).toEqual([
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 }
    ]);
    expect(aiBatchPanelLayout(3).rects).toHaveLength(3);
    expect(aiBatchPanelLayout(4).rects).toEqual([
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
    ]);
    expect(() => aiBatchPanelLayout(5)).toThrow("Unsupported AI batch panel count");
  });

  it("uses the union of resources available to shots in a batch group", () => {
    expect(
      aiBatchResourceIdsForGroup({
        shotIds: ["shot-1", "shot-2", "shot-3"],
        selectedResourceIds: ["hero.png", "room.png", "prop.png"],
        resourceAssignments: {
          "shot-1": ["hero.png"],
          "shot-2": [],
          "shot-3": ["room.png", "unused.png"]
        }
      })
    ).toEqual(["hero.png", "room.png"]);
  });

  it("assembles batch prompts with explicit per-panel resource availability rules", () => {
    const project = makeProject(4);
    const prompt = assembleAiBatchImagePrompt({
      project,
      shotIds: ["shot-1", "shot-2", "shot-3", "shot-4"],
      references: [
        {
          id: "hero.png",
          fileName: "hero.png",
          role: "Character reference",
          note: "Use for character A."
        },
        {
          id: "room.png",
          fileName: "room.png",
          role: "Scene reference",
          note: "Use for the kitchen."
        }
      ],
      resourceAssignments: {
        "shot-1": ["hero.png", "room.png"],
        "shot-2": [],
        "shot-3": ["hero.png"],
        "shot-4": ["unused.png"]
      }
    });

    expect(prompt).toContain("Generate a storyboard contact sheet with exactly 4 panels.");
    expect(prompt).toContain("four equal panels in a 2x2 grid");
    expect(prompt).toContain("Project additional context:\nKeep the whole sequence in black and white.");
    expect(prompt).toContain("Reference 1: Character reference, hero.png. Use for character A.");
    expect(prompt).toContain("Panel 1: shot-1.tiff");
    expect(prompt).toContain("Stay quiet.");
    expect(prompt).toContain(
      "Panel 1 may use these AI Resources: Character reference hero.png, Scene reference room.png."
    );
    expect(prompt).toContain("Panel 2 must not use any AI Resources.");
    expect(prompt).toContain("Panel 3 may use these AI Resources: Character reference hero.png.");
    expect(prompt).not.toContain("Auto from batch pool");
    expect(prompt).toContain("Do not render dialogue text");
    expect(prompt).not.toContain("unused.png");
    expect(prompt).not.toContain("API key");
    expect(prompt).not.toContain("/scene/");
  });
});
