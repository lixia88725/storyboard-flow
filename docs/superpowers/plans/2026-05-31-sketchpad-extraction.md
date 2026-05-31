# SketchPad Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the current internal `SketchPad` component out of `src/renderer/App.tsx` without changing drawing, bitmap Select, Onion Skin, autosave, Save, Import, or layer behavior.

**Architecture:** This is a behavior-preserving extraction, not a redesign. First move shared canvas/rendering helpers into a small renderer helper module so `App.tsx` and the extracted `SketchPad.tsx` do not import from each other. Then move `SketchPad`, `BitmapSelectionOverlay`, `OnionSkinOverlay`, `OnionSkinGhost`, and their local selection/transform draft types into `src/renderer/SketchPad.tsx`.

**Tech Stack:** React, TypeScript, Vite, Electron preload API, Konva/react-konva, existing Vitest and Electron smoke coverage.

---

## Current Boundary

Move this block from `src/renderer/App.tsx`:

- `BitmapSelection` / `BitmapSelectionDraft` / `BitmapTransformDraft` / `PreparedBitmapTransform`
- `BitmapSelectionOverlay`
- `buildOverlaySelection`
- `SketchPadProps`
- `SketchPad`
- `OnionSkinOverlayProps`
- `OnionSkinOverlay`
- `OnionSkinGhost`

Keep these in `src/renderer/App.tsx`:

- top-level project state
- undo/redo history
- dirty shot tracking
- Save / Import / autosave behavior
- `handleBitmapStroke()`
- `handleBitmapSelectionTransform()`
- `ShotCard` and the `SketchPad` call site

## Props Contract

The extracted `SketchPad` must export this public prop shape:

```ts
export type SketchPadProps = {
  shot: Shot;
  folderPath?: string;
  tool: SketchTool;
  selectionMode: BitmapSelectionMode;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string) => Promise<string | undefined>;
  onFocusShot: () => void;
};
```

## Required Safety Net

Before changing code, run:

```bash
npm run test -- src/renderer/sketchGeometry.test.ts src/renderer/onionSkin.test.ts
npm run typecheck
```

Expected:

- targeted renderer tests pass
- TypeScript passes before extraction starts

After code changes, run:

```bash
npm run test -- src/renderer/sketchGeometry.test.ts src/renderer/onionSkin.test.ts
npm run typecheck
npm run build
npm run smoke:bitmap
```

Expected:

- all commands pass
- `npm run build` may still report the known Vite chunk-size warning
- `npm run smoke:bitmap` must still cover drawing, erasing, layer drawer behavior, bitmap Select move/scale, Onion Skin, Save conflict protection, Add Shot, reopen, and legacy migration

## Task 1: Extract Shared Sketch Rendering Helpers

**Files:**

- Create: `src/renderer/sketchRendering.ts`
- Modify: `src/renderer/App.tsx`
- Test: existing `npm run typecheck`

- [ ] **Step 1: Create `src/renderer/sketchRendering.ts`**

Add this file:

```ts
import type { BitmapLayer, Shot, SketchBlendMode, SketchStroke } from "../shared/types";
import { sketchCanvasSize, type CanvasSize } from "./sketchGeometry";

export const canvasBlendMode = (blendMode: SketchBlendMode | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "source-over";
};

export const cssBlendMode = (blendMode: BitmapLayer["blendMode"] | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "normal";
};

export const canvasSizeForShot = (shot: Shot): CanvasSize => {
  const width = shot.swb?.canvasWidth;
  const height = shot.swb?.canvasHeight;

  return width && height ? { width, height } : sketchCanvasSize;
};

export const drawStrokePathOnCanvas = (
  context: CanvasRenderingContext2D,
  stroke: SketchStroke,
  segment?: readonly [number, number, number, number]
) => {
  context.save();
  context.globalAlpha = stroke.opacity ?? 1;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  if (segment) {
    context.moveTo(segment[0], segment[1]);
    context.lineTo(segment[2], segment[3]);
  } else {
    context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index], stroke.points[index + 1]);
    }
  }

  context.stroke();
  context.restore();
};

export const drawImageUrl = (
  context: CanvasRenderingContext2D,
  sourceUrl: string,
  width: number,
  height: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve();
    };
    image.onerror = () => reject(new Error("Could not load layer bitmap"));
    image.src = sourceUrl;
  });
```

- [ ] **Step 2: Import helpers in `App.tsx`**

Add this import near the other renderer imports:

```ts
import {
  canvasBlendMode,
  canvasSizeForShot,
  drawImageUrl,
  drawStrokePathOnCanvas
} from "./sketchRendering";
```

- [ ] **Step 3: Remove duplicated helper definitions from `App.tsx`**

Remove these local functions from `App.tsx` after the import is added:

