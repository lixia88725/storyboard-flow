# Audit Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Storyboard Workbench baseline easier for future agents and teammates to extend without changing product behavior.

**Architecture:** Keep cleanup inside existing boundaries. Add documentation and small tests, reduce Electron-side duplication, add preload drift detection, and mark CSS/smoke structure without altering Save, Import, drawing, or data format behavior.

**Tech Stack:** Electron, React, TypeScript, Vite, Vitest, Node scripts.

---

### Task 1: Audit Documentation

**Files:**
- Create: `docs/audit-2026-05-30.md`
- Create: `docs/superpowers/plans/2026-05-30-audit-cleanup.md`

- [x] **Step 1: Record the current audit baseline**

Write the verification baseline, stable boundaries, hotspots, P0 guardrails, P1 cleanup targets, and P2 refactor candidates.

- [x] **Step 2: Keep the plan scoped**

Document that this pass does not rewrite Save, Import, drawing, renderer state management, or project data format.

### Task 2: Electron Bitmap Layer Helper

**Files:**
- Create: `electron/main/bitmapLayerOrdering.ts`
- Modify: `electron/main/bitmapLayers.test.ts`
- Modify: `electron/main/main.ts`
- Modify: `electron/main/photoshopTiffExport.ts`

- [x] **Step 1: Add failing coverage**

Add a test that imports `bitmapLayersForShot` from `electron/main/bitmapLayerOrdering.ts` and verifies image layers sort below paint layers while defaults are normalized.

- [x] **Step 2: Implement the helper**

Create `bitmapLayerOrdering.ts` with Electron-local types and `bitmapLayersForShot`.

- [x] **Step 3: Replace local duplicates**

Use the helper from `main.ts` and `photoshopTiffExport.ts`.

### Task 3: Preload Sync Check

**Files:**
- Create: `electron/preload/preloadSync.test.ts`
- Create: `scripts/check-preload-sync.mjs`
- Modify: `package.json`

- [x] **Step 1: Add failing coverage**

Add a Vitest test that runs `scripts/check-preload-sync.mjs` and expects it to succeed.

- [x] **Step 2: Implement the check**

Parse `preload.ts` and `preload.cjs`, compare exposed API keys and IPC channel strings, and fail on drift.

- [x] **Step 3: Add a script entry**

Add `check:preload` to `package.json`.

### Task 4: Structure-Only Cleanup

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `scripts/electron-bitmap-smoke.mjs`

- [x] **Step 1: CSS section marker**

Rename the dark-theme comment and add a short warning that this section overrides base styles.

- [x] **Step 2: Smoke section markers**

Add scenario section comments only. Do not alter assertions or CDP flow.

### Task 5: Verification

**Files:**
- No production file changes.

- [x] **Step 1: Run focused tests**

Run `npm run test -- electron/main/bitmapLayers.test.ts electron/preload/preloadSync.test.ts`.

- [x] **Step 2: Run full verification**

Run `npm run test`, `npm run typecheck`, and `npm run build`.

- [x] **Step 3: Run smoke if build changes dist**

Run `npm run smoke:bitmap` after build because smoke uses `dist` and `dist-electron`.
