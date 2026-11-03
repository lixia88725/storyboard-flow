import { describe, expect, it } from "vitest";
import {
  applyStoryboardScriptImportPlan,
  parseStoryboardScriptMarkdown,
  planStoryboardScriptImport,
  serializeStoryboardScriptMarkdown,
  storyboardScriptNeedsImport,
  type StoryboardScriptProject
} from "./storyboardScript.js";

type TestProject = StoryboardScriptProject<{
  id: string;
  imagePath: string;
  fileName: string;
  order: number;
  scriptText?: string;
}>;

const projectWithScripts = (): TestProject => ({
  updatedAt: "2026-05-30T00:00:00.000Z",
  shots: [
    {
      id: "shot-a",
      imagePath: "/tmp/a.tiff",
      fileName: "a.tiff",
      order: 0,
      scriptText: "Opening shot"
    },
    {
      id: "shot-b",
      imagePath: "/tmp/b.tiff",
      fileName: "b.tiff",
      order: 1,
      scriptText: ""
    },
    {
      id: "shot-c",
      imagePath: "/tmp/c.tiff",
      fileName: "c.tiff",
      order: 2,
      scriptText: "Line one\nLine two"
    }
  ]
});

describe("storyboardScript", () => {
  it("serializes shot script text into a numbered markdown list", () => {
    const project = {
      ...projectWithScripts(),
      shots: [
        ...projectWithScripts().shots,
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `shot-extra-${index}`,
          imagePath: `/tmp/extra-${index}.tiff`,
          fileName: `extra-${index}.tiff`,
          order: index + 3,
          scriptText: ""
        })),
        {
          id: "shot-j",
          imagePath: "/tmp/j.tiff",
          fileName: "j.tiff",
          order: 10,
          scriptText: "Line ten\nContinuation"
        }
      ]
    };

    expect(serializeStoryboardScriptMarkdown(project)).toBe(
      "1. Opening shot\n2. \n3. Line one\n   Line two\n4. \n5. \n6. \n7. \n8. \n9. \n10. \n11. Line ten\n    Continuation\n"
    );
  });

  it("does not serialize parked shot script text into the root markdown mirror", () => {
    const project = {
      ...projectWithScripts(),
      parkedShots: [
        {
          id: "shot-parked",
          imagePath: "/tmp/parked.tiff",
          fileName: "parked.tiff",
          order: 0,
          scriptText: "Parked text"
        }
      ]
    };

    expect(serializeStoryboardScriptMarkdown(project)).toBe("1. Opening shot\n2. \n3. Line one\n   Line two\n");
  });

  it("parses numbered markdown entries with empty and indented continuation lines", () => {
    expect(
      parseStoryboardScriptMarkdown("1. First line  \n   second line\n\n2.\n\n10. Tenth\n    aligned\n")
    ).toEqual(["First line\nsecond line", "", "Tenth\naligned"]);
  });

  it("ignores non-numbered prose before and between storyboard script entries", () => {
    expect(
      parseStoryboardScriptMarkdown("# Beat sheet\n\nNotes before\n1. First shot\nrandom prose\n2. Second shot\n   continuation\n")
    ).toEqual(["First shot", "Second shot\ncontinuation"]);
  });

  it("detects when markdown entries differ from project script text", () => {
    const project = projectWithScripts();

    expect(storyboardScriptNeedsImport(project, serializeStoryboardScriptMarkdown(project))).toBe(false);
    expect(storyboardScriptNeedsImport(project, "1. Changed\n\n2.\n\n3. Line one\n   Line two\n")).toBe(true);
  });

  it("normalizes trailing script whitespace so import converges with markdown mirrors", () => {
    const project: TestProject = {
      ...projectWithScripts(),
      shots: [
        { ...projectWithScripts().shots[0], id: "shot-a", order: 0, scriptText: "Alpha\n" },
        { ...projectWithScripts().shots[1], id: "shot-b", order: 1, scriptText: "\n" }
      ]
    };

    expect(serializeStoryboardScriptMarkdown(project)).toBe("1. Alpha\n2. \n");
    expect(storyboardScriptNeedsImport(project, "1. Alpha\n2. \n")).toBe(false);
    expect(planStoryboardScriptImport(project, ["Alpha", ""])).toEqual([
      { type: "existing", shotId: "shot-a", scriptText: "Alpha" },
      { type: "existing", shotId: "shot-b", scriptText: "" }
    ]);
  });

  it("plans exact-match reorder, new blank shots, duplicate text matching, and preserved missing shots", () => {
    const project: TestProject = {
      ...projectWithScripts(),
      shots: [
        { ...projectWithScripts().shots[0], id: "shot-a", order: 0, scriptText: "Alpha" },
        { ...projectWithScripts().shots[1], id: "shot-b", order: 1, scriptText: "Repeat" },
        { ...projectWithScripts().shots[2], id: "shot-c", order: 2, scriptText: "Repeat" },
        {
          id: "shot-d",
          imagePath: "/tmp/d.tiff",
          fileName: "d.tiff",
          order: 3,
          scriptText: "Missing from markdown"
        }
      ]
    };

    expect(planStoryboardScriptImport(project, ["Repeat", "Brand new", "Alpha", "Repeat", "Extra"])).toEqual([
      { type: "existing", shotId: "shot-b", scriptText: "Repeat" },
      { type: "new", scriptText: "Brand new" },
      { type: "existing", shotId: "shot-a", scriptText: "Alpha" },
      { type: "existing", shotId: "shot-c", scriptText: "Repeat" },
      { type: "new", scriptText: "Extra" },
      { type: "existing", shotId: "shot-d", scriptText: "Missing from markdown" }
    ]);
  });

  it("plans same-length markdown imports as positional script text edits", () => {
    const project: TestProject = {
      ...projectWithScripts(),
      shots: [
        { ...projectWithScripts().shots[0], id: "shot-a", order: 0, scriptText: "Alpha" },
        { ...projectWithScripts().shots[1], id: "shot-b", order: 1, scriptText: "Beta" }
      ]
    };

    expect(planStoryboardScriptImport(project, ["Edited A", "Edited B"])).toEqual([
      { type: "existing", shotId: "shot-a", scriptText: "Edited A" },
      { type: "existing", shotId: "shot-b", scriptText: "Edited B" }
    ]);
  });

  it("applies a script import plan using provided blank shots for new markdown entries", () => {
    const project: TestProject = {
      ...projectWithScripts(),
      shots: [
        { ...projectWithScripts().shots[0], id: "shot-a", order: 0, scriptText: "Alpha" },
        { ...projectWithScripts().shots[1], id: "shot-b", order: 1, scriptText: "Beta" }
      ]
    };
    const plan = planStoryboardScriptImport(project, ["New text", "Alpha", "Beta"]);
    const updated = applyStoryboardScriptImportPlan(project, plan, [
      {
        id: "shot-new",
        imagePath: "/tmp/new.tiff",
        fileName: "new.tiff",
        order: 99
      }
    ]);

    expect(updated.shots.map((shot) => [shot.id, shot.order, shot.scriptText])).toEqual([
      ["shot-new", 0, "New text"],
      ["shot-a", 1, "Alpha"],
      ["shot-b", 2, "Beta"]
    ]);
  });
});
