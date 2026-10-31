# Dual-panel workbench prototype — 2026-10-31

Candidate: `ebc8a2c70cba4a474744c3be0403d0a35171e809`, original `main`.
Coordinator-owned implementation; no new worker/worktree, dependency, default routing,
launcher change, personal media or push. Existing worktrees are retained unchanged.

## Implemented scope

An opt-in `--workbench` argument to the isolated Electron entry selects `#flow-workbench`.
The classic isolated editor also exposes a Workspace button. Both use the same Session,
asset admission, history, checkpoint and explicit TIFF Save implementation.

Five dockable/hideable/resizable panels: board, canvas, text, layers and Pending. Grid
picture regions draw; headers select/sort. Earliest selected active shot drives the canvas.
A stroke selects its own shot. Left/right single-select adjacent active shots and stop at
edges; text fields keep their arrows. Unsettled strokes block navigation. Live strokes are
mirrored between grid and viewer before release without per-move PNG serialization.

Visible active/Pending cards and current/onion references request assets. Grid rasters
unmount offscreen; at most the hovered grid canvas plus the main canvas are editable.
Unused Blob URLs can leave a 96-entry cache. This is not a decoded-byte guarantee or full
row virtualization. The UI still creates lightweight DOM for all cards.

## Verification receipts

- Focused adapter/selection tests: 2 files / 6 tests, exit 0;
  `/tmp/flow-workbench-focused.log`.
- Complete build: exit 0, 10.429s, both typechecks/Vite/Electron;
  `.hermes/evidence/20261031T155750.686560Z-build/`.
- Complete approved suite: 392 files / 3003 tests, exit 0, 1303.401s;
  `.hermes/evidence/20261031T153425.926163Z-full/`. Both runner receipts record the
  same clean candidate before/after. The following report commit changes documentation only.
- Final small-project workbench: 17 cases, real paint in both directions, pre-release
  mirror pixels, multi-selection/navigation, header pointer reorder/Undo, panel hide/reset,
  docking, divider, text arrows, Pending/Undo, explicit TIFF Save, normal Close/reopen.
  `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-workbench-smoke-mjAfw6/`.
- Final 1,000-active + 1-Pending workbench: 17 cases, same core interaction path and
  bounded visible raster/canvas assertions. This scale variant intentionally skips TIFF
  output; small fixture above covers it.
  `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-workbench-smoke-Wogg3l/`.
- Protected classic editor: 42 cases, `flow-editor-smoke-wdWa45/`.
- Protected opacity: 26 cases, `flow-opacity-smoke-xWyQTk/`.
- Protected selection: 23 cases, `flow-selection-smoke-SfTNVM/`.
- Protected switch: 9 cases, `flow-switch-smoke-svPYh5/`.
- Protected presentation: 19 cases, `flow-presentation-smoke-M4BnOO/`.
  These five directories share the system-temp parent used above; receipts name the clean
  candidate. No GUI smokes ran concurrently. Panel docking uses a synthetic native DragEvent;
  board sorting and painting use Electron pointer events. This is self-test, not independent
  human/pen/tablet/platform acceptance.

## Early scale measurements

Synthetic 640×360 solid-color bases plus transparent paint layers, local macOS test host,
with full native regression also running. Not the reference-machine acceptance benchmark.

| Phase | Open to saved/viewer ready | Distinct assets requested | Editable canvases | Grid raster img nodes |
| --- | ---: | ---: | ---: | ---: |
| Edit, 1,000 active | 3,399 ms | 16 | 2 | 18 |
| Reopen, 1,000 active | 3,359 ms | 12 | 1 | 18 |

All 1,000 lightweight card nodes remain. The reported JS heap is approximate and excludes
native decoded-image/GPU memory; do not call it the application's memory budget. These
measurements do not prove smooth 4K/many-layer painting, scrolling every image, Windows,
32-GB M1 performance, storage relocation or installers.

## Failures retained and fixes

The first generated smoke driver had nested-quote syntax errors and was stopped before
any test ran; only its own identified Electron PID was terminated. The driver now runs
`node --check` before launch. A readiness selector then found an inner status region;
scoping it to the workbench footer fixed that harness precondition.

Visual inspection caught an empty card after reorder. Re-observing card intersection when
its ordered index changes fixes the stale observation; a visible-image assertion now checks
it. Thousand-card pointer sorting initially failed with a fixed 65-ms event schedule. The
driver now waits for actual drag activation and movement before dropping; both final sizes
pass without reducing ordering assertions. Earlier failures remain in their temp directories
and `/tmp/flow-workbench-*` logs. These failures are not counted as PASS.

## Boundaries and next steps

Layout is transient. Launch with `--workbench` to keep this route across project switching;
the classic Workspace shortcut is scoped to its current Editor and resets on a new Session.
This shortcut limitation remains prototype polish, not production routing.
 New-workbench Japanese mode and all legacy presentation/tool access,
Markdown export, durable layout preferences, further keyboard/pen UX and representative
large-raster profiling remain. Classic functions retained elsewhere are not claimed as new
workbench parity. Default production App and launcher remain unchanged. Independent full
application acceptance and production rollout are still open.

The fresh user preview is `.hermes/previews/interaction-6xVMhW/` with separate project and
userData; the previous preview was not changed or closed. Preview edits may be user-owned:
never reset that folder as part of a later test rerun.