```ts
const canvasBlendMode = (blendMode: SketchBlendMode | undefined) => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "source-over";
};

const drawStrokePathOnCanvas = (
  context: CanvasRenderingContext2D,
  stroke: SketchStroke,
  segment?: readonly [number, number, number, number]
) => {
  context.save();
  context.globalAlpha = stroke.opacity ?? 1;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  if (segment) {
    context.moveTo(segment[0], segment[1]);
    context.lineTo(segment[2], segment[3]);
  } else {
    context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index], stroke.points[index + 1]);
    }
  }

  context.stroke();
  context.restore();
};

const drawImageUrl = (
  context: CanvasRenderingContext2D,
  sourceUrl: string,
  width: number,
  height: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve();
    };
    image.onerror = () => reject(new Error("Could not load layer bitmap"));
    image.src = sourceUrl;
  });

const canvasSizeForShot = (shot: Shot): CanvasSize => {
  const width = shot.swb?.canvasWidth;
  const height = shot.swb?.canvasHeight;

  return width && height ? { width, height } : sketchCanvasSize;
};
```

Do not remove `cssBlendMode` yet in this task unless TypeScript proves it is unused in `App.tsx`; it is safer to move it with `SketchPad` in Task 2.

- [ ] **Step 4: Run targeted verification**

Run:

```bash
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/renderer/sketchRendering.ts src/renderer/App.tsx
git commit -m "refactor: extract sketch rendering helpers"
```

## Task 2: Move `SketchPad` Into Its Own File

**Files:**

- Create: `src/renderer/SketchPad.tsx`
- Modify: `src/renderer/App.tsx`
- Test: targeted renderer tests, typecheck, build, smoke

- [ ] **Step 1: Create `src/renderer/SketchPad.tsx`**

Create the new file by moving the current `SketchPad` block and its local subcomponents out of `App.tsx`.

The file must start with these imports:

```ts
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Layer, Line, Stage } from "react-konva";
import { bitmapLayersForShot, imageBitmapLayerId } from "../shared/projectOps";
import type {
  BitmapLayer,
  BitmapSelectionMode,
  Shot,
  SketchStroke,
  SketchTool,
  StrokeTool
} from "../shared/types";
import {
  bitmapSelectionBounds,
  bitmapSelectionHandleRadiusForStage,
  bitmapSelectionHitTarget,
  latestStrokeSegment,
  liveStrokePreviewOpacity,
  scaleBitmapSelectionBounds,
  shouldAppendStrokePoint,
  shouldRenderLiveStroke,
  sketchCanvasSize,
  sketchPointFromClientPoint,
  type Bounds,
  type CanvasSize,
  type Point,
  type SelectionCorner
} from "./sketchGeometry";
import {
  canvasSizeForShot,
  cssBlendMode,
  drawImageUrl,
  drawStrokePathOnCanvas
} from "./sketchRendering";
```

Also move or define these local helpers in `SketchPad.tsx`:

```ts
const blurActiveFormControl = () => {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement
  ) {
    activeElement.blur();
  }
};
```

This avoids importing the current App-local `blurActiveFormControl()` and keeps `SketchPad` independent.

- [ ] **Step 2: Export `SketchPad` and `SketchPadProps`**

The new file must export:

```ts
export type SketchPadProps = {
  shot: Shot;
  folderPath?: string;
  tool: SketchTool;
  selectionMode: BitmapSelectionMode;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string) => Promise<string | undefined>;
  onFocusShot: () => void;
};

export const SketchPad = ({
  shot,
  folderPath,
  tool,
  selectionMode,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  onionSkinPreviousShot,
  onionSkinNextShot,
  onStroke,
  onSelectionTransform,
  onFocusShot
}: SketchPadProps) => {
  // Move the current function body from App.tsx verbatim.
  // Only adjust imports and local helper references required by this plan.
};
```

Move these type definitions into `SketchPad.tsx` as non-exported local types:

```ts
type BitmapSelection = {
  mode: BitmapSelectionMode;
  points: Point[];
  bounds: Bounds;
};

type BitmapSelectionDraft = {
  mode: BitmapSelectionMode;
  points: Point[];
};

type BitmapTransformDraft = {
  type: "move" | "scale";
  startPoint: Point;
  startBounds: Bounds;
  currentBounds: Bounds;
  corner?: SelectionCorner;
};

type PreparedBitmapTransform = {
  layerId: string;
  selection: BitmapSelection;
  sourceCanvas: HTMLCanvasElement;
  patchCanvas: HTMLCanvasElement;
};
```

- [ ] **Step 3: Import `SketchPad` in `App.tsx`**

Add:

```ts
import { SketchPad } from "./SketchPad";
```

Do not change the existing JSX call site. The existing call must remain:

```tsx
<SketchPad
  shot={shot}
  folderPath={folderPath}
  tool={activeSketchTool}
  selectionMode={selectionMode}
  brushColor={brushColor}
  brushOpacity={brushOpacity}
  brushSize={brushSize}
  eraserOpacity={eraserOpacity}
  eraserSize={eraserSize}
  onionSkinPreviousShot={onionSkinPreviousShot}
  onionSkinNextShot={onionSkinNextShot}
  onStroke={onSketchStroke}
  onSelectionTransform={onSelectionTransform}
  onFocusShot={onFocusShot}
/>
```

