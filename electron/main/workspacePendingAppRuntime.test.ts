import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspacePendingAppHandlers } from "./workspacePendingAppRuntime.js";

const temporaryFolders: string[] = [];

const setup = async ({ persistFails = false } = {}) => {
  const folderPath = await mkdtemp(path.join(os.tmpdir(), "storyboard-pending-runtime-"));
  temporaryFolders.push(folderPath);
  const imagePath = path.join(folderPath, "shot.tiff");
  await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#ffffff" }
  }).tiff().toFile(imagePath);
  const project = {
    shots: [],
    parkedShots: [{ id: "shot-a", imagePath, fileName: "shot.tiff" }]
  };
  const transaction = {
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined)
  };
  const persistProject = vi.fn(async () => {
    if (persistFails) {
      throw new Error("metadata write failed");
    }
  });
  const handlers = createWorkspacePendingAppHandlers({
    beginTransaction: vi.fn(async () => transaction),
    materializeShots: vi.fn(async () => undefined),
    persistProject,
    uniquePath: async (directory, fileName) => path.join(directory, fileName)
  });
  return { folderPath, handlers, imagePath, persistProject, project, transaction };
};

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folderPath) => rm(folderPath, { recursive: true })));
});

describe("workspace Pending runtime", () => {
  it("persists the relocated path before committing the file transaction", async () => {
    const result = await setup();

    await result.handlers.moveShotsToPending(
      {
        folderPath: result.folderPath,
        metadataPath: path.join(result.folderPath, ".storyboard-workbench", "project.json"),
        project: result.project
      },
      ["shot-a"]
    );

    expect(result.persistProject).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        parkedShots: [
          expect.objectContaining({ imagePath: path.join(result.folderPath, "Pending", "shot.tiff") })
        ]
      })
    );
    expect(result.transaction.commit).toHaveBeenCalledOnce();
    await expect(access(path.join(result.folderPath, "Pending", "shot.tiff"))).resolves.toBeUndefined();
  });

  it("restores the original file when project metadata cannot be persisted", async () => {
    const result = await setup({ persistFails: true });

    await expect(
      result.handlers.moveShotsToPending(
        {
          folderPath: result.folderPath,
          metadataPath: path.join(result.folderPath, ".storyboard-workbench", "project.json"),
          project: result.project
        },
        ["shot-a"]
      )
    ).rejects.toThrow("metadata write failed");

    await expect(access(result.imagePath)).resolves.toBeUndefined();
    expect(result.transaction.rollback).toHaveBeenCalledOnce();
  });
});
