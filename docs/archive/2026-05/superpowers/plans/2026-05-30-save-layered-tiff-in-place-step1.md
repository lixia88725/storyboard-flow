# Save Layered TIFF In-Place Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the smallest testable planning layer needed for Save to eventually write Photoshop layered TIFFs back to each shot's real TIFF path.

**Architecture:** Reuse the existing Photoshop TIFF manifest shape and layer ordering. Add an in-place plan builder that targets each SWB-owned shot's current `imagePath`, with a sibling temporary output path; do not change UI or Save behavior in this step.

**Tech Stack:** Electron main process TypeScript, Vitest, existing `scripts/photoshop-layered-tiff-export.py` manifest contract.

---

### Task 1: In-Place Photoshop TIFF Save Plan

**Files:**
- Modify: `electron/main/photoshopTiffExport.ts`
- Test: `electron/main/photoshopTiffExport.test.ts`

- [x] **Step 1: Write the failing test**

Add a Vitest case showing that the in-place plan writes to the shot's current TIFF path and uses a distinct temporary sibling path:

```ts
it("plans in-place Photoshop TIFF writes through temporary sibling files", () => {
  const plan = buildPhotoshopTiffInPlaceSavePlan(
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
              id: "paint-1",
              kind: "paint",
              name: "Paint 1",
              order: 1,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-1.png"
            })
          ]
        }
      ]
    },
    "/scene",
    "save-123"
  );

  expect(plan.jobs).toHaveLength(1);
  expect(plan.jobs[0].outputPath).toBe("/scene/.storyboard-workbench/save-tmp/save-123/a.tiff");
  expect(plan.jobs[0].finalPath).toBe("/scene/a.tiff");
  expect(plan.jobs[0].manifest.outputPath).toBe("/scene/.storyboard-workbench/save-tmp/save-123/a.tiff");
  expect(plan.jobs[0].manifest.documentName).toBe("a");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- electron/main/photoshopTiffExport.test.ts`

Expected: FAIL because `buildPhotoshopTiffInPlaceSavePlan` is not exported.

- [x] **Step 3: Write minimal implementation**

Add:

```ts
export type PhotoshopTiffInPlaceSaveJob = PhotoshopTiffExportJob & {
  finalPath: string;
};

export type PhotoshopTiffInPlaceSavePlan = {
  tempFolderPath: string;
  manifestFolderPath: string;
  jobs: PhotoshopTiffInPlaceSaveJob[];
};

export const buildPhotoshopTiffInPlaceSavePlan = (
  project: Project,
  folderPath: string,
  saveStamp: string
): PhotoshopTiffInPlaceSavePlan => {
  const tempFolderPath = path.join(folderPath, ".storyboard-workbench", "save-tmp", saveStamp);
  const manifestFolderPath = path.join(tempFolderPath, ".manifests");
  const sortedShots = [...project.shots].sort((a, b) => a.order - b.order);

  const jobs = sortedShots.map((shot) => {
    const finalPath = shot.imagePath;
    const outputPath = path.join(tempFolderPath, shot.fileName);
    const manifest = buildPhotoshopTiffManifestForShot(shot, folderPath, outputPath, path.parse(shot.fileName).name || shot.id);
    return { shotId: shot.id, outputPath, finalPath, manifest };
  });

  return { tempFolderPath, manifestFolderPath, jobs };
};
```

Extract the existing manifest creation inside `buildPhotoshopTiffExportPlan` into a shared helper so export behavior remains unchanged.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- electron/main/photoshopTiffExport.test.ts`

Expected: PASS.

- [x] **Step 5: Run broader checks**

Run:

```bash
npm run test
npm run typecheck
```

Expected: both pass.

- [x] **Step 6: Commit**

```bash
git add electron/main/photoshopTiffExport.ts electron/main/photoshopTiffExport.test.ts docs/superpowers/plans/2026-05-30-save-layered-tiff-in-place-step1.md
git commit -m "feat: plan in-place photoshop tiff saves"
```

### Task 2: Write In-Place Photoshop TIFF Temp Outputs

**Files:**
- Modify: `electron/main/photoshopTiffExport.ts`
- Test: `electron/main/photoshopTiffExport.test.ts`

- [x] **Step 1: Write the failing test**

Added a test that runs a fake writer through `process.execPath`, writes the layered TIFF output into `.storyboard-workbench/save-tmp/<stamp>/`, and verifies the original shot TIFF still contains its original content.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- electron/main/photoshopTiffExport.test.ts`