- [ ] **Step 4: Remove moved code from `App.tsx`**

Remove from `App.tsx`:

- `BitmapSelection`
- `BitmapSelectionDraft`
- `BitmapTransformDraft`
- `PreparedBitmapTransform`
- `BitmapSelectionOverlay`
- `buildOverlaySelection`
- `SketchPadProps`
- `SketchPad`
- `OnionSkinOverlayProps`
- `OnionSkinOverlay`
- `OnionSkinGhost`
- `cssBlendMode` if it is now only used by `SketchPad.tsx`

Do not remove:

- `aspectRatioForShot()`
- `drawStrokeOnBitmapLayer()`
- `createTransparentLayerDataUrl()`
- `handleBitmapStroke()`
- `handleBitmapSelectionTransform()`

- [ ] **Step 5: Clean unused imports in `App.tsx`**

After the move, remove imports that TypeScript reports as unused.

Expected likely removals from `App.tsx`:

```ts
import { Fragment } from "react";
import { Layer, Line, Stage } from "react-konva";
```

Do not remove shared types used elsewhere in `App.tsx`.

- [ ] **Step 6: Run targeted verification**

Run:

```bash
npm run test -- src/renderer/sketchGeometry.test.ts src/renderer/onionSkin.test.ts
npm run typecheck
```

Expected:

- both targeted test files pass
- TypeScript passes

- [ ] **Step 7: Run production and behavior verification**

Run:

```bash
npm run build
npm run smoke:bitmap
```

Expected:

- build passes; the existing Vite chunk-size warning is acceptable
- smoke passes
- `Temporary rename file already exists` remains acceptable only if `npm run smoke:bitmap` exits `0`

- [ ] **Step 8: Commit Task 2**

```bash
git add src/renderer/App.tsx src/renderer/SketchPad.tsx src/renderer/sketchRendering.ts
git commit -m "refactor: extract sketch pad component"
```

## Task 3: Update Handoff Docs After Extraction

**Files:**

- Modify: `todo.md`
- Modify: `context-handoff.md`
- Optional Modify: `README.md` only if the renderer file map becomes stale

- [ ] **Step 1: Update `todo.md`**

Replace the current P2 item:

```md
- [ ] Extract `SketchPad` from `App.tsx` only under a dedicated plan because it owns drawing, selection, pointer handling, and layer PNG writes.
```

with a completed milestone:

```md
- [x] `SketchPad` was extracted from `App.tsx` into `src/renderer/SketchPad.tsx` under the dedicated plan in `docs/superpowers/plans/2026-05-31-sketchpad-extraction.md`, with behavior-preserving verification.
```

- [ ] **Step 2: Update `context-handoff.md`**

Add a short completed-session bullet:

```md
- `SketchPad` extraction is recorded in `docs/superpowers/plans/2026-05-31-sketchpad-extraction.md` and implemented as a behavior-preserving move into `src/renderer/SketchPad.tsx`. Save, Import, autosave, dirty shot tracking, bitmap layer writes, and project history remain owned by `App.tsx`.
```

Add the verification commands and results actually run in Task 2.

- [ ] **Step 3: Run doc checks**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Commit docs**

```bash
git add todo.md context-handoff.md
git commit -m "docs: record sketch pad extraction"
```

## Rollback Strategy

If Task 1 fails typecheck, revert only the helper extraction commit:

```bash
git revert <task-1-commit>
```

If Task 2 fails smoke after typecheck/build pass, revert only the `SketchPad` extraction commit and keep the plan document:

```bash
git revert <task-2-commit>
```

Do not partially hand-edit moved code back into `App.tsx`; use `git revert` to preserve the known working baseline.

## Non-Goals

- Do not change drawing behavior.
- Do not change bitmap Select hit testing, cursor behavior, or transform math.
- Do not change Onion Skin opacity or controls.
- Do not change Save, Import, autosave, dirty shot tracking, or layer asset writes.
- Do not add code splitting or dynamic imports as part of this extraction.
- Do not extract `ShotCard`, `DialogueCard`, or project mutation handlers in the same pass.

## Known Risks

- `SketchPad` uses many refs for in-progress drawing/selection; stale closures can break finish-on-window-mouseup.
- Eraser live preview writes through hidden canvases and must still produce the same `renderedDataUrl`.
- Bitmap Select move/scale depends on prepared transform canvases and async image loading.
- Onion Skin reads layer PNGs through `window.storyboard.readLayerPng()` and must keep cancellation behavior.
- Stage sizing depends on `ResizeObserver`; moving code must preserve initial measurement and aspect ratio.
- The app relies on offscreen media deferral; extraction must not accidentally mount extra Konva stages.

## Expected Benefit

- `App.tsx` loses the highest-risk remaining internal component without changing ownership of project state.
- Future work can reason about pixel editing in `SketchPad.tsx` instead of scanning the whole app shell.
- Later affordance changes, cursor work, and bitmap Select improvements get a clearer module boundary.
