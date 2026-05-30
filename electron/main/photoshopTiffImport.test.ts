import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPhotoshopTiffImportAssetPlan,
  ensureLayerMoveDestinationsAvailable,
  importedLayerToBitmapLayer,
  isPhotoshopTiffNoLayersError,
  isLikelyTiffPath,
  topmostImportedLayerId,
  writeSwbImportWorkingTiff
} from "./photoshopTiffImport.js";

describe("photoshopTiffImport", () => {
  it("only considers TIFF paths for Photoshop layered TIFF import", () => {
    expect(isLikelyTiffPath("/scene/a.tiff")).toBe(true);
    expect(isLikelyTiffPath("/scene/a.tif")).toBe(true);
    expect(isLikelyTiffPath("/scene/a.png")).toBe(false);
    expect(isLikelyTiffPath("/scene/a.jpg")).toBe(false);
  });

  it("recognizes only the explicit no-Photoshop-layer importer marker as fallback-safe", () => {
    expect(isPhotoshopTiffNoLayersError(new Error("SWB_PHOTOSHOP_TIFF_NO_LAYERS: no tag"))).toBe(true);
    expect(isPhotoshopTiffNoLayersError(new Error("ModuleNotFoundError: No module named 'psdtags'"))).toBe(false);
    expect(isPhotoshopTiffNoLayersError(new Error("Unexpected token in manifest JSON"))).toBe(false);
  });

  it("rejects layer asset moves when a destination already exists", async () => {
    await expect(
      ensureLayerMoveDestinationsAvailable(
        [
          { fromPath: "/tmp/extracted/layer-image.png", toPath: "/scene/.storyboard-workbench/layers/shot-a/layer-image.png" },
          { fromPath: "/tmp/extracted/layer-0001.png", toPath: "/scene/.storyboard-workbench/layers/shot-a/layer-0001.png" }
        ],
        async (filePath) => filePath.endsWith("layer-0001.png")
      )
    ).rejects.toThrow("Photoshop TIFF import layer asset already exists");
  });

  it("builds SWB layer asset destinations under the temp import root", () => {
    const plan = buildPhotoshopTiffImportAssetPlan(
      {
        sourcePath: "/scene/paint.tiff",
        width: 320,
        height: 180,
        layers: [
          {
            name: "Image",
            assetPath: "/tmp/extracted/0000-Image.png",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            order: 0
          },
          {
            name: "Paint",
            assetPath: "/tmp/extracted/0001-Paint.png",
            visible: false,
            locked: true,
            opacity: 0.5,
            blendMode: "multiply",
            order: 1
          }
        ],
        warnings: []
      },
      "shot-a",
      "/scene/.storyboard-workbench/import-tmp/stamp/layers",
      "/tmp/extracted"
    );

    expect(plan.moves).toEqual([
      {
        fromPath: "/tmp/extracted/0000-Image.png",
        toPath: "/scene/.storyboard-workbench/import-tmp/stamp/layers/shot-a/layer-image.png"
      },
      {
        fromPath: "/tmp/extracted/0001-Paint.png",
        toPath: "/scene/.storyboard-workbench/import-tmp/stamp/layers/shot-a/layer-0001.png"
      }
    ]);
    expect(plan.layers.map((layer) => [layer.id, layer.kind, layer.name, layer.locked, layer.order])).toEqual([
      ["layer-image", "image", "Image", false, 0],
      ["layer-0001", "paint", "Paint", true, 1]
    ]);
  });

  it("maps imported Photoshop layer metadata into SWB bitmap layers", () => {
    const layer = importedLayerToBitmapLayer(
      {
        name: "Multiply Paint",
        assetPath: "/tmp/paint.png",
        visible: false,
        opacity: 0.25,
        blendMode: "multiply",
        order: 3
      },
      "shot-a",
      3,
      320,
      180
    );

    expect(layer).toMatchObject({
      id: "layer-0003",
      kind: "paint",
      name: "Multiply Paint",
      visible: false,
      opacity: 0.25,
      blendMode: "multiply",
      order: 3,
      bitmapPath: ".storyboard-workbench/layers/shot-a/layer-0003.png",
      width: 320,
      height: 180
    });
    expect(layer.bitmapPath).toBe(".storyboard-workbench/layers/shot-a/layer-0003.png");
    expect(layer.bitmapPath).not.toContain("\\");
  });

  it("sorts imported Photoshop layers before assigning SWB layer ids and move destinations", () => {
    const plan = buildPhotoshopTiffImportAssetPlan(
      {
        sourcePath: "/scene/paint.tiff",
        width: 320,
        height: 180,
        layers: [
          {
            name: "Top",
            assetPath: "/tmp/extracted/0002-Top.png",
            visible: true,
            opacity: 1,
            blendMode: "screen",
            order: 2
          },
          {
            name: "Image",
            assetPath: "/tmp/extracted/0000-Image.png",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            order: 0
          },
          {
            name: "Paint",
            assetPath: "/tmp/extracted/0001-Paint.png",
            visible: true,
            opacity: 1,
            blendMode: "multiply",
            order: 1
          }
        ],
        warnings: []
      },
      "shot-a",
      "/scene/.storyboard-workbench/import-tmp/stamp/layers",
      "/tmp/extracted"
    );

    expect(plan.layers.map((layer) => [layer.id, layer.name, layer.order])).toEqual([
      ["layer-image", "Image", 0],
      ["layer-0001", "Paint", 1],
      ["layer-0002", "Top", 2]
    ]);
    expect(plan.moves.map((move) => move.fromPath)).toEqual([
      "/tmp/extracted/0000-Image.png",
      "/tmp/extracted/0001-Paint.png",
      "/tmp/extracted/0002-Top.png"
    ]);
    expect(topmostImportedLayerId(plan.layers)).toBe("layer-0002");
  });

  it("rejects generated move destinations outside the temp layer root", () => {
    expect(() =>
      buildPhotoshopTiffImportAssetPlan(
        {
          sourcePath: "/scene/paint.tiff",
          width: 320,
          height: 180,
          layers: [
            {
              name: "Image",
              assetPath: "/tmp/extracted/0000-Image.png",
              visible: true,
              opacity: 1,
              blendMode: "normal",
              order: 0
            }
          ],
          warnings: []
        },
        "../escape",
        "/scene/.storyboard-workbench/import-tmp/stamp/layers",
        "/tmp/extracted"
      )
    ).toThrow("Import layer destination must stay under");
  });

  it("rejects imported assets outside the extraction root", () => {
    expect(() =>
      buildPhotoshopTiffImportAssetPlan(
        {
          sourcePath: "/scene/paint.tiff",
          width: 320,
          height: 180,
          layers: [
            {
              name: "Image",
              assetPath: "/tmp/other/0000-Image.png",
              visible: true,
              opacity: 1,
              blendMode: "normal",
              order: 0
            }
          ],
          warnings: []
        },
        "shot-a",
        "/scene/.storyboard-workbench/import-tmp/stamp/layers",
        "/tmp/extracted"
      )
    ).toThrow("Imported layer asset must stay under");
  });

  it("writes a placeholder working TIFF for already-extracted Photoshop layers", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-import-placeholder-"));

    try {
      const invalidSourcePath = path.join(folderPath, "source.tiff");
      const outputPath = path.join(folderPath, "working.tiff");
      await writeFile(invalidSourcePath, "not a readable tiff", "utf8");

      await writeSwbImportWorkingTiff({
        sourcePath: invalidSourcePath,
        outputPath,
        usePlaceholder: true
      });

      const bytes = await readFile(outputPath);
      expect(bytes.subarray(0, 4).toString("latin1")).toMatch(/^(II\*\u0000|MM\u0000\*)/u);
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });
});
