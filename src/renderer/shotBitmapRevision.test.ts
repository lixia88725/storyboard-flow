import { describe, expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import type { BitmapLayer, Project, Shot } from "../shared/types";
import {
  bumpShotBitmapRevisions,
  bumpWorkspaceShotBitmapRevisions,
  changedShotIdsForBitmapRevision,
  shotIdsForBitmapPaths
} from "./shotBitmapRevision";

const layer = (shotId: string): BitmapLayer => ({
  id: "layer-image",
  kind: "image",
  name: "Image",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-image.png`,
  width: 320,
  height: 180
});

const shot = (id: string, order: number): Shot => ({
  id,
  order,
  fileName: `${id}.tiff`,
  imagePath: `/scene/${id}.tiff`,
  layers: [layer(id)],
  activeLayerId: "layer-image"
});

const projectWithShots = (): Project => ({
  ...createProject("Performance fixture"),
  shots: [shot("shot-a", 0), shot("shot-b", 1)]
});

describe("shotBitmapRevision", () => {
  it("bumps only shots whose bitmap layer inputs changed", () => {
    const previous = projectWithShots();
    const next = {
      ...previous,
      shots: [
        { ...previous.shots[0], scriptText: "Metadata-only change" },
        {
          ...previous.shots[1],
          layers: previous.shots[1].layers?.map((item) => ({ ...item }))
        }
      ]
    };

    const changed = changedShotIdsForBitmapRevision(previous, next);
    expect(changed).toEqual(["shot-b"]);
    expect(bumpShotBitmapRevisions({ "shot-a": 4, "shot-b": 7 }, changed)).toEqual({
      "shot-a": 4,
      "shot-b": 8
    });
  });

  it("keeps the revision map identity when no shot needs refreshing", () => {
    const current = { "shot-a": 2 };
    expect(bumpShotBitmapRevisions(current, [])).toBe(current);
  });

  it("keeps workspace reload revisions monotonic instead of reusing cached URLs", () => {
    const project = projectWithShots();
    const afterFirstLoad = bumpWorkspaceShotBitmapRevisions({}, project);
    const afterPaint = bumpShotBitmapRevisions(afterFirstLoad, ["shot-a"]);
    const afterReload = bumpWorkspaceShotBitmapRevisions(afterPaint, project);

    expect(afterFirstLoad).toEqual({ "shot-a": 1, "shot-b": 1 });
    expect(afterPaint).toEqual({ "shot-a": 2, "shot-b": 1 });
    expect(afterReload).toEqual({ "shot-a": 3, "shot-b": 2 });
  });

  it("maps restored bitmap paths back to only their owning shots", () => {
    const project = projectWithShots();
    expect(
      shotIdsForBitmapPaths(project, [
        ".storyboard-workbench/layers/shot-b/layer-image.png"
      ])
    ).toEqual(["shot-b"]);
  });
});
