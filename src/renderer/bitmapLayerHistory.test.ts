import { describe, expect, it, vi } from "vitest";
import {
  readLayerAssetSnapshots,
  restoreLayerAssetSnapshots,
  type LayerAssetApi
} from "./bitmapLayerHistory";

describe("restoreLayerAssetSnapshots", () => {
  it("writes saved layer PNG snapshots and deletes layers that were missing", async () => {
    const api: LayerAssetApi = {
      writeLayerPng: vi.fn(async (payload) => ({ ...payload, filePath: `/tmp/${payload.bitmapPath}` })),
      deleteLayerPng: vi.fn(async (payload) => payload)
    };

    await restoreLayerAssetSnapshots(api, "/scene", [
      {
        bitmapPath: ".storyboard-workbench/layers/shot-a/paint.png",
        dataUrl: "data:image/png;base64,paint"
      },
      {
        bitmapPath: ".storyboard-workbench/layers/shot-a/missing.png",
        dataUrl: undefined
      }
    ]);

    expect(api.writeLayerPng).toHaveBeenCalledWith({
      folderPath: "/scene",
      bitmapPath: ".storyboard-workbench/layers/shot-a/paint.png",
      dataUrl: "data:image/png;base64,paint"
    });
    expect(api.deleteLayerPng).toHaveBeenCalledWith({
      folderPath: "/scene",
      bitmapPath: ".storyboard-workbench/layers/shot-a/missing.png"
    });
  });
});

describe("readLayerAssetSnapshots", () => {
  it("captures existing layer PNG data and records missing layers as undefined", async () => {
    const api = {
      readLayerPng: vi.fn(async (payload: { bitmapPath: string }) =>
        payload.bitmapPath.endsWith("paint.png") ? "data:image/png;base64,paint" : undefined
      )
    };

    await expect(
      readLayerAssetSnapshots(api, "/scene", [
        ".storyboard-workbench/layers/shot-a/paint.png",
        ".storyboard-workbench/layers/shot-a/missing.png"
      ])
    ).resolves.toEqual([
      {
        bitmapPath: ".storyboard-workbench/layers/shot-a/paint.png",
        dataUrl: "data:image/png;base64,paint"
      },
      {
        bitmapPath: ".storyboard-workbench/layers/shot-a/missing.png",
        dataUrl: undefined
      }
    ]);
  });
});
