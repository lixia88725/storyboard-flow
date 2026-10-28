# Storyboard Flow — source integration handoff

## Image browsing and new-folder Import — 2026-10-28

Delivery: the user requested committing and pushing these source changes on 2026-10-28. Use Git history/remote status for the delivery result; the verification limits below still apply and do not certify the generated test builds.

This supersedes the earlier old-project *refusal UI* below, not the decision to retire legacy equivalence migration.

- User clarified that opening an old folder must still display its pictures, and explicitly chose conversion into a **new folder**, preserving the original project and images.
- Added a separate root-image browser for legacy/uneditable folders and formats needing conversion: PNG/JPEG/TIFF/WebP/GIF/AVIF. Memory previews do not write caches or traverse old internal layers. Current projects and fresh ordinary PNG/JPEG/TIFF folders keep their existing Open/Import workflow. Refused normal Open can fall back to readable images without a Save-failed modal.
- `Import to new project…` asks for an outside destination parent, makes a unique child directory, copies flattened visible image pixels to PNG, then uses the existing Import in a staging slot to create owned TIFF/layers and durable metadata before publication. No old dialogue, script or editable-layer migration; animated images use their first frame. Cancel writes nothing; failed preparation retains partial copies only in the new directory and reports their location.
- Fixed first-Import directory observation: TIFF preparation now uses existing `mkdirObserved` for its own metadata-parent creation. Identity replacement refusals remain tested, not bypassed.
- Source: `FolderImageBrowser.tsx`, `folderImageBrowserService.ts`, `ipc/folderImageBrowserHandlers.ts`, shared `folderImages.ts`, App routing, synced preload interfaces. Tests cover source preservation, formats, cancellation, malformed metadata, unreadable images, routing races and staging Import. The existing bitmap smoke legacy scenario now asserts decoded previews and unchanged original files rather than blanket refusal.
- Final expanded regression: **166 files / 1393 tests passed**. Explicit typecheck, build (renderer and Electron), preload consistency and smoke syntax checks passed. Full allowed test run completed with **344 files passed / 6 failed; 2487 tests passed / 7 failed**, plus the rejected promise from the old App test fixture. Three failures were outdated callback bindings/error-channel expectations corrected during that run and passed in the expanded rerun. Four memory tests hit `RAM_ADMISSION`: sandboxed `sysctl` returned Operation not permitted, while the same read-only query outside the sandbox returned valid normal-pressure readings. No production memory policy was loosened. Final rerun of all six failed files outside the sandbox: **6 files / 104 tests passed**, no unhandled errors. There has not been a second complete-suite run on the final source.
- Actual isolated Electron GUI passed old-folder browse (2 decoded images, no Save modal) → Import → owned TIFF/layers/durable JSON in the new directory; source TIFF/PNG hashes and JSON unchanged. Native destination dialog used a test-only chooser returning a synthetic destination; renderer, preload, Main and Import were real. Screenshot inspected. Test app was force-stopped only after assertions; this does not verify clean Close. No personal userData, clipboard or Trash touched.
- Read-only check of the user's supplied `S25V0_lixia`: all 40 root images decoded with the new preview service; project JSON unchanged. No real conversion or source write was performed.
- Logs/fixtures: `/private/tmp/storyboard-browse.i4jQnX/`: `regression-final.log`, `build-final.log`, `typecheck-final.log`, `preload-final.log`, `full-suite.log`, `native-memory-rerun.log`, `full-failures-rerun.log`, `gui-smoke-visual.log`. Synthetic GUI output and screenshot are under `gui-xrn6pF/`; local GUI runner/entry remain in the same temporary evidence directory.
- TODO: verify real native destination chooser, fresh converted project drawing/Save/reopen, and edited-current-project → browser → Import switching. The full bitmap smoke was not run (it also touches Trash/clipboard and unrelated workflows). No commit or push performed.

## Local simplification — 2026-10-28 (earlier verification record)

- Base: local `main` at `ad4c34e` (PR3 integrated locally; no push in this task).
- User decision: only current-version new projects are supported for editing; preserve old test project files without promising direct editing.
- Removed the old single-layer TIFF equivalence exporter/importer/probe chain and its packaging requirement. Ordinary editing checks the old-project format before recovery observation/workspace freeze; readonly recovery remains available. No user project assets were read or changed.
- Open errors now use a non-modal open status instead of setting Save/Autosave failure state. Save rollback, filename collision checks, layer paths, recovery records and unsaved-close protection are unchanged.
- Self-tests: expanded regression passed 162 files / 1331 tests; full build (both typechecks included), preload sync, package resource preparation and six synthetic package-validator tests passed. The complete allowed `npm run test` attempt was interrupted (exit 130) after several minutes without further results while a Python child remained active. Three old error-channel test expectations found during verification were updated to assert open status rather than Save failure, and all passed in the expanded rerun. Full-suite PASS is **not** established.
- Actual isolated Electron GUI: synthetic old-project startup showed a non-modal unsupported-format status, no Save-failed modal, unchanged original JSON; the same window then opened a fresh empty folder. Only the test-owned Electron was stopped. No personal userData, clipboard, Trash or artwork was used. This is self-verification, not independent acceptance.
- TODO: verify new-folder Add/draw/Save/reopen and switching from an edited current project to an unsupported old project in the actual GUI (the latter has Main/slot regression coverage). The legacy case in `scripts/electron-bitmap-smoke.mjs` now asserts non-modal refusal and unchanged displayed shots; that full smoke was not run because it also exercises Trash/clipboard and unrelated workflows.
- Raw local logs and synthetic fixtures: `/private/tmp/storyboard-simplify.5bM8kH/`. Final receipts: `regression-final.log`, `build-final.log`, `preload-final.log`, `package-resources.log`, `package-validator.log`, `gui-smoke.log`; interrupted attempt: `full-suite.log`. No commit or push performed.

