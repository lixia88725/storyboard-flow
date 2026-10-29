# Naming unification and launcher verification — 2026-10-29

## Candidate and scope

Naming implementation: `7db58ed15049c7240d4a68d06d957e7395b1ef7a` on original `main`.
301 files changed. Active product/code/IPC/environment/TIFF/recovery identifiers use Storyboard Flow / Flow / flow / FLOW.
Current runtime data is `.storyboard-flow`; imported child projects are `.storyboard-flow-project`;
standalone checkpoint cores use `.storyboard-flow/checkpoints`. See `docs/architecture/NAMING.md`.
The nested checkpoint layout now checks the product parent before creating/accessing its child;
regressions prove old/adjacent decoy data is unchanged and a symlink parent is refused.
Historical reports and stopped Hermes worktrees preserve their original tested identities.
No existing disk project migration, user media access, dependency installation or push.

## Evidence

All raw logs below are local, ignored `.hermes/naming/` files.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused cores and TIFF/preview tests | 18 files / 170 tests passed | focused-ready.log |
| Complete allowed `npm run test` | 373 files / 2713 tests passed, 1168 seconds | combined-full.log, combined-full-receipt.json |
| `npm run build` including both typechecks | Passed, 9.55 seconds | combined-final-build.log, combined-final-build-receipt.json |
| `npm run check:preload` | Passed | preload-final.log |
| `npm run prepare:package-resources` | Passed using pre-existing vendor dependencies | resources.log |
| Actual synthetic Electron Import/draw/autosave/Save/normal Close/reopen | Passed; first backups preserved; zero normal Close prompts | gui.log, gui.exit |
| Python AST / smoke-script syntax / `git diff --check` | Passed | coordinator checks |

Full tests and final build observed identical HEAD and clean worktree before/after.
The excluded uncertified fixture was not read/copied/hashed/executed.
Initial focused failures (`focused.log`, `focused-fixed.log`, `focused-final.log`) are retained:
new nested layout creation and old fixture directory expectations needed coordinated updates.
They are intermediate failures, not passes. No assertions were removed to obtain the final pass.

GUI evidence: `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-inline-import-1OScE0/result.json`.
Only synthetic images/private userData; the test forbids clipboard, Trash and native destination picker.
Owned Electron processes closed; full runner settled and released its shared verification lock.

## Subsequent launcher request

After the naming candidate was frozen, the user explicitly authorized removing/recreating the old launchers.
The replacement is one executable root `启动测试.command`; `scripts/test-launch.sh` is removed.
Old bytes/modes are backed up at `.hermes/naming/launcher-backup/`. Naming-candidate launcher hashes
were unchanged; the later launcher replacement intentionally supersedes their preservation instruction.

The new script always runs `npm run build`, uses the direct macOS Electron binary, keeps its lifecycle
attached, sends runtime logs to `.hermes/launch/`, and explains errors. It installs nothing and deletes no
cache/user data. `--check` checks local dependencies without compiling or launching; `--help` documents it.
Old launcher flags are removed; `npm run dev` remains the hot-reload entry.

Validation: `bash -n`, real project `--check`, and isolated shell harness checks for dependency-only mode,
build failure preventing launch, exact project/config arguments, clearing ELECTRON_RUN_AS_NODE for the
child, app failure propagation and rejecting unknown flags. Evidence: `launcher-check.json`,
`launcher-real-deps.json`. This final shell/docs-only change does not alter the tested application code;
full application tests were not repeated. Finder double-click of this new script is TODO: verify;
it was not used to open personal userData during verification.

## Acceptance boundaries

Self-tested coordinator implementation, not independent acceptance or published release.
Windows, installers, actual Photoshop, cross-filesystem durability, real artwork and large-raster
performance remain unverified. New cores are still not wired into production UI.
Three Hermes agents remain stopped; their worktrees are preserved. Next assignments should start from
this unified main baseline, not continue rewriting old lane branches.
