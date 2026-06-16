import { describe, expect, it } from "vitest";
import type { Project } from "../shared/types";
import {
  addShotInsertedShotId,
  initialAddShotContext
} from "./addShotController";

const projectWithShots = (shotIds: string[]): Project =>
  ({
    shots: shotIds.map((id) => ({ id, imagePath: `${id}.tiff` }))
  }) as Project;

describe("addShotController", () => {
  it("uses the current workspace and selected shot when a folder is already loaded", () => {
    const project = projectWithShots(["shot-1", "shot-2"]);

    expect(
      initialAddShotContext({
        folderPath: "/scene",
        metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
        primarySelectedShotId: "shot-2",
        project
      })
    ).toEqual({
      kind: "ready",
      baseProject: project,
      insertAfterShotId: "shot-2",
      targetFolderPath: "/scene"
    });
  });

  it("requires a folder before adding the first shot", () => {
    const project = projectWithShots([]);

    expect(
      initialAddShotContext({
        folderPath: "",
        metadataPath: "",
        primarySelectedShotId: undefined,
        project
      })
    ).toEqual({
      kind: "needs-folder",
      status: "Choose a folder for the first shot"
    });
  });

  it("finds the inserted shot by generated image path", () => {
    const project = {
      shots: [
        { id: "old-shot", imagePath: "/scene/old.tiff" },
        { id: "new-shot", imagePath: "/scene/new.tiff" }
      ]
    } as Project;

    expect(addShotInsertedShotId(project, "/scene/new.tiff")).toBe("new-shot");
    expect(addShotInsertedShotId(project, "/scene/missing.tiff")).toBeUndefined();
  });
});
