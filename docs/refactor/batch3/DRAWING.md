# Drawing — Terra implementation task

> Completed batch-three lane brief, retained for acceptance requirements. It does not restart the lane or authorize edits today.
> [Current navigation](../README.md).

Read PLAN.md. First bounded slice: real fill and clear-layer pixel production, plus
a layer-composite/merge preparation operation, independently testable through the
drawing module. Keep current brush/eraser FlowPixels interface and feel unchanged.
Blur and selection transforms remain later batches, not implied completion.

Read existing bitmapLayerCanvas/painting/actions and sketch helpers for expected behavior.
Reuse proven algorithms where appropriate without mutating old production owners.
Expose a small module-local interface that snapshots source image/request, reads immutable
PNG assets, returns PNG bytes and explicit metadata needed for coordinator Session adoption.
It must not install project state, mint authoritative asset IDs, persist files or invent
successful Session receipts. A merge preparation must clearly identify captured source
revision/layers and resulting image edit plan so coordinator can validate baseline and
admit output before one history entry. If shared-contract changes are needed, document them.

Cover fill semantics (contiguous region, transparency, coordinates/tolerance supported),
clear transparency, hidden/locked/nonexistent target behavior, compositing order,
opacity and normal/multiply/screen, malformed PNG/dimensions, input mutation during await,
allocation/PNG limits, and resource release on success/failure. Preserve existing brush/
eraser checks. Tests must include actual isolated Electron Canvas pixel output with
synthetic inputs and per-pixel/hash assertions, not only mocked Canvas. You may add a
smoke harness inside src/renderer/drawing/ (owned path), reuse installed Electron.
No real userData/network/clipboard/Trash; owned process must close normally.

Focused: src/renderer/drawing and src/core/drawing. Full/build via PLAN runner.
Deliver DRAWING-DELIVERY.md / DRAWING-QUESTIONS.md with concrete adoption examples and
unimplemented tools explicitly listed. No UI wiring or complete Drawing claim.
