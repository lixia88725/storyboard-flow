import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isVisiblePendingPath,
  moveShotsToVisiblePending,
  restoreShotsFromVisiblePending,
  visiblePendingFolderPath
} from "./pendingShotFilesService.js";

const project = {
  shots: [
    { id: "shot-a", imagePath: "/scene/shot-a.tiff", fileName: "shot-a.tiff" }
  ],
  parkedShots: [
    { id: "shot-b", imagePath: "/scene/shot-b.tiff", fileName: "shot-b.tiff" }
  ]
};

describe("pendingShotFilesService", () => {
  it("materializes and moves active or historical parked shots into the visible Pending folder", async () => {
    const materialized = { commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined) };
    const moved = { rollback: vi.fn(async () => undefined) };
    const materializeShots = vi.fn(async () => materialized);
    const moveFiles = vi.fn(async () => moved);

    const result = await moveShotsToVisiblePending(
      "/scene",
      project,
      ["shot-a", "shot-b"],
      {
        fingerprint: async (filePath) => `fingerprint:${path.basename(filePath)}`,
        materializeShots,
        moveFiles,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      }
    );

    expect(materializeShots).toHaveBeenCalledWith(project, new Set(["shot-a", "shot-b"]));
    expect(moveFiles).toHaveBeenCalledWith([
      { fromPath: "/scene/shot-a.tiff", toPath: "/scene/Pending/shot-a.tiff" },
      { fromPath: "/scene/shot-b.tiff", toPath: "/scene/Pending/shot-b.tiff" }
    ]);
    expect(result).toEqual([
      {
        shotId: "shot-a",
        imagePath: "/scene/Pending/shot-a.tiff",
        fileName: "shot-a.tiff",
        baseFingerprint: "fingerprint:shot-a.tiff"
      },
      {
        shotId: "shot-b",
        imagePath: "/scene/Pending/shot-b.tiff",
        fileName: "shot-b.tiff",
        baseFingerprint: "fingerprint:shot-b.tiff"
      }
    ]);
    expect(materialized.commit).toHaveBeenCalledOnce();
    expect(materialized.rollback).not.toHaveBeenCalled();
  });

  it("rolls moved files and materialized TIFFs back when final verification fails", async () => {
    const materialized = { commit: vi.fn(), rollback: vi.fn(async () => undefined) };
    const moved = { rollback: vi.fn(async () => undefined) };

    await expect(
      moveShotsToVisiblePending("/scene", project, ["shot-a"], {
        fingerprint: async () => {
          throw new Error("fingerprint failed");
        },
        materializeShots: async () => materialized,
        moveFiles: async () => moved,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      })
    ).rejects.toThrow("fingerprint failed");

    expect(moved.rollback).toHaveBeenCalledOnce();
    expect(materialized.rollback).toHaveBeenCalledOnce();
    expect(materialized.commit).not.toHaveBeenCalled();
  });

  it("keeps the move reversible until the project metadata has persisted", async () => {
    const materialized = { commit: vi.fn(), rollback: vi.fn(async () => undefined) };
    const moved = { rollback: vi.fn(async () => undefined) };
    const transaction = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    };

    await expect(
      moveShotsToVisiblePending("/scene", project, ["shot-a"], {
        beginTransaction: async () => transaction,
        finalize: async () => {
          throw new Error("metadata write failed");
        },
        fingerprint: async () => "fingerprint",
        materializeShots: async () => materialized,
        moveFiles: async () => moved,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      })
    ).rejects.toThrow("metadata write failed");

    expect(moved.rollback).toHaveBeenCalledOnce();
    expect(materialized.rollback).toHaveBeenCalledOnce();
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it("restores only files that are currently inside the visible Pending folder", async () => {
    const pendingProject = {
      shots: [],
      parkedShots: [
        {
          id: "shot-a",
          imagePath: "/scene/Pending/shot-a.tiff",
          fileName: "shot-a.tiff"
        },
        { id: "shot-b", imagePath: "/scene/shot-b.tiff", fileName: "shot-b.tiff" }
      ]
    };
    const moveFiles = vi.fn(async () => ({ rollback: vi.fn(async () => undefined) }));

    const result = await restoreShotsFromVisiblePending(
      "/scene",
      pendingProject,
      ["shot-a", "shot-b"],
      {
        fingerprint: async () => "restored-fingerprint",
        moveFiles,
        uniquePath: async (directory, fileName) => path.join(directory, fileName)
      }
    );

    expect(moveFiles).toHaveBeenCalledWith([
      { fromPath: "/scene/Pending/shot-a.tiff", toPath: "/scene/shot-a.tiff" }
    ]);
    expect(result).toEqual([
      {
        shotId: "shot-a",
        imagePath: "/scene/shot-a.tiff",
        fileName: "shot-a.tiff",
        baseFingerprint: "restored-fingerprint"
      }
    ]);
  });

  it("recognizes only descendants of the project Pending folder", () => {
    expect(visiblePendingFolderPath("/scene")).toBe("/scene/Pending");
    expect(isVisiblePendingPath("/scene", "/scene/Pending/shot.tiff")).toBe(true);
    expect(isVisiblePendingPath("/scene", "/scene/Pending-other/shot.tiff")).toBe(false);
    expect(isVisiblePendingPath("/scene", "/scene/shot.tiff")).toBe(false);
  });
});
