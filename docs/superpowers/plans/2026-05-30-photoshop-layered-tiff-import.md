# Photoshop Layered TIFF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Photoshop-edited layered TIFF files through the existing SWB import flow by converting Photoshop TIFF layers into SWB bitmap layer assets and archiving the source TIFF.

**Architecture:** Add a focused Photoshop TIFF import module beside the existing export module. Electron keeps the current import transaction shape, but routes layered Photoshop TIFFs through a Python helper that extracts raster layers into temporary PNG assets and returns a JSON manifest. The renderer continues to use the existing Import control and warning surface.

**Tech Stack:** Electron main process, TypeScript, Vitest, Sharp, Python 3, `psdtags`, `tifffile`, `imagecodecs`, `numpy`, existing `npm run smoke:bitmap`.

---

## Files And Responsibilities

- Create `scripts/photoshop-layered-tiff-import.py`: read Photoshop `ImageSourceData` tag `37724`, write one RGBA PNG per raster layer, and emit a JSON manifest for Electron.
- Create `electron/main/photoshopTiffImport.ts`: detect layered Photoshop TIFFs, call the Python helper, validate output paths, and expose typed conversion results to the existing import flow.
- Create `electron/main/photoshopTiffImport.test.ts`: unit-test detection, plan building, path validation, fallback behavior, and metadata conversion.
- Modify `electron/main/main.ts`: integrate layered TIFF conversion into `importProjectToSwbFormat` without changing the Save boundary.
- Modify `scripts/electron-bitmap-smoke.mjs`: add a round-trip smoke case that exports a Photoshop layered TIFF, reopens/imports it as an external file, and verifies multiple SWB bitmap layers.
- Modify `README.md`, `todo.md`, `context-handoff.md`, and `decisions.md`: document that Photoshop layered TIFF import is now an explicit ingestion path, not a Save replacement.

## Task 1: Python Layer Extractor Spike

**Files:**
- Create: `scripts/photoshop-layered-tiff-import.py`

- [ ] **Step 1: Add the Python helper with strict CLI validation**

Create `scripts/photoshop-layered-tiff-import.py` with this initial shape:

```python
#!/usr/bin/env python3
"""Extract Photoshop layered TIFF raster layers into SWB import assets."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

deps_dir = os.environ.get("SWB_PYTHON_DEPS_DIR")
if deps_dir:
    sys.path.insert(0, deps_dir)

import imagecodecs
import numpy
import tifffile
from psdtags import PsdBlendMode, PsdLayerFlag, TiffImageSourceData


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to a Photoshop layered TIFF.")
    parser.add_argument("output_dir", help="Directory for extracted PNG layer assets.")
    parser.add_argument("manifest", help="Path for the JSON import manifest.")
    args = parser.parse_args()

    extract_layered_tiff(Path(args.source), Path(args.output_dir), Path(args.manifest))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Add a temporary verification command**

Run:

```bash
PYTHONPATH=/private/tmp/psdtags-spike-deps python3 scripts/photoshop-layered-tiff-spike.py --output /private/tmp/swb-import-plan-source.tiff
SWB_PYTHON_DEPS_DIR=/private/tmp/psdtags-spike-deps python3 scripts/photoshop-layered-tiff-import.py /private/tmp/swb-import-plan-source.tiff /private/tmp/swb-import-plan-layers /private/tmp/swb-import-plan-manifest.json
```

Expected: the second command fails with `NameError: name 'extract_layered_tiff' is not defined`.

- [ ] **Step 3: Implement extraction**

Add these functions above `main()`:

```python
SUPPORTED_BLEND_MODES = {
    PsdBlendMode.NORMAL: "normal",
    PsdBlendMode.MULTIPLY: "multiply",
    PsdBlendMode.SCREEN: "screen",
}


def layer_visible(layer: Any) -> bool:
    if layer.flags & PsdLayerFlag.VISIBLE:
        return True
    # The early spike script did not set the VISIBLE flag. Treat those files as
    # visible, but preserve hidden layers from the current SWB exporter.
    return not bool(layer.flags & PsdLayerFlag.PHOTOSHOP5)


