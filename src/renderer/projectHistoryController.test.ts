import { describe, expect, it } from "vitest";
import {
  historyAppliedStatus,
  historyEntryAffectedBitmapPaths,
  historyUnavailableStatus,
  type ProjectHistoryEntry
} from "./projectHistoryController";
import { createProject } from "../shared/projectOps";

const entry = (bitmapPaths: string[]): ProjectHistoryEntry => ({
  project: createProject(),
  selectedShotIds: ["shot-a"],
  fileNameSyncState: "unsynced",
  layerAssets: bitmapPaths.map((bitmapPath) => ({ bitmapPath }))
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
});