Observed: FAIL with `writePhotoshopLayeredTiffsForInPlaceSave is not a function`.

- [x] **Step 3: Write minimal implementation**

Added `writePhotoshopLayeredTiffsForInPlaceSave`, which builds the in-place plan, writes manifest files, invokes the existing exporter runner, and returns `replacements` without applying them.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- electron/main/photoshopTiffExport.test.ts`

Observed: PASS.

### Task 3: Add Rollback-Safe File Replacement

**Files:**
- Modify: `electron/main/fileRenames.ts`
- Test: `electron/main/fileRenames.test.ts`

- [x] **Step 1: Write the failing test**

Added a test where replacement of the second TIFF fails after the first TIFF has already been replaced. The expected behavior is that both original TIFF paths are restored.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- electron/main/fileRenames.test.ts`

Observed: FAIL with `applyFileReplacements is not a function`.

- [x] **Step 3: Write minimal implementation**

Added `applyFileReplacements`, which moves each target file to a backup path before moving the temp file into the target path. Rollback deletes the new target when present and restores the backup.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- electron/main/fileRenames.test.ts`

Observed: PASS.

- [x] **Step 5: Cover explicit rollback after successful replacement**

Added a test that applies a replacement, verifies the target contains the new content, calls `rollback()`, and verifies the target contains the original content again.

### Task 4: Preserve SWB XMP In Photoshop Layered TIFF Writer

**Files:**
- Modify: `scripts/photoshop-layered-tiff-export.py`
- Test: `electron/main/photoshopTiffExport.test.ts`

- [x] **Step 1: Write the failing test**

Added an integration test that writes a real 2x2 Photoshop layered TIFF with manifest `xmp`, then verifies `sharp` can read back the XMP and `psdtags` can still read one Photoshop layer.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- electron/main/photoshopTiffExport.test.ts`

Observed: FAIL because `metadata.xmpAsString` is undefined.

- [x] **Step 3: Write minimal implementation**

Updated `scripts/photoshop-layered-tiff-export.py` to write optional manifest `xmp` as TIFF tag `700` alongside Photoshop ImageSourceData tag `37724`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- electron/main/photoshopTiffExport.test.ts`

Observed: PASS; `sharp` reads XMP and `psdtags` still reads the layer data.

### Task 5: Make Save Use Photoshop Layered TIFF For Multi-Layer Shots

**Files:**
- Modify: `electron/main/main.ts`
- Modify: `electron/main/fileRenames.ts`
- Modify: `electron/main/photoshopTiffExport.ts`
- Modify: `scripts/photoshop-layered-tiff-export.py`
- Modify: `scripts/electron-bitmap-smoke.mjs`

- [x] **Step 1: Add per-shot XMP injection for in-place save manifests**

`writePhotoshopLayeredTiffsForInPlaceSave` accepts `xmpByShotId` and writes the matching XMP into each manifest.

- [x] **Step 2: Connect multi-layer Save to the Photoshop TIFF writer**

`writeSwbMetadataToTiffs` keeps single-layer shots on the existing sharp path and routes shots with more than one bitmap layer through the Photoshop layered TIFF writer.

- [x] **Step 3: Preserve rollback behavior**

Layered Save writes to `.storyboard-workbench/save-tmp/<stamp>/`, replaces current TIFFs through `applyFileReplacements`, and keeps the replacement rollback handle inside `saveWorkspace` until project metadata has been written.

- [x] **Step 4: Keep SWB metadata without flattening Photoshop layers**

Save writes layered TIFFs once to compute the final fingerprint, then writes them again with SWB XMP tag `700`; it does not run sharp over the finished layered TIFF.

- [x] **Step 5: Match existing white-background Save output**

The Python writer flattens the main TIFF composite over white while preserving per-layer alpha in Photoshop layer records.

- [x] **Step 6: Verify through Electron smoke**

`npm run smoke:bitmap` verifies Save-produced working TIFFs contain Photoshop layer records via `psdtags` and still reopen correctly in SWB.
