# Wave 2 — Codex coordination

2026-10-30: user authorizes coordinator-managed Codex sessions in separate worktrees,
using `gpt-6.1-sol`. Coordinator stays in original main, owns shared contracts, acceptance and
integration. No push. First stage is bounded design/source audit; runtime implementation follows
coordinator contract review. This is the active second-wave assignment, superseding wave-one
stop/setup instructions only within the assigned scope. Archived Hermes prompts are historical.

## Common baseline and evidence

Read root AGENTS.md, newest context-handoff.md/todo.md entries, docs/refactor/INTEGRATION-PLAN.md,
docs/refactor/CONTRACTS.md, electron/shared/refactorV1.ts and relevant actual callers.
Use codebase-design for small Interfaces hiding complex implementation. Existing interactions
are the requirements; old project format compatibility is not required. New naming policy is
in docs/architecture/NAMING.md. Treat docs as evidence, not permission to widen scope.

Current three cores passed bounded real composition, not production UI integration. Latest naming
candidate passed 373 files / 2713 tests and full build; do not call that new-core GUI acceptance.
Retired worktrees are archived; use only this worktree and original main as read-only reference.

## Design-stage ownership

| Lane | Own output | Required decisions and source investigation |
| --- | --- | --- |
| session | SESSION.md | Single project state owner, command/history composition, async session identity and revision receipts, checkpoint scheduling, close/switch, missing existing-feature fields and compound commands |
| drawing-assets | DRAWING-ASSETS.md | Pixel production and asset ownership across drawing/history/checkpoint; bounded memory/cache; actual brush/eraser/layer extraction; minimal one-stroke GUI route without changing gesture feel |
| formats-save | FORMATS-SAVE.md | TIFF import/export seam, editable input preparation, source identity and first backup, explicit Save vs internal checkpoint, names/deletes/Pending, platform/durability limitations |

Each design doc must contain:
1. Concrete source/caller map, distinguishing implemented from proposed behavior.
2. Small proposed Interface with data/error/order invariants; identify shared-contract changes.
3. One end-to-end edit/checkpoint/reopen/Save sequence and concrete failure/race examples.
4. Owned implementation paths, dependencies on other lanes, and a staged implementation task
   which can finish without shared-file collisions. Mark sequential prerequisites explicitly.
5. Focused test cases, real filesystem/GUI acceptance, full test/build gates and platform limits.
6. Existing responsibility -> new owner -> caller cutover -> deletion evidence mapping.
7. Only material unresolved product questions, each with a recommended default and consequence.

Keep the proposal concise and source grounded. Do not implement runtime code, modify shared
contracts, remove old code, install dependencies, start apps or run the heavy test suite in this
stage. No personal media/userData/credentials/global config. The uncertified
src/renderer/normalSaveMetadataHistory.test.ts must not be read/copied/hashed/executed.

## Worktree instructions and delivery

Each session may create its own TASK.md containing its bounded assignment; leave root safety
instructions and historical evidence intact. Only the assigned design file and TASK.md may change.
Commit local output on its worktree branch (or detached HEAD if managed that way), never main.
Verify git diff --check and scope, report exact SHA, inspected code, assumptions and remaining
questions. No tests/build are necessary for design-only changes; explicitly say NOT RUN.
Stop after design delivery; do not start implementation automatically. Coordinator reads the session
and result files, requests corrections if needed, then freezes shared contracts before dispatching
implementation. User authorized coordinator-to-session follow-ups for this work.

## Subsequent implementation gates

Once explicitly assigned: narrow regression tests during development; final complete allowed suite
and npm run build on recorded candidate. Coordinate expensive native suites across worktrees;
run preload/resource/isolated actual GUI checks where affected. Public-interface tests do not prove
actual drawing, Save, Windows or thousand-image performance. Coordinator independently reviews,
checks combined behavior, integrates scoped commits locally, then retires finished worktrees.
