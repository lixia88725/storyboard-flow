import { describe, expect, it, vi } from "vitest";
import type { Project, Shot } from "../shared/types";
import {
  applyPendingShotFilePatches,
  createPendingShotFileController,
  shotFileIsInVisiblePending
} from "./pendingShotFileController";

const shot = {
  id: "shot-a",
  imagePath: "/scene/shot-a.tiff",
  fileName: "shot-a.tiff",
  order: 0,
  swb: {
    version: 1,
    status: "owned",
    canvasWidth: 1920,
    canvasHeight: 1080,
    baseFingerprint: "old"
  }
} as Shot;

const project = {
  id: "project",
  name: "Project",
  shots: [shot],
  dialogues: [],
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
} as Project;

describe("pendingShotFileController", () => {
  it("patches active and parked shot paths without changing the project schema", () => {
    const patched = applyPendingShotFilePatches(
      { ...project, shots: [], parkedShots: [shot] },
      [
        {
          shotId: shot.id,
          imagePath: "/scene/Pending/shot-a.tiff",
          fileName: "shot-a.tiff",
          baseFingerprint: "new"
        }
      ]
    );

    expect(patched.parkedShots?.[0]).toMatchObject({
      imagePath: "/scene/Pending/shot-a.tiff",
      fileName: "shot-a.tiff",
      swb: { baseFingerprint: "new" }
    });
  });

  it("uses the preload move and restore APIs", async () => {
    const moveShotsToPending = vi.fn(async () => [
      {
        shotId: shot.id,
        imagePath: "/scene/Pending/shot-a.tiff",
        fileName: "shot-a.tiff"
      }
    ]);
    const restoreShotsFromPending = vi.fn(async () => [
      {
        shotId: shot.id,
        imagePath: "/scene/shot-a.tiff",
        fileName: "shot-a.tiff"
      }
    ]);
    const controller = createPendingShotFileController({
      api: { moveShotsToPending, restoreShotsFromPending } as unknown as Window["storyboard"],
      folderPath: "/scene",
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json"
    });

    const moved = await controller.moveShotsToPending(project, [shot.id]);
    const restored = await controller.restoreShotsFromPending(moved, [shot.id]);

    expect(moveShotsToPending).toHaveBeenCalledOnce();
    expect(restoreShotsFromPending).toHaveBeenCalledOnce();
    expect(restored.shots[0].imagePath).toBe("/scene/shot-a.tiff");
  });

  it("recognizes visible Pending paths across path separator styles", () => {
    expect(shotFileIsInVisiblePending("/scene", "/scene/Pending/shot.tiff")).toBe(true);
    expect(shotFileIsInVisiblePending("C:\\scene", "C:\\scene\\Pending\\shot.tiff")).toBe(true);
    expect(shotFileIsInVisiblePending("/scene", "/scene/Archive/shot.tiff")).toBe(false);
    expect(shotFileIsInVisiblePending("/scene", "/scene/Pending/../shot.tiff")).toBe(false);
  });
});
