# G3 project switching — 2026-10-31

Implementation candidate: `dfccac1d6f47a20d2e8cfa8a9534d75990912821` on original main.
Status: implemented and self-tested within the isolated editor; independent acceptance
and complete G3 remain open. Default App/launcher is unchanged.

## Behavior

- Open project waits for real TIFF Save settlement and Session freeze/checkpoint.
- Main prepares the selected project before certifying/sealing the prior runtime;
  cancel, same-root selection and failed preparation retain the prior Session/history.
- Each read, put, checkpoint, TIFF Save and Close has an explicit session token.
  Copied projects sharing a project ID and A/B/A reopening do not revive old tokens.
- A fresh keyed editor resets view/cache/receipt state. Late retired image loads cannot
  allocate Blob URLs or change current status; unmount revokes prior URLs.
- Close waits for switching, then certifies the selected owner. Switching is not TIFF Save.
- Reopening restores durable content with a fresh session, not prior-session Undo history.

Architecture and failure behavior: `../../PROJECT-SWITCHING.md`.

## Verification

Clean unchanged candidate for final build, full suite and all GUI evidence.

| Check | Result | Raw evidence |
| --- | --- | --- |
| Focused workspace/runtime/preload | 3 files / 10 tests pass during development | `/tmp/flow-switch-focused.log` |
| Complete build | exit 0, both typechecks + Vite + Electron | `.hermes/evidence/20261031T024359.952599Z-build/` |
| Complete allowed suite | 385 files / 2911 tests, exit 0, 1180.832 s | `.hermes/evidence/20261031T024418.398645Z-full/` |
| Preload consistency | pass | `npm run check:preload`; dedicated TS/CJS argument parity also tested |
| Switching Electron | 7 cases, exit 0, certified normal Close | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-RXNb67/receipt.json` |
| TIFF import regression | 13 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-import-smoke-VisUYa/receipt.json` |
| Existing editor regression | 42 cases, exit 0 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-j9P3xy/receipt.json` |

Switching scenarios: cancel; invalid folder then retained Undo/Redo; delayed TIFF Save
before switch; real IPC refusal of stale asset read/put/checkpoint/Save for same-ID copied
projects; B editing without A changes; A reopening with retained content/new token; Close
during delayed Save/switch. Existing GUI regression includes actual pointer drawing,
layer editing, Pending, grid/Japanese views, Save, normal Close and fresh-process reopen.

An initial development smoke driver had a generated JavaScript quoting error. Only its
owned Electron process was stopped; evidence remains in `flow-switch-smoke-kM4j4t` under
the same temporary parent. Driver syntax checking was added before Electron launch;
corrected development and final clean-candidate runs passed. No assertion was weakened.

## Limits and retained work

Native chooser results are scripted, not native picker clicking. macOS only; Windows,
installer and 1000-image large-raster performance are not verified. Tests use generated
media/private userData with clipboard and Trash blocked; no personal projects touched.
Temporary evidence is retained. No new worktrees, dependencies, push or old-code deletion.
The three pre-existing worktrees remain unchanged. Ordered Save filenames, exported-shot
Trash deletion, external TIFF refresh, remaining tools and production integration remain
subsequent gates. Full G3 and independent acceptance are not claimed.
