import { describe, expect, it } from "vitest";
import type { Project } from "../shared/types";
import { resolveDeleteTarget } from "./deleteTarget";

const makeProject = (): Project => ({
  id: "project",
  name: "Project",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  shots: [
    {
      id: "shot-a",
      imagePath: "/tmp/a.tif",
      fileName: "a.tif",
      order: 0,
      activeLayerId: "paint",
      layers: [
        {
          id: "image",
          kind: "image",
          name: "Image",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          order: 0,
          bitmapPath: ".storyboard-workbench/layers/shot-a/image.png",
          width: 100,
          height: 100
        },
        {
          id: "paint",
          kind: "paint",
          name: "Paint",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          order: 1,
          bitmapPath: ".storyboard-workbench/layers/shot-a/paint.png",
          width: 100,
          height: 100
        }
      ]
    }
  ],
  dialogues: []
});

describe("resolveDeleteTarget", () => {
  it("keeps a valid unlocked layer target", () => {
    expect(resolveDeleteTarget(makeProject(), { type: "layer", shotId: "shot-a", layerId: "paint" })).toEqual({
      type: "layer",
      shotId: "shot-a",
      layerId: "paint"
    });
  });

  it("reports locked layer targets without falling through to storyboard delete", () => {
    const project = makeProject();
    project.shots[0].layers![1] = { ...project.shots[0].layers![1], locked: true };

    expect(resolveDeleteTarget(project, { type: "layer", shotId: "shot-a", layerId: "paint" })).toEqual({
      type: "locked-layer",
      shotId: "shot-a",
      layerId: "paint"
    });
  });

  it("falls back to storyboard delete when the layer target is stale", () => {
    expect(resolveDeleteTarget(makeProject(), { type: "layer", shotId: "shot-a", layerId: "missing" })).toEqual({
      type: "shot"
    });
  });
});
