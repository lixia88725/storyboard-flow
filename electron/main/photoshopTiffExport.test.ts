import { describe, expect, it } from "vitest";
import { buildPhotoshopTiffExportPlan } from "./photoshopTiffExport.js";

const layer = (patch: Partial<Parameters<typeof buildPhotoshopTiffExportPlan>[0]["shots"][number]["layers"][number]>) => ({
  id: "layer-image",
  kind: "image" as const,
  name: "Image",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal" as const,
  order: 0,
  bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png",
  width: 320,
  height: 180,
  ...patch
});

describe("buildPhotoshopTiffExportPlan", () => {
  it("creates one Photoshop TIFF export job per shot in storyboard order", () => {
    const plan = buildPhotoshopTiffExportPlan(
      {
        name: "Demo",
        shots: [
          {
            id: "shot-b",
            imagePath: "/scene/b.tiff",
            fileName: "second shot.tiff",
            order: 1,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [layer({ id: "layer-image-b", bitmapPath: ".storyboard-workbench/layers/shot-b/layer-image.png" })]
          },
          {
            id: "shot-a",
            imagePath: "/scene/a.tiff",
            fileName: "first shot.tiff",
            order: 0,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [layer({})]
          }
        ]
      },
      "/scene",
      new Date("2026-05-30T01:02:03.000Z")
    );

    expect(plan.exportFolderPath).toBe("/scene/Photoshop TIFF Export/20260530T010203");
    expect(plan.jobs.map((job) => job.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(plan.jobs.map((job) => job.outputPath)).toEqual([
      "/scene/Photoshop TIFF Export/20260530T010203/0010-first_shot.tiff",
      "/scene/Photoshop TIFF Export/20260530T010203/0020-second_shot.tiff"
    ]);
  });

  it("builds bottom-to-top layer manifests with resolved layer assets", () => {
    const plan = buildPhotoshopTiffExportPlan(
      {
        name: "Demo",
        shots: [
          {
            id: "shot-a",
            imagePath: "/scene/a.tiff",
            fileName: "a.tiff",
            order: 0,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [
              layer({}),
              layer({
                id: "paint-2",
                kind: "paint",
                name: "Paint 2",
                order: 2,
                opacity: 0.5,
                blendMode: "screen",
                visible: false,
                bitmapPath: ".storyboard-workbench/layers/shot-a/paint-2.png"
              }),
              layer({
                id: "paint-1",
                kind: "paint",
                name: "Paint 1",
                order: 1,
                blendMode: "multiply",
                bitmapPath: ".storyboard-workbench/layers/shot-a/paint-1.png"
              })
            ]
          }
        ]
      },
      "/scene",
      new Date("2026-05-30T01:02:03.000Z")
    );

    expect(plan.jobs[0].manifest).toMatchObject({
      outputPath: "/scene/Photoshop TIFF Export/20260530T010203/0010-a.tiff",
      width: 320,
      height: 180,
      documentName: "0010-a",
      layers: [
        {
          name: "Image",
          path: "/scene/.storyboard-workbench/layers/shot-a/layer-image.png",
          opacity: 1,
          blendMode: "normal",
          visible: true,
          background: true
        },
        {
          name: "Paint 1",
          path: "/scene/.storyboard-workbench/layers/shot-a/paint-1.png",
          opacity: 1,
          blendMode: "multiply",
          visible: true,
          background: false
        },
        {
          name: "Paint 2",
          path: "/scene/.storyboard-workbench/layers/shot-a/paint-2.png",
          opacity: 0.5,
          blendMode: "screen",
          visible: false,
          background: false
        }
      ]
    });
  });

  it("rejects layer paths outside the SWB layer asset directory", () => {
    expect(() =>
      buildPhotoshopTiffExportPlan(
        {
          name: "Demo",
          shots: [
            {
              id: "shot-a",
              imagePath: "/scene/a.tiff",
              fileName: "a.tiff",
              order: 0,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: "../escape.png" })]
            }
          ]
        },
        "/scene",
        new Date("2026-05-30T01:02:03.000Z")
      )
    ).toThrow("Layer bitmap path must stay under");
  });
});
