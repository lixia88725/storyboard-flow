# G3 explicit Save deletion to system Trash — 2026-10-31

Implementation candidate: `8385b1f1afc391c2e56e57c21d65bc7f58fa1ac1`.
Coordinator on original main; local only, no push, launcher/default App change,
dependency installation, old-worktree deletion or personal-media access.

## Behavior

Board deletion stays logical until explicit Save. Save preserves the first original,
records a durable identity/digest-bound deletion intent, stages the exact owned TIFF,
and invokes Main's system Trash capability. An OS failure retains evidence and returns
no successful Save receipt. Retry finishes recorded intent without re-sending confirmed
files. Active and Pending output are supported. A never-published absent output retires
without claiming a Trash effect.

Retired output names become available for ordered numbering. Undo then Save regenerates
TIFFs from retained internal PNG assets through a fresh intermediate filename; it never
reads Trash. Original backups remain unchanged. In-process OS ACKs survive confirmation
write failures, and prevent Close/project switch until made durable. Read the
[output protocol](../../OUTPUT-TRASH.md) for exact phases and limits.

## Independent review

The existing read-only reviewer checked protocol, filesystem ownership, retry, ACK
retention, Close guard and restore/name reuse. It found a fixed intermediate restore
name could unnecessarily block Undo when reused by a foreign file. The candidate uses
a nonce name, with a regression proving the foreign file remains byte-exact while
ordered restore succeeds. Follow-up review passed this fix and the runtime
ACK-write-failure/Close/retry test. This is independent code/test-design review, not
independent execution or whole-application acceptance.

## Verification

Final build/full/GUI receipts identify this same clean unchanged candidate. Both runner
receipts confirm unchanged HEAD and empty Git status before and after execution.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused protocol/output/runtime | 35 tests pass across 3 files before commit | `/tmp/flow-trash-focused-final.log`, `/tmp/flow-trash-output-final.log` (19 final output tests supersede the earlier 17) |
| Complete allowed suite | 387 files / 2939 tests, exit 0, 1225.896 s | `.hermes/evidence/20261031T040704.958010Z-full/` |
| Complete build | exit 0, both typechecks + Vite + Electron, 9.998 s | `.hermes/evidence/20261031T042741.306349Z-build/` |
| Existing real editor | 42 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-jPyTdd/receipt.json` |
| TIFF import/reopen | 13 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-2mCw2z/receipt.json` |
| Naming/project switch | 9 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-Efuuj2/receipt.json` |
| Native Trash UI | 10 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-I6lqZy/receipt.json` |

The 74 real Electron scenarios include native Trash on only generated fixture TIFFs,
scripted refusal before dispatch, retained staging, successful retry, original backups,
Undo regeneration with decoded layered pixels/text, fresh-process reopen, prior Pending,
drawing, naming and project-switch workflows. Fixture identities and source hashes are
checked before native Trash. Personal Trash is never enumerated. Synthetic trashed TIFFs
are intentionally retained in system Trash; temporary evidence/userData are retained at
the listed paths. Existing regression harnesses continue to forbid Trash and clipboard.

An initial development GUI run timed out because its status-selector string was escaped
incorrectly; the product had saved successfully. Retained failure evidence:
`/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-trash-smoke-uUoPfG/`.
The harness selector was corrected before candidate freeze; this failed run is not PASS.

## Remaining boundary

Implemented and coordinator-tested with scoped independent code review. The default
production App remains unchanged; full G3 and independent application acceptance remain
open. Windows, removable/network volumes, installers, representative large-raster
performance, hostile concurrent writers and arbitrary crash/power-loss recovery remain
uncertified. If a process dies after OS success but before confirmation is durable,
reopen reports an unknown outcome and refuses a Save ACK; there is no recovery UI in
this slice. No automatic asset/tombstone/staging GC. External TIFF refresh/conflict and
remaining interchange/tools are subsequent work.
