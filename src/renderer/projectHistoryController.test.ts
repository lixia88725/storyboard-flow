import { describe, expect, it } from "vitest";
import {
  historyAppliedStatus,
  historyDirtyShotIds,
  historyEntryAffectedBitmapPaths,
  historyUnavailableStatus,
  type ProjectHistoryEntry
} from "./projectHistoryController";
import { createProject } from "../shared/projectOps";
import type { BitmapLayer, Project, Shot } from "../shared/types";

const entry = (bitmapPaths: string[]): ProjectHistoryEntry => ({
  project: createProject(),
  selectedShotIds: ["shot-a"],
  fileNameSyncState: "unsynced",
  layerAssets: bitmapPaths.map((bitmapPath) => ({ bitmapPath }))
});

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
  ...createProject("History fixture"),
  shots: [shot("shot-a", 0), shot("shot-b", 1)]
});

describe("projectHistoryController", () => {
  it("lists affected bitmap paths from layer asset snapshots", () => {
    expect(historyEntryAffectedBitmapPaths(entry(["layers/a.png", "layers/b.png"]))).toEqual([
      "layers/a.png",
      "layers/b.png"
    ]);
    expect(
      historyEntryAffectedBitmapPaths({
        project: createProject(),
        selectedShotIds: [],
        fileNameSyncState: "synced"
      })
    ).toEqual([]);
  });

  it("keeps undo and redo status copy in the history controller", () => {
    expect(historyUnavailableStatus("undo")).toBe("Nothing to undo");
    expect(historyUnavailableStatus("redo")).toBe("Nothing to redo");
    expect(historyAppliedStatus("undo")).toBe("Undid last change");
    expect(historyAppliedStatus("redo")).toBe("Redid last change");
  });

  it("marks only shots whose TIFF inputs changed across history", () => {
    const current = projectWithShots();
    const restored = {
      ...current,
      shots: [
        {
          ...current.shots[0],
          layers: current.shots[0].layers?.map((item) => ({ ...item, opacity: 0.5 }))
        },
        current.shots[1]
      ]
    };

    expect(historyDirtyShotIds(current, restored, [])).toEqual(["shot-a"]);
  });

  it("maps restored layer pixels to their owning shot even when metadata is unchanged", () => {
    const current = projectWithShots();

    expect(
      historyDirtyShotIds(current, current, [
        ".storyboard-workbench/layers/shot-b/layer-image.png"
      ])
    ).toEqual(["shot-b"]);
  });

  it("does not rewrite TIFFs for history changes that only affect project JSON", () => {
    const current = projectWithShots();
    const restored = {
      ...current,
      name: "Renamed project",
      shots: [
        { ...current.shots[0], scriptText: "Updated action notes" },
        current.shots[1]
      ]
    };

    expect(historyDirtyShotIds(current, restored, [])).toEqual([]);
  });
});
