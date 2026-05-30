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
