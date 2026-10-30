# G2 Board editing workflow — 2026-10-30

Final candidate: 9cdfda3 (main; implementation 3adc464 plus initial Shift-anchor fix).
Bounded implementation and self-testing complete; final full suite passed.
This is an isolated new-format editor, not production routing or independent acceptance.

## Behavior

Session newShot serializes capture/preflight -> bounded opaque-white Canvas PNG ->
actual asset depot admission/bound receipt -> one Board insertion/history entry. Failed
production/admission never installs a partial shot. Undo/freeze queue behind creation.
Current shot dimensions are inherited; an empty board defaults to 1920x1080. One editable
paint layer is created; source TIFF/output naming is not materialized by this command.

The editor shares UI-only selection across grid and Japanese presentations. Cmd/Ctrl
click toggles membership, Shift selects a board-order range from its anchor (initially
first shot). Dragging a selected shot moves its selected group in original board order;
dropping within the group is a no-op. Move-to-end and group deletion each issue one Board
command. Deletion retains immutable assets/images for Undo, without physical removal.

Per-dialogue transfer controls in both presentations move the stable dialogue ID to
another active shot, before a target dialogue or to its end, via the existing atomic
moveDialogues command. No replacement ID or delete/add pair. Existing textarea editing
remains. JapaneseStoryboardView's optional transfer rendering leaves existing callers
unchanged; default App, launch script, preload and production TIFF paths are untouched.

## Evidence

- Focused development: 6 files / 139 tests pass, .hermes/board-editor/focused-development.log.
  New coverage: real PNG/depot/checkpoint creation + Undo/Redo/reopen, empty first shot,
  failed producer, invalid identities/anchors, forged receipt, mutation and Undo/freeze
  during await; selection ranges/toggle/drag order and deleted identities.
- Final complete build: exit 0, .hermes/evidence/20261030T151537.838095Z-build/.
- Final full allowed suite: 382 files / 2885 tests passed, exit 0, 1189.197 seconds;
  .hermes/evidence/20261030T151558.409810Z-full/. Full/build receipts record clean,
  unchanged final candidate before/after; no failed or skipped tests.
- Real two-process isolated Electron: node scripts/flow-editor-smoke.mjs; final clean
  candidate receipt /private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-1PtDkH/receipt.json.
  31 cases pass, including all prior 22 cases. New: initial Shift range, actual group
  pointer drag/order, selection shared with Japanese view, move-to-end and group deletion
  with one Undo, stable dialogue identity transfer/Undo/Redo, empty-board first-shot
  default size/Undo, new-shot actual drawing/Undo, checkpoint and fresh-process reopen.
  Parent decodes saved blank PNG and verifies every RGBA byte is 255. Final manifest
  matches pre-close snapshot; original shot remains editable on reopen. Screenshots inspected.
  Modifier-click and dialogue-drop coverage use DOM MouseEvent/DataTransfer events;
  group reorder and drawing use Electron pointer input. OS-level dialogue drag remains
  TODO: verify, and these checks do not certify IME or cross-platform behavior.
- Initial GUI run failed on test-script query quoting, not a product assertion; preserved
  flow-editor-smoke-wdXGeP under the same temp parent. Corrected development passes:
  flow-editor-smoke-rKQPZo and flow-editor-smoke-WLuM8X. Earlier build evidence remains.

No personal media, dependency installation, push, worktree cleanup, default routing or
old-code deletion. Existing three worktrees retained. Subsequent gates: TIFF source
binding/first backups/explicit Save/Pending lifecycle; structural layer tools, blur,
selection transforms and full application-shell parity; Windows/scale/installers and
independent acceptance. This bounded Board workflow does not certify all legacy UI.