def normalize_rgba(image: numpy.ndarray, layer: Any, width: int, height: int) -> numpy.ndarray:
    if image.ndim == 2:
        image = numpy.stack([image, image, image, numpy.full_like(image, 255)], axis=-1)
    elif image.shape[2] == 3:
        alpha = numpy.full((image.shape[0], image.shape[1], 1), 255, dtype=image.dtype)
        image = numpy.concatenate([image, alpha], axis=-1)
    elif image.shape[2] > 4:
        image = image[..., :4]

    if image.dtype != numpy.uint8:
        image = image.astype(numpy.uint8)

    if image.shape[0] != height or image.shape[1] != width:
        canvas = numpy.zeros((height, width, 4), dtype=numpy.uint8)
        top = max(0, int(layer.rectangle.top))
        left = max(0, int(layer.rectangle.left))
        canvas[top : top + image.shape[0], left : left + image.shape[1], :] = image
        return canvas

    return image


def safe_layer_name(name: str, index: int) -> str:
    cleaned = "".join(char if char.isalnum() or char in " ._-" else "_" for char in name).strip()
    return cleaned or f"Layer {index + 1}"


def extract_layered_tiff(source: Path, output_dir: Path, manifest_path: Path) -> None:
    image_source_data = TiffImageSourceData.fromtiff(source)
    layers = list(image_source_data.layers or [])
    if not layers:
        raise ValueError("No Photoshop layers found")

    with tifffile.TiffFile(source) as tiff:
        page = tiff.pages[0]
        height, width = page.shape[:2]

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_layers = []
    warnings = []

    for index, layer in enumerate(layers):
        image = normalize_rgba(layer.asarray(), layer, width, height)
        file_name = f"{index:04d}-{safe_layer_name(str(layer.name), index)}.png"
        output_path = output_dir / file_name
        imagecodecs.imwrite(output_path, image)

        blend_mode = SUPPORTED_BLEND_MODES.get(layer.blendmode)
        if blend_mode is None:
            blend_mode = "normal"
            warnings.append(f"Layer '{layer.name}' used unsupported blend mode {layer.blendmode}; imported as normal.")

        manifest_layers.append(
            {
                "name": str(layer.name),
                "assetPath": str(output_path),
                "visible": layer_visible(layer),
                "opacity": max(0, min(1, int(layer.opacity) / 255)),
                "blendMode": blend_mode,
                "order": index,
            }
        )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "sourcePath": str(source),
                "width": width,
                "height": height,
                "layers": manifest_layers,
                "warnings": warnings,
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
```

- [ ] **Step 4: Run the verification command again**

Run:

```bash
rm -rf /private/tmp/swb-import-plan-layers /private/tmp/swb-import-plan-manifest.json
PYTHONPATH=/private/tmp/psdtags-spike-deps python3 scripts/photoshop-layered-tiff-spike.py --output /private/tmp/swb-import-plan-source.tiff
SWB_PYTHON_DEPS_DIR=/private/tmp/psdtags-spike-deps python3 scripts/photoshop-layered-tiff-import.py /private/tmp/swb-import-plan-source.tiff /private/tmp/swb-import-plan-layers /private/tmp/swb-import-plan-manifest.json
```

Expected: exit code `0`, `/private/tmp/swb-import-plan-manifest.json` contains at least two layers, and `/private/tmp/swb-import-plan-layers` contains PNG files.

- [ ] **Step 5: Commit**

```bash
git add scripts/photoshop-layered-tiff-import.py
git commit -m "feat: extract photoshop tiff layers for import"
```

## Task 2: Electron Import Module

**Files:**
- Create: `electron/main/photoshopTiffImport.ts`
- Create: `electron/main/photoshopTiffImport.test.ts`

- [ ] **Step 1: Write failing tests for import plan and path validation**

Create `electron/main/photoshopTiffImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPhotoshopTiffImportAssetPlan, importedLayerToBitmapLayer } from "./photoshopTiffImport.js";

