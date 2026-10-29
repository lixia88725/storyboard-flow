/**
 * Repeated-edit workload for the image-document Interface.
 *
 * TASK.md asks for synthetic operations on images with 5 and 100 layers and explicitly calls the
 * result "metadata-operation evidence only, not brush/rendering performance". These numbers say
 * how long pure document edits take; they say nothing about pixels, canvas or the GUI.
 *
 * The ceiling is deliberately loose (seconds, not milliseconds) so a slow CI machine cannot turn a
 * performance smoke test into a flaky failure. The printed measurements are the real evidence.
 */
import { describe, expect, it } from "vitest";
import type { ImageDocumentV1, ImageEditV1, LayerV1 } from "../../../electron/shared/refactorV1";
import { applyImageEdit } from "./index";

const assetA = "a".repeat(64);
const assetB = "b".repeat(64);
const width = 1920;
const height = 1080;
const iterations = 2000;
const ceilingMs = 20_000;

const layer = (index: number): LayerV1 => ({
  id: `layer-${String(index).padStart(3, "0")}`,
  name: `Layer ${String(index)}`,
  kind: index === 0 ? "image" : "paint",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  width,
  height,
  assetId: assetA
});

const documentWith = (layerCount: number): ImageDocumentV1 => ({
  id: "workload-image",
  revision: 0,
  width,
  height,
  layers: Array.from({ length: layerCount }, (_, index) => layer(index))
});

type Measurement = {
  layers: number;
  iterations: number;
  edits: number;
  changes: number;
  totalMs: number;
  perEditMicros: number;
  slowestEditMicros: number;
  finalRevision: number;
};

const runWorkload = (layerCount: number): Measurement => {
  const initial = documentWith(layerCount);
  const original = JSON.stringify(initial);
  let document = initial;
  let changes = 0;
  let edits = 0;
  let slowestEditMicros = 0;
  const startedAt = performance.now();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const topId = document.layers[document.layers.length - 1]!.id;
    const secondId = document.layers[document.layers.length - 2]!.id;
    const sequence: ImageEditV1[] = [
      // Structural: insert a scratch layer on top, prefix-free so ids stay unique.
      { kind: "insertLayer", layer: { ...layer(layerCount), id: `scratch-${String(iteration)}` }, index: document.layers.length },
      // Property: visibility, opacity and a rename on the new top layer.
      { kind: "setLayer", layerId: `scratch-${String(iteration)}`, patch: { visible: false, opacity: 0.5, name: `Scratch ${String(iteration)}` } },
      // No-op: identical values.
      { kind: "setLayer", layerId: `scratch-${String(iteration)}`, patch: { opacity: 0.5 } },
      // Reorder: move the scratch layer underneath the second-to-top layer.
      { kind: "moveLayer", layerId: `scratch-${String(iteration)}`, index: document.layers.length - 2 },
      // Pixel reference: adopt another immutable asset.
      { kind: "replacePixels", layerId: `scratch-${String(iteration)}`, assetId: assetB },
      // Structural: remove it again.
      { kind: "removeLayer", layerId: `scratch-${String(iteration)}` }
    ];

    for (const edit of sequence) {
      const editStartedAt = performance.now();
      const result = applyImageEdit(document, edit);
      const elapsedMicros = (performance.now() - editStartedAt) * 1000;
      edits += 1;
      slowestEditMicros = Math.max(slowestEditMicros, elapsedMicros);
      if (!result.ok) {
        throw new Error(`${edit.kind} failed: ${result.error.code} ${result.error.message}`);
      }

      if (result.value.changed) {
        changes += 1;
        expect(result.value.after.revision).toBe(document.revision + 1);
      } else {
        expect(result.value.after.revision).toBe(document.revision);
      }
      document = result.value.after;
    }

    // Ordering invariant after the full sequence: scratch layer gone, originals unchanged.
    expect(document.layers.length).toBe(layerCount);
    expect(document.layers[0]!.id).toBe("layer-000");
    expect(document.layers[document.layers.length - 1]!.id).toBe(topId);
    expect(document.layers[document.layers.length - 2]!.id).toBe(secondId);
  }

  const totalMs = performance.now() - startedAt;
  expect(JSON.stringify(initial)).toBe(original);

  return {
    layers: layerCount,
    iterations,
    edits,
    changes,
    totalMs: Math.round(totalMs * 10) / 10,
    perEditMicros: Math.round((totalMs * 1000) / edits),
    slowestEditMicros: Math.round(slowestEditMicros),
    finalRevision: document.revision
  };
};

describe("repeated synthetic image edits (metadata workload)", () => {
  it("keeps 5-layer and 100-layer documents correct across 2000 edit sequences", () => {
    const small = runWorkload(5);
    const large = runWorkload(100);

    // Every sequence performs 5 real changes (insert, set, move, replacePixels, remove) and
    // exactly 1 no-op (the repeated identical setLayer).
    for (const measurement of [small, large]) {
      expect(measurement.edits).toBe(iterations * 6);
      expect(measurement.changes).toBe(iterations * 5);
      expect(measurement.finalRevision).toBe(iterations * 5);
      expect(measurement.totalMs).toBeLessThan(ceilingMs);
    }

    console.log(`[drawing-workload] ${JSON.stringify({ small, large, ceilingMs })}`);
  });
});
