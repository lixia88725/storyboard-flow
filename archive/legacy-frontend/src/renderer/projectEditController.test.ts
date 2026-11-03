import { describe, expect, it } from "vitest";
import type { Project } from "../shared/types";
import {
  nextProjectNameEdit,
  nextProjectNamingEdit,
  nextShotScriptTextEdit
} from "./projectEditController";

const baseProject = (): Project =>
  ({
    name: "Old Name",
    naming: {
      sceneCode: "sc001",
      artistName: "artist",
      version: "v001"
    },
    shots: [
      { id: "shot-1", scriptText: "old script" },
      { id: "shot-2", scriptText: "" }
    ],
    updatedAt: "before"
  }) as Project;

describe("projectEditController", () => {
  it("updates the project name and timestamp", () => {
    const project = baseProject();
    const nextProject = nextProjectNameEdit(project, "New Name", "now");

    expect(nextProject).toMatchObject({
      name: "New Name",
      updatedAt: "now"
    });
    expect(nextProject.naming).toEqual(project.naming);
  });

  it("updates one naming field while preserving defaults and existing fields", () => {
    expect(nextProjectNamingEdit(baseProject(), "artistName", "new-artist", "now").naming).toEqual({
      sceneCode: "sc001",
      artistName: "new-artist",
      version: "v001"
    });
  });

  it("updates only the requested shot script text", () => {
    const nextProject = nextShotScriptTextEdit(baseProject(), "shot-2", "new script", "now");

    expect(nextProject.shots.map((shot) => [shot.id, shot.scriptText])).toEqual([
      ["shot-1", "old script"],
      ["shot-2", "new script"]
    ]);
    expect(nextProject.updatedAt).toBe("now");
  });
});
