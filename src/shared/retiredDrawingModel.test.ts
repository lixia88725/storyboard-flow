import { expect, it } from "vitest";
import * as operations from "./projectOps";
import { access } from "node:fs/promises";

// Legacy fields remain migration inputs, not a second active drawing model.
// These retired writers have no production consumers; reader/rasterization
// behavior is still covered by existing projectOps/main/real PNG/TIFF chains.
const retiredWriters = ["updateSketch", "clearSketch", "appendSketchStroke", "addSketchLayer",
  "removeSketchLayer", "selectSketchLayer", "updateSketchLayer", "reorderSketchLayer", "moveSketchLayer",
  "updateShotBaseVisibility", "selectImageLayer", "appendImageLayerEdit", "clearImageLayerEdits", "deleteImageLayerContent"];

it("does not offer the retired stroke-editing model alongside bitmap editing", () => {
  expect(Object.keys(operations).filter(name => retiredWriters.includes(name))).toEqual([]);
});

it("still exposes legacy migration readers", () => {
  expect(operations.sketchLayersForShot).toBeTypeOf("function");
  expect(operations.flattenSketchLayers).toBeTypeOf("function");
  expect(operations.createDefaultSketchLayer).toBeTypeOf("function");
});

it("does not retain the unused parallel storyboard model", async () => {
  expect(await access(new URL("../model/storyboard.ts", import.meta.url)).then(() => true, () => false)).toBe(false);
});
