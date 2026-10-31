# Drawing — wave 1 assignment

> Completed wave-one assignment, retained for scope and evidence interpretation. It does not restart the lane or authorize edits today.
> [Current navigation](../README.md).

## Outcome

Implement the standalone image-document editing Interface in CONTRACTS.md. A caller can change
layer structure/properties or adopt a new immutable pixel asset reference without React,
Electron, filesystem access, a storyboard project, or the old save-owner machinery.
This is the first foundation slice, not full extraction of the brush engine or GUI integration.

## Ownership and inputs

Write only `src/core/drawing/**`, DELIVERY.md and QUESTIONS.md. Import types from
`electron/shared/refactorV1.ts`; do not copy their definitions or edit that shared file.
Read relevant definitions/callers in src/shared/projectOps.ts, bitmapLayerCanvas.ts,
sketchRendering.ts, bitmapLayerPaintingController.ts, LayerPanel.tsx and their permitted tests.
Do not edit those production files. Existing gestures and algorithms are reference behavior,
not permission to invent replacements.

## Work sequence

1. Establish baseline and map current layer lock/order rules. Record ambiguities in QUESTIONS.md.
2. Add public-Interface tests for the cases below; implement applyImageEdit in index.ts and
   private helpers. Keep invalid-input handling deterministic and results immutable.
3. Create `src/core/drawing/EXTRACTION.md`: map existing brush, eraser, selection transform,
   blur, merge, matte/text overlay and rendering functions to their future owner. For each,
   identify DOM/React/filesystem dependencies, existing coverage and the remaining real-GUI
   check. This is an implementation navigation document, not a claim these features are extracted.
4. Freeze code, commit implementation, run focused/full/build via TESTING.md and deliver evidence.

## Required acceptance cases

- Insert/remove/move layers preserves exact final ordering; last-layer removal fails.
- Name/lock-only edits change metadata without claiming a visual change; visibility/opacity/
  blend and pixel reference changes mark visual impact. Values equal to the current ones are no-ops.
- Locked pixel replacement/removal fails; toggling visibility and lock remains possible.
- Invalid IDs, indices, sizes, opacity, modes, duplicate layers and missing targets return
  explicit errors. Validate runtime input, not only TypeScript types.
- before/input objects remain unchanged; edits preserve unrelated layer properties.
- Every actual edit increments image revision once; no-op/failure does not.
- Undo can restore exact prior metadata and asset references from before; no hidden I/O or
  independent undo stack is added. Mutating a newly returned changed structure must not
  accidentally mutate the input (document the immutable ownership contract for shared data).
- Run repeated synthetic operations on images with 5 and 100 layers; record workload and
  measurements as metadata-operation evidence only, not brush/rendering performance.

## Out of this wave

No PSD/Photocraft integration, new raster algorithm, tile format, Rust, canvas replacement,
production wiring or pixel-perfect GUI claims. If the shared contract prevents a required
behavior, propose the smallest amendment and mark the affected case blocked.

## Definition of done

All required cases are accounted for, focused tests + complete allowed suite + full build pass,
EXTRACTION.md is concrete, owned implementation is committed, DELIVERY.md points to raw logs
and the tested SHA. State explicitly that the current application still uses the old drawing path.