describe("photoshopTiffImport", () => {
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
            opacity: 0.5,
            blendMode: "multiply",
            order: 1
          }
        ],
        warnings: []
      },
      "shot-a",
      "/scene/.storyboard-workbench/import-tmp/stamp/layers"
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
    expect(plan.layers.map((layer) => [layer.id, layer.kind, layer.name, layer.order])).toEqual([
      ["layer-image", "image", "Image", 0],
      ["layer-0001", "paint", "Paint", 1]
    ]);
  });

  it("maps imported Photoshop layer metadata into SWB bitmap layers", () => {
    expect(
      importedLayerToBitmapLayer(
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
      )
    ).toMatchObject({
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
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test -- electron/main/photoshopTiffImport.test.ts
```

Expected: FAIL because `electron/main/photoshopTiffImport.ts` does not exist.

- [ ] **Step 3: Implement the module**

Create `electron/main/photoshopTiffImport.ts`:

```ts
import { execFile } from "node:child_process";
import path from "node:path";

import type { BitmapLayer } from "../../src/shared/types.js";

export type ImportedPhotoshopTiffLayer = {
  name: string;
  assetPath: string;
  visible: boolean;
  opacity: number;
  blendMode: "normal" | "multiply" | "screen";
  order: number;
};

export type ImportedPhotoshopTiffManifest = {
  sourcePath: string;
  width: number;
  height: number;
  layers: ImportedPhotoshopTiffLayer[];
  warnings: string[];
};

export type PhotoshopTiffImportAssetPlan = {
  layers: BitmapLayer[];
  moves: Array<{ fromPath: string; toPath: string }>;
};

export const importedLayerToBitmapLayer = (
  layer: ImportedPhotoshopTiffLayer,
  shotId: string,
  index: number,
  width: number,
  height: number
): BitmapLayer => {
  const isImageLayer = index === 0;
  const id = isImageLayer ? "layer-image" : `layer-${String(index).padStart(4, "0")}`;

  return {
    id,
    kind: isImageLayer ? "image" : "paint",
    name: layer.name || (isImageLayer ? "Image" : `Layer ${index + 1}`),
    visible: layer.visible,
    locked: false,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    order: index,
    bitmapPath: path.join(".storyboard-workbench", "layers", shotId, `${id}.png`),
    width,
    height
  };
};

export const buildPhotoshopTiffImportAssetPlan = (
  manifest: ImportedPhotoshopTiffManifest,
  shotId: string,
  tempLayerRoot: string
): PhotoshopTiffImportAssetPlan => {
  const sortedLayers = [...manifest.layers].sort((a, b) => a.order - b.order);
  const layers = sortedLayers.map((layer, index) =>
    importedLayerToBitmapLayer(layer, shotId, index, manifest.width, manifest.height)
  );

  return {
    layers,
    moves: sortedLayers.map((layer, index) => {
      const id = index === 0 ? "layer-image" : `layer-${String(index).padStart(4, "0")}`;
      return {
        fromPath: layer.assetPath,
        toPath: path.join(tempLayerRoot, shotId, `${id}.png`)
      };
    })
  };
};

export const runPhotoshopTiffImporter = (
  pythonPath: string,
  scriptPath: string,
  sourcePath: string,
  outputDir: string,
  manifestPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  return new Promise((resolve, reject) => {
    execFile(pythonPath, [scriptPath, sourcePath, outputDir, manifestPath], { env }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Photoshop TIFF import failed: ${error.message}\n${stdout.trim()}\n${stderr.trim()}`.trim()
        )
      );
    });
  });
};
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run test -- electron/main/photoshopTiffImport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/photoshopTiffImport.ts electron/main/photoshopTiffImport.test.ts
git commit -m "feat: plan photoshop tiff import assets"
```

## Task 3: Integrate Layered TIFF Import Into Existing Import Transaction

**Files:**
- Modify: `electron/main/main.ts`
- Modify: `electron/main/photoshopTiffImport.ts`
- Modify: `electron/main/photoshopTiffImport.test.ts`

- [ ] **Step 1: Add a failing test for ordinary TIFF fallback**

Append this test to `electron/main/photoshopTiffImport.test.ts`:

```ts
import { isLikelyTiffPath } from "./photoshopTiffImport.js";

it("only considers TIFF paths for Photoshop layered TIFF import", () => {
  expect(isLikelyTiffPath("/scene/a.tiff")).toBe(true);
  expect(isLikelyTiffPath("/scene/a.tif")).toBe(true);
  expect(isLikelyTiffPath("/scene/a.png")).toBe(false);
  expect(isLikelyTiffPath("/scene/a.jpg")).toBe(false);
});
```

- [ ] **Step 2: Implement TIFF path detection**

Add to `electron/main/photoshopTiffImport.ts`:

```ts
export const isLikelyTiffPath = (filePath: string): boolean => {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".tif" || extension === ".tiff";
};
```

- [ ] **Step 3: Modify `main.ts` imports**

In `electron/main/main.ts`, extend imports:

```ts
import {
  buildPhotoshopTiffImportAssetPlan,
  isLikelyTiffPath,
  runPhotoshopTiffImporter,
  type ImportedPhotoshopTiffManifest
} from "./photoshopTiffImport.js";
```

- [ ] **Step 4: Add conversion preparation inside `importProjectToSwbFormat`**

Inside `importProjectToSwbFormat`, define:

```ts
const photoshopLayerRoot = path.join(tempRoot, "photoshop-layers");
const finalLayerRoot = path.join(folderPath, ".storyboard-workbench", "layers");
```

Then, in the `prepared` map, after `tempPath` is defined and before `sharp(shot.imagePath)...`, add this branch:

```ts
let importedLayers: NonNullable<Project["shots"][number]["layers"]> | undefined;
let importedLayerMoves: Array<{ fromPath: string; toPath: string }> = [];
let importWarnings: string[] = [];

if (isLikelyTiffPath(shot.imagePath)) {
  const extractedDir = path.join(photoshopLayerRoot, shot.id, "extracted");
  const manifestPath = path.join(photoshopLayerRoot, shot.id, "manifest.json");

  try {
    await runPhotoshopTiffImporter("python3", path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-import.py"), shot.imagePath, extractedDir, manifestPath, {
      ...process.env,
      SWB_PYTHON_DEPS_DIR: process.env.SWB_PYTHON_DEPS_DIR ?? defaultPhotoshopTiffPythonDepsDir
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ImportedPhotoshopTiffManifest;
    const layerPlan = buildPhotoshopTiffImportAssetPlan(manifest, shot.id, finalLayerRoot);
    importedLayers = layerPlan.layers;
    importedLayerMoves = layerPlan.moves;
    importWarnings = manifest.warnings;
  } catch {
    importedLayers = undefined;
    importedLayerMoves = [];
    importWarnings = [];
  }
}
```

Keep the existing working TIFF preparation:

```ts
await sharp(shot.imagePath).rotate().tiff().toFile(tempPath);
```

Return these extra fields from the prepared item:

```ts
importedLayers,
importedLayerMoves,
importWarnings,
```

- [ ] **Step 5: Move generated layer assets transactionally**

Before `importedTargets = await applyFileMoves(...)`, add:

```ts
let importedLayerTargets: AppliedFileMoves | undefined;
```

After `importedTargets = await applyFileMoves(...)`, add:

```ts
const layerMoves = prepared.flatMap((item) => item.importedLayerMoves);
if (layerMoves.length > 0) {
  importedLayerTargets = await applyFileMoves(layerMoves, moveOps);
}
```

Update rollback:

```ts
const rollbackImportMoves = async () => {
  await importedLayerTargets?.rollback();
  await importedTargets?.rollback();
  await archivedOriginals?.rollback();
};
```

- [ ] **Step 6: Preserve imported layer metadata on the shot**

When building `nextProject`, set:

```ts
layers: item.importedLayers ?? shot.layers,
sketchLayers: item.importedLayers ? [] : emptyDefaultSketchLayers(shot) ? [] : shot.sketchLayers,
activeLayerTarget: "image",
activeLayerId: "layer-image",
importWarnings: item.importWarnings.length > 0 ? item.importWarnings : shot.importWarnings,
swb: {
  version: swbFormatVersion,
  status: "owned",
  canvasWidth: item.width,
  canvasHeight: item.height,
  baseFingerprint: item.fingerprint,
  sourcePath: shot.imagePath,
  archivePath: item.archivePath,
  sourceKind: item.importedLayers ? "photoshop-layered-tiff" : undefined
}
```

If `sourceKind` is not currently typed, add it to `ShotSwbState` in `src/shared/types.ts` as:

```ts
sourceKind?: "photoshop-layered-tiff";
```

- [ ] **Step 7: Run focused verification**

Run:

```bash
npm run test -- electron/main/photoshopTiffImport.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add electron/main/main.ts electron/main/photoshopTiffImport.ts electron/main/photoshopTiffImport.test.ts src/shared/types.ts
git commit -m "feat: import photoshop layered tiffs into swb layers"
```

## Task 4: Smoke Test Round Trip

**Files:**
- Modify: `scripts/electron-bitmap-smoke.mjs`

- [ ] **Step 1: Write a failing smoke assertion**

In `scripts/electron-bitmap-smoke.mjs`, after the existing Photoshop TIFF export readback, add a helper flow:

```js
const photoshopImportRoot = path.join("/private/tmp", `swb-photoshop-import-${Date.now()}`);
await mkdir(photoshopImportRoot, { recursive: true });
await writeFile(path.join(photoshopImportRoot, "import-me.tiff"), await readFile(photoshopExportFiles[0]));
```

Then open `photoshopImportRoot`, click Import, wait for metadata, and assert:

```js
const importedPhotoshopProject = await readProjectMetadata(photoshopImportRoot);
const importedPhotoshopShot = importedPhotoshopProject.shots?.[0];
if (!importedPhotoshopShot || importedPhotoshopShot.layers?.length < 2) {
  throw new Error("Photoshop layered TIFF import did not create multiple SWB layers");
}
if (importedPhotoshopShot.swb?.sourceKind !== "photoshop-layered-tiff") {
  throw new Error("Photoshop layered TIFF import did not record sourceKind");
}
```

- [ ] **Step 2: Run smoke and verify failure if Task 3 is incomplete**

Run:

```bash
npm run smoke:bitmap
```

Expected before Task 3 completion: FAIL with `Photoshop layered TIFF import did not create multiple SWB layers`.

- [ ] **Step 3: Run smoke after Task 3 completion**

Run:

```bash
npm run smoke:bitmap
```

Expected after Task 3 completion: PASS. The output should still include the existing Photoshop export readback and should not report import warnings for SWB-exported layered TIFF.

- [ ] **Step 4: Commit**

```bash
git add scripts/electron-bitmap-smoke.mjs
git commit -m "test: smoke photoshop layered tiff import"
```

## Task 5: Docs And Handoff

**Files:**
- Modify: `README.md`
- Modify: `decisions.md`
- Modify: `todo.md`
- Modify: `context-handoff.md`

- [ ] **Step 1: Update README**

In `README.md`, change the Photoshop section to say:

```md
`Export TIFF` writes one Photoshop-readable layered TIFF per shot. The existing Import action also detects Photoshop layered TIFF files and converts raster Photoshop layers into SWB bitmap layers. Import archives the original Photoshop TIFF and continues working from SWB-owned layer PNG assets plus project metadata.
```

- [ ] **Step 2: Update decisions**

In `decisions.md`, update `Photoshop Interop Stays Separate From Internal Working Data` with:

```md
Photoshop layered TIFF import/export are explicit exchange paths. Export writes Photoshop-readable TIFFs; Import ingests Photoshop layered TIFFs into SWB-owned bitmap layer assets. Neither path changes the Save boundary or makes Photoshop TIFF the internal working format.
```

- [ ] **Step 3: Update todo**

In `todo.md`, mark Photoshop layered TIFF import complete and leave PSD-first as future work:

```md
- [x] Add Photoshop layered TIFF import through the existing Import flow.
- [ ] Spike PSD-first workflow with `ag-psd`.
```

- [ ] **Step 4: Update handoff**

In `context-handoff.md`, add current evidence:

```md
- Photoshop layered TIFF import now routes through the existing Import flow.
- Smoke verifies SWB export -> Photoshop layered TIFF -> SWB import creates multiple bitmap layers.
- Save remains the only real SWB filename-sync and working TIFF bake boundary.
```

- [ ] **Step 5: Run final verification**

Run:

```bash
npm run test
npm run typecheck
npm run smoke:bitmap
```

Expected: all pass. `npm run build` may be run after this if distribution packaging is being checked; the existing Vite chunk-size warning is acceptable if build succeeds.

- [ ] **Step 6: Commit**

```bash
git add README.md decisions.md todo.md context-handoff.md
git commit -m "docs: document photoshop layered tiff import"
```

## Self-Review

- Spec coverage: existing Import behavior, Archive handling, SWB internal data model, TIFF tag detection, warning surface, tests, and non-goals are all mapped to tasks.
- Highest-risk area: Python extraction from Photoshop TIFF layer records. Task 1 isolates this before Electron transaction changes.
- Save boundary: no task modifies autosave or makes Photoshop TIFF the internal Save format.
- No UI expansion: the plan keeps the current Import control.
- Known uncertainty: Photoshop visibility flag semantics may differ across files. Task 4 must include an SWB-exported round trip, and a later manual Photoshop-created fixture should be added if Photoshop writes different flags.
