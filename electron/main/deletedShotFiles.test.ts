import { describe, expect, it, vi } from "vitest";
import {
  stagePendingDeletedShotFiles,
  trashPendingDeletedShotFiles,
  type ProjectWithPendingDeletedShots
} from "./deletedShotFiles.js";

const project = (): ProjectWithPendingDeletedShots => ({
  updatedAt: "2026-06-06T00:00:00.000Z",
  pendingDeletedShots: [
    { id: "shot-a", imagePath: "/scene/a.tiff", fileName: "a.tiff" },
    { id: "shot-b", imagePath: "/scene/b.tiff", fileName: "b.tiff" }
  ]
});

describe("stagePendingDeletedShotFiles", () => {
  it("moves existing pending deleted files to the internal delete temp folder", async () => {
    const moveFiles = vi.fn(async () => ({ rollback: vi.fn() }));
    const result = await stagePendingDeletedShotFiles(project(), "/scene", {
      now: () => new Date("2026-06-06T01:02:03.000Z"),
      pathExists: async (filePath) => filePath === "/scene/a.tiff",
      moveFiles
    });

    expect(moveFiles).toHaveBeenCalledWith(
      [
        {
          fromPath: "/scene/a.tiff",
          toPath: "/scene/.storyboard-workbench/delete-tmp/20260606T010203/shot-a.tiff"
        }
      ],
      expect.objectContaining({
        mkdir: expect.any(Function),
        rename: expect.any(Function)
      })
    );
    expect(result.project.pendingDeletedShots).toEqual([
      {
        id: "shot-a",
        imagePath: "/scene/.storyboard-workbench/delete-tmp/20260606T010203/shot-a.tiff",
        fileName: "a.tiff"
      },
      { id: "shot-b", imagePath: "/scene/b.tiff", fileName: "b.tiff" }
    ]);
  });
});

describe("trashPendingDeletedShotFiles", () => {
  it("reports only actual successful Trash, never missing-file disappearance", async () => {
    const trashItem = vi.fn(async () => undefined);
    const input = project();
    const result = await trashPendingDeletedShotFiles(input, { pathExists: async p => p === "/scene/a.tiff", trashItem });
    expect(result.trashed).toEqual([input.pendingDeletedShots![0]]);
    expect(trashItem).toHaveBeenCalledExactlyOnceWith("/scene/a.tiff");
  });
  it("clears pending deleted shots after Trash succeeds", async () => {
    const result = await trashPendingDeletedShotFiles(project(), {
      now: () => new Date("2026-06-06T02:00:00.000Z"),
      pathExists: async () => true,
      trashItem: vi.fn(async () => undefined)
    });

    expect(result.project.pendingDeletedShots).toBeUndefined();
    expect(result.project.updatedAt).toBe("2026-06-06T02:00:00.000Z");
    expect(result.error).toBeUndefined();
  });

  it("keeps failed Trash items pending and reports their file names", async () => {
    const result = await trashPendingDeletedShotFiles(project(), {
      now: () => new Date("2026-06-06T02:00:00.000Z"),
      pathExists: async () => true,
      trashItem: vi.fn(async (filePath) => {
        if (filePath === "/scene/b.tiff") {
          throw new Error("trash denied");
        }
      })
    });

    expect(result.project.pendingDeletedShots).toEqual([
      { id: "shot-b", imagePath: "/scene/b.tiff", fileName: "b.tiff" }
    ]);
    expect(result.error?.message).toBe("Could not move deleted storyboard files to Trash: b.tiff");
  });
});