Verification commands (this workstation; synthetic temporary data only):

```sh
npm run build
npm run check:preload
npm run prepare:package-resources
env TMPDIR=/private/tmp/storyboard-simplify.5bM8kH python3 scripts/test-release-package.py
env TMPDIR=/private/tmp/storyboard-simplify.5bM8kH SWB_PYTHON_DEPS_DIR=/Users/xiali/Documents/Storyboard-flow/vendor/python/photoshop-tiff npm run test
env TMPDIR=/private/tmp/storyboard-simplify.5bM8kH SWB_PYTHON_DEPS_DIR=/Users/xiali/Documents/Storyboard-flow/vendor/python/photoshop-tiff npm run test -- src/renderer src/shared electron/main/workspaceFormat.test.ts electron/main/normalOpenPreviewInitialization.test.ts electron/main/normalOwnedOpenChain.test.ts electron/main/normalSaveTransport.test.ts electron/main/recoveryCloseBarrier.test.ts electron/main/fileRenames.test.ts electron/main/normalSaveMainChain.test.ts
node /private/tmp/storyboard-simplify.5bM8kH/gui-smoke.mjs
```

Scan disposition: retired the legacy TIFF equivalence chain, its double invocation and packaging probe; separated Open status from Save errors. Retained current-project output identity, path boundaries, rename collision/rollback, unfinished writes, History/recovery and Close safeguards. Native recovery policy and workspace switching are tightly connected to current-project data retention, not established dead code; broader removal needs a concrete replacement behavior and separate verification rather than deleting checks by keyword.

The earlier source-integration boundary and remaining platform caveats below still apply.

This is the complete approved source integration candidate, not an installer or a formal Release. Do not infer Windows, clean-machine, real Photoshop, Trash, clipboard, crash or cross-process guarantees from local checks.

Start with AGENTS.md, README.md and todo.md. Architecture is in docs/architecture/SYSTEM.md; stable rationale is in decisions.md. Workstation logs, private task discussions and one-off diagnostic launchers are intentionally not distributed. Required synthetic fixtures and executable test tooling remain in source.

## Integration contents

The source combines the existing main CI/release preparation with the Mac data-safety/recovery implementation, retired built-in AI modules, renderer/module cleanup and evidence-comparison tooling. Existing production guards, failure records, History/custody and recovery budget policy remain intact.

The first-create Save path includes compatible Python selection at the environment boundary, bounded complete native directory re-observation with fixed identity/restrictions, and retained-close comparison against the actual persisted Project after a required persistence succeeded but final ACK failed. Retention does not turn failed Save into success.

Native tests select Python through PATH rather than a workstation Homebrew absolute path. Use Python 3.12 with matching installed TIFF dependencies. CI passes its installed vendor path explicitly. Both packaging recipes include the production native helpers; package validation rejects missing helpers. This source change is not proof that either complete package has run on its target machine.

## Verification boundary

The preceding integration self-test exercised a real offline App: new synthetic empty directory → Add → edit dialogue → Save → normal retained Close → fresh-process reopen with the same dialogue → normal retained Close. Failure retention also has real Main/native regression coverage; service-level fault injection is not equivalent to a natural failed-GUI scenario. Exact source/build identities and raw receipts are held in the private task handoff. Final delivery/independent review status must be read from the task record, not inferred from this page.

The special non-certified normalSaveMetadataHistory test is intentionally absent and excluded in Vitest configuration. Other required fixture sources remain present. See todo.md for unverified product/platform areas.

## Local development

Use Node.js 22 and Python 3.12. Once installation is authorized, use the lockfile with npm ci and install the requirements into vendor/python/photoshop-tiff. Export SWB_PYTHON_DEPS_DIR to that directory for tests, and use an isolated TMPDIR for synthetic work. Python native wheels must match interpreter and architecture. Do not use production folders as fixtures.

Build with npm run build (both typechecks included), then npm run check:preload. Required tests use the allowed Vitest configuration; tests and smoke scripts still need an authorized safe execution environment. Do not run legacy smoke commands blindly against real userData, Trash or clipboard.
