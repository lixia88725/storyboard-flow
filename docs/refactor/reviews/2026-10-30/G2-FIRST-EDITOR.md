# G2 first connected editor — 2026-10-30

Status: implemented and self-tested on `b1f1cffb42aaf8c8e88c62803bcf3d3ccd650f28`.
Full production G2 / independent acceptance / publication are not claimed.
Coordinator worked on original main after all three agent worktrees were retired.
No new agents/worktrees, dependencies, personal media, default launcher changes or push.

## Scope

A dedicated new-format entry composes the accepted Session, Canvas pixels, asset depot
and checkpoint store with existing SketchPad, LayerPanel and static-media components.
It uses a small editor host for this bounded first workflow, not the complete production
App/grid/Japanese view. Normal startup remains RecoveryEntry/App with its original
preload and Save/Close path. Existing test projects are not migrated.

The dedicated entry takes an existing checkpoint root and separate userData path:
`electron dist-electron/main/flowEditorEntry.js <absolute-project-root> <absolute-userData>`.
It is development source wiring, not a packaged or default user-facing workflow.
The repeatable synthetic exercise is `node scripts/flow-editor-smoke.mjs` after build;
it makes four active shots plus one Pending, each with three bitmap layers.

Session is the only writable project/history. The old Shot shape is a read-only view
projection. Layer selection and opacity-drag previews are transient view state.
An opacity gesture commits once when released; it does not add one history entry for
each pointermove. New immutable pixels are admitted by Main before Session publishes.
Delayed preview completion checks the current layer asset after awaiting its read.
Identical PNGs may be shared between layers; projection identities keep these layers
separate despite the old view's file-path deduplication.

MediaSourceContext supplies the new immutable asset URLs to the existing components;
the default adapter still uses the old preload URLs. The dedicated preload exposes
only bootstrap, asset read/put, checkpoint and Close handshake. Typed/CJS forms have
an executable parity/subscription test. Normal preload surface is unchanged.

Main binds the root and renderer/main frame/document URL. Window close asks the renderer
to stop admission and flush; active drawing/opacity gestures refuse Close. Main then
checks original root identity, exact persisted project and every referenced asset via
the original depot binding before closing. Missing/corrupt assets or mismatch keep the
window open. Reload is not a substitute for a certified Close. This bounded Close gate
handles only this one isolated new-format window, not the production multi-slot system.

## Evidence

Implementation commits: 60e8629, 8f28b26, b1f1cff (final candidate).
Focused tests cover root replacement, corruption, exact checkpoint/Close, sealed writes,
projection asset deduplication, unscaled strokes, delayed preview invalidation and
preload parity. Existing rendering/static-media tests also pass.

Real Electron workflow exercised Chinese text, pointer drag reorder, actual SketchPad
paint, LayerPanel opacity drag, Undo twice/Redo twice, checkpoint, normal Close,
new-process reopen, continued eraser editing and Undo, and refusal to close mid-stroke.
Screenshots and exact project/PNG evidence are retained. Final-candidate run passed all 11 recorded cases; both processes exited 0 after certified
Close. Receipt, screenshots and logs: `.hermes/g2/final-gui/`; synthetic project and
raw outputs: `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-wusxj3/`.
The opacity exercise sends three pointermoves then verifies one Undo restores its
original opacity. Screenshots were inspected; restored pixels match their exact asset
identity. PNGs were decoded and checked to contain painted alpha.

Final complete allowed suite: **379 files / 2829 tests passed**, exit 0, 1329.964 seconds.
Receipt/log: `.hermes/evidence/20261030T063547.901150Z-full/`.
Complete build: **passed**, exit 0, 11.478 seconds, both typechecks included;
`.hermes/evidence/20261030T063439.359473Z-build/`.
Both have identical candidate HEAD and clean status before/after. Normal preload
consistency check passed (`.hermes/g2/preload-final.log`); the dedicated preload's
executable TS/CJS parity test passed in the full suite. `git diff --check` passed.

Original superseded full invocation:
`.hermes/evidence/20261030T061038.723203Z-full/`; it began at 60e8629 and spans later
source refinements. It also exited 0 (379 files / 2829 tests), but is not frozen
final-candidate evidence; the clean-HEAD final run above supersedes that gap.
Earlier failures remain in `.hermes/g2/`: missing canonical temporary root, first
Close corruption assertion, shared-PNG layer projection failure, and a smoke-script
selector quoting failure. No assertion was removed to obtain a pass.

## Remaining gates

This is a self-tested first connected slice, not independent acceptance of the complete
application. Existing component reuse does not certify preservation of all App behavior.
The host does not yet implement the production toolbar/layout, Japanese view, full
selection/navigation, grouped layer edits, structural layer tools, fill/blur/transforms,
Pending moves, TIFF Import/Save, output receipts or multi-project lifecycle. Disabled
structural controls are explicit; unsupported callbacks report failure, not success.

Undo remains session-local; persistent history is not claimed. The simple asset URL
cache eagerly loads retained images and keeps its URLs for the editor lifetime; it is
not a thousand-shot cache or process-memory policy. Resource scheduling/virtualization,
large-raster and M1/32GB measurements belong to G5. Windows, installers, crash/power-loss,
real Photoshop and hostile cross-process filesystem mutation remain unverified.

Next integrate the established application shell and remaining command adapters, then
G3 TIFF/outputs. Preserve the three states: current content, editable checkpoint and
explicit TIFF output. Only replace old owners once connected positive/negative cases
prove their replacement; this batch does not delete old protection or old code paths.
