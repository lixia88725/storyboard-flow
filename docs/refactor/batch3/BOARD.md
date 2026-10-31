# Board — Terra implementation task

> Completed batch-three lane brief, retained for acceptance requirements. It does not restart the lane or authorize edits today.
> [Current navigation](../README.md).

Read PLAN.md. Goal: extend the existing sole writable Session with active-board
insert/remove, group reorder, and atomic cross-shot dialogue moves, keeping pixels,
Pending and history coherent. No UI implementation in this lane.

Read existing core storyboard/history/session definitions and their callers first.
Add only necessary command-union variants in the two permitted shared files; do not
change ProjectV1 schema or other shared contracts. Reuse existing insertShot/removeShots
and moveShots rules; add one atomic moveDialogues command with explicit target/order
semantics matching current projectOps/dialogue behavior. Caller chooses IDs; no filesystem
or random-ID effects in pure Board. Write interface semantics beside exported commands.

For Session insertion, references must be genuinely readable from its asset depot, fully
decoded/dimension-valid at prior depot admission; do not allow renderer-fabricated image
results or unadmitted assets to become current. If that requires a new trusted receipt
contract outside scope, document the exact gap and deliver the other commands rather
than inventing a bypass. Removal retains images/assets needed by Undo; no physical delete.
Active-only scope: Pending materialization is coordinator-owned and remains unchanged.

Required public-interface tests: single/multiple deletion and exact Undo/Redo; ordered
group move both directions and end position; insertion validation and missing-asset
failure without state/history mutation; cross-shot dialogue move all-or-nothing,
stable IDs/order, invalid/duplicate/missing selections and parked targets rejected;
one Undo for a dialogue move; no-op no history; caller input mutation during awaits;
paint/Undo/freeze queue barriers preserved; failure leaves current/checkpoint honest.
Use real checkpoint/depot composition for insert/remove/reopen where feasible with
synthetic PNGs. No GUI claims. Focused: src/core/storyboard and src/core/session.
Deliver BOARD-DELIVERY.md / BOARD-QUESTIONS.md; stop after this batch.
