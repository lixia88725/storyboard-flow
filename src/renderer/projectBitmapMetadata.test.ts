import { describe, expect, it } from "vitest";
import { imageBitmapLayerId } from "../shared/projectOps";
import type { Project, Shot } from "../shared/types";
import { ensureProjectBitmapMetadata } from "./projectBitmapMetadata";

const shot = (id: string): Shot => ({
  id,
  imagePath: `/project/${id}.tiff`,
  fileName: `${id}.tiff`,
  order: 0,
  swb: {
    version: 1,
    status: "owned",
    canvasWidth: 100,
    canvasHeight: 80
  }
});

const project = (overrides: Partial<Project>): Project => ({
  id: "project",
  name: "Project",
  shots: [],
  dialogues: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

describe("ensureProjectBitmapMetadata", () => {
  it("ensures bitmap metadata for storyboard and parked shots", () => {
    const result = ensureProjectBitmapMetadata(
      project({
        shots: [shot("shot-a")],
        parkedShots: [shot("shot-b")]
      })
    );

    expect(result.shots[0].activeLayerId).toBe(imageBitmapLayerId);
    expect(result.shots[0].layers?.[0]).toMatchObject({
      id: imageBitmapLayerId,
      width: 100,
      height: 80
    });
    expect(result.parkedShots?.[0].activeLayerId).toBe(imageBitmapLayerId);
    expect(result.parkedShots?.[0].layers?.[0]).toMatchObject({
      id: imageBitmapLayerId,
      width: 100,
      height: 80
    });
  });
});
