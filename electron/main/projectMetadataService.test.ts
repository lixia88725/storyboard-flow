import { describe, expect, it, vi } from "vitest";
import { readProjectMetadata } from "./projectMetadataService.js";

describe("projectMetadataService", () => {
  it("returns undefined when project metadata does not exist", async () => {
    const readFile = vi.fn(async () => {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    await expect(readProjectMetadata("/project/.storyboard-workbench/storyboard.project.json", {
      readFile
    })).resolves.toBeUndefined();
  });

  it("parses project metadata JSON when the file exists", async () => {
    const project = {
      id: "project-1",
      name: "Scene A",
      shots: [],
      dialogues: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z"
    };
    const readFile = vi.fn(async () => JSON.stringify(project));

    await expect(readProjectMetadata("/project/.storyboard-workbench/storyboard.project.json", {
      readFile
    })).resolves.toEqual(project);
  });

  it("throws non-missing read errors", async () => {
    const readError = new Error("permission denied");
    const readFile = vi.fn(async () => {
      throw readError;
    });

    await expect(readProjectMetadata("/project/.storyboard-workbench/storyboard.project.json", {
      readFile
    })).rejects.toThrow(readError);
  });
});
