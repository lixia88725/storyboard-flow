# G3 ordered Save naming — 2026-10-31

Final implementation candidate: `bba2bb51da35bbce73d1534b2b8c6000490ce7da`.
Implementation commits: `7b62ce3`, `b0496d6`, `bba2bb5`. Coordinator on original main;
local only, no push, production route or launcher change.

## Result

User confirmed retaining project/scene/stb/artist/version/0010 naming and settings.
Project naming is one Board/history edit; checkpoint preserves it. New TIFF imports
initialize scene/artist/v001. Naming Apply/Undo/Redo remains logical; Save alone emits
ordered active TIFF filenames. Pending retains its names, reserving those names from
active numbering. Original backups remain bound to stable shot IDs.

The output ledger records an identity/digest-bound two-stage rename. All sources stage
before final names publish, supporting cycles/case-only renames. Reorder alone preserves
TIFF bytes/inodes without PNG reads or raster encoding. Failures retain a resumable
journal and return no successful receipt; retry finishes the recorded intent first.
Shared 8 MiB read/write limits and conservative reservation refuse oversized plans before
new output effects. See [naming contract](../../SAVE-NAMING.md) for exact scope/limits.

## Independent review and corrections

An internal sub-agent independently reviewed the committed protocol and found three
issues: case-insensitive shot-ID uniqueness could poison a valid a/A journal; a large
journal could exceed its own reader limit; unchanged active names skipped folded-name
collision checks. All three were corrected with regressions. The reviewer rechecked the
scoped fixes read-only and found no new blocker. This is code review, not independent
GUI/platform or whole-application acceptance.

The prior full suite on `b0496d6` was deliberately stopped after these findings using
only its identified owned npm/Vitest process group. The runner observed exit -15, wrote
its receipt and released its own slot. No shared lock was removed manually. Retained:
`.hermes/evidence/20261031T032229.997479Z-full/`; it is not a PASS. Earlier build/GUI
receipts on superseded candidates are development evidence only.

## Final evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Complete build | exit 0, both typechecks + Vite + Electron | `.hermes/evidence/20261031T032726.238547Z-build/` |
| Complete allowed suite | 386 files / 2922 tests, exit 0, 1206.228 s | `.hermes/evidence/20261031T032759.156826Z-full/` |
| Focused reviewed fixes | 2 files / 21 tests pass before final commit | `/tmp/flow-naming-review-fixes.log` |
| Naming/switch Electron | 9 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-bSZOX2/receipt.json` |
| TIFF import regression | 13 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-efHNob/receipt.json` |
| Existing editor regression | 42 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-j2A9zE/receipt.json` |

All final build/full/GUI receipts identify the same unchanged clean candidate. Real GUI
covers applying all naming fields, one-step Undo/Redo, metadata checkpoint without early
rename, actual ordered filename publication, Pending names, delayed Save/switch/Close,
TIFF raw-pixel roundtrip and relocated-folder reopening. Focused filesystem tests cover
swapping filenames with preserved inodes, no raster reread/encoding, foreign collisions,
interrupted stage/publish recovery, poisoned identity refusal, case-sensitive shot IDs
and conservative long-name batch admission. The folded-directory policy regression uses
a listing stub on macOS; it does not claim a real case-sensitive-volume test.

## Remaining scope

Implemented, self-tested and bounded code-reviewed. Full G3, default production-shell
integration and independent application acceptance remain open. Exported-shot deletion
to Trash, external TIFF refresh and remaining tools are subsequent gates. Windows,
FAT/exFAT, installer, native picker clicking, representative 1000-image raster performance
and crash/power-loss durability remain unverified. All tests use owned synthetic media
and isolated userData; clipboard/Trash are blocked in GUI harnesses. No dependencies,
old implementation/scripts/worktrees or personal files were removed.

Documentation cleanup was separately integrated as `038f148` and `ef42d29`, preserving
exact root history and adding current navigation. Its independent document review is
recorded in [cleanup report](../../../maintenance/CLEANUP-REVIEW.md); it is not runtime
verification. The cleanup worktree remains clean and retained with its local branch.
