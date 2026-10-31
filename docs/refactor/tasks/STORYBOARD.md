# Storyboard — wave 1 assignment

> Completed wave-one assignment, retained for scope and evidence interpretation. It does not restart the lane or authorize edits today.
> [Current navigation](../README.md).

## Outcome

Implement a pure project editing Module and one project history facade using CONTRACTS.md.
Both grid and Japanese views will use it later; this wave has no React or view-specific state.

## Ownership and inputs

Write only `src/core/storyboard/**`, DELIVERY.md and QUESTIONS.md. Import shared types from
electron/shared/refactorV1.ts. Read current projectOps.ts, dialogueActionController.ts,
storyboardDragEndController.ts, projectHistoryController.ts, JapaneseStoryboardView.tsx and
their relevant permitted tests. Do not edit old production code, shared contracts or other lanes.

## Work sequence

1. Establish baseline; identify existing order/dialogue/Pending and history semantics.
2. Implement applyStoryboardEdit plus a bounded project history facade through index.ts.
   Tests exercise the facade as a caller would, including drawing-edit envelopes supplied
   as typed fixture data. Do not import a sibling lane or invent a second drawing implementation.
3. Implement a pure helper selecting preceding active image references for onion skin by
   current shot ID and requested count. No rendering, animation policy or filesystem operations.
4. Add `src/core/storyboard/INTEGRATION.md` mapping both views, Pending and history callers to
   the future Interface. Record excluded existing-feature fields and integration work explicitly.
5. Freeze, commit, run TESTING.md final checks and report.

## Required acceptance cases

- Insert, delete, reorder a contiguous and noncontiguous multi-selection, move to/from Pending,
  and destination edge cases preserve unrelated shots and their dialogue/image identity.
- Text is Unicode; editing script text or dialogue does not mutate pixels or unrelated text.
- No-op/failure creates no history and increments no revision. Invalid IDs and references fail.
- Apply drawing result only when its full before image matches current data; reject stale results
  even when an old revision number happens to match after undo (ABA case).
- Mixed image edit, text edit and reorder undo/redo in exact user order. A new edit after undo
  drops redo. History capacity eviction is bounded and does not corrupt the current state.
- Undo/redo restores content with new project revisions; retained image/asset references survive
  deletion and undo. No filesystem deletion or serialization on every pointer event.
- Active and parked membership is disjoint; dialogue IDs and image/shot bindings remain valid.
- Two hypothetical views reading the same snapshot see identical order/text; do not claim GUI
  coverage from this pure model test.
- Onion skin uses active order, handles first/missing/current IDs deterministically, excludes
  Pending, and changes neighbors after reorder without modifying drawing documents.
- A 1,000-shot synthetic project supports reorder, text edit and undo correctly. Record bounded
  metadata workload timings and memory where measurable; no UI frame-rate claim.

## Definition of done

All cases covered through the public Interface; no dependency on React, DOM, Node filesystem or
the other lane's implementation. Focused/full/build pass, implementation committed, integration
map and DELIVERY.md identify exact evidence and the fact that production views are not wired yet.
