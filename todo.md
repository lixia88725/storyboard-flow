## Codex wave-two implementation dispatched — 2026-10-30

Three existing managed Codex worktree sessions resumed on gpt-6.1-sol/high. Shared contract
commit ca34ca1 defines the first bounded implementation batch: headless Session, real immutable
asset admission/read, Canvas brush/eraser pixel production. Main remains coordinator-owned.
See docs/refactor/wave2/IMPLEMENTATION-1.md and SESSIONS.md for ownership, thread IDs and gates.
Contract build passed; lane implementation/focused/full/build/Canvas results are pending.
No new-core production UI/TIFF wiring or acceptance claimed. No push, dependency installation,
old-project migration or cross-session-history behavior change. Next: inspect scoped delivery,
independent composition tests and review, then actual G2 UI wiring in a later assignment.

## Wave-one worktrees archived — 2026-10-30

User approved retirement. The three completed Hermes checkouts were fully archived and verified,
then removed; their branches/commits remain. Git now lists only original main. The cleanup-backup
and kickoff directories were relocated intact into `.hermes/archive/2026-10-30-wave1/` alongside
lane archives and audit manifests. Historical paths below refer to the pre-retirement locations.
Details: `docs/refactor/reviews/2026-10-30/WORKTREE-RETIREMENT.md`.
No agents restarted or next-wave worktrees created. Prepare new tasks/contracts before reopening lanes.

## Naming and replacement launcher verified — 2026-10-29

- Naming candidate `7db58ed` passed complete allowed tests (373 files / 2713 tests), full build,
  preload sync, resource preparation and synthetic actual Electron Import/draw/Save/Close/reopen.
  Raw logs/receipts and intermediate failures remain in `.hermes/naming/`; full details in
  `docs/refactor/reviews/2026-10-29/NAMING.md`. Active naming policy is `docs/architecture/NAMING.md`.
- User subsequently authorized rebuilding the launchers. One root `启动测试.command` now compiles
  current source and directly launches Electron; old `scripts/test-launch.sh` removed, originals
  backed up locally. Shell syntax, real dependency-only check and isolated lifecycle/error harness
  passed. Finder double-click remains TODO: verify. Application code is unchanged after its tested SHA.
- Main/local only; no push, disk-project migration, dependency install or agent relaunch. Historical
  reports and the three Hermes source worktrees retained. Windows/installers/independent acceptance
  remain unverified. Use new test projects; next Hermes work starts from unified main.

## Naming unification — 2026-10-29

用户已批准全部统一为 Storyboard Flow。当前代码/环境变量/IPC/TIFF/恢复 schema 使用 Flow 命名；
目录按角色分为 `.storyboard-flow`、`.storyboard-flow-project` 和 `.storyboard-flow/checkpoints`。
详见 `docs/architecture/NAMING.md`。以下历史记录中的旧名称属于当时的候选，不再是当前命名规范。
本次不迁移或删除原有文件，不重启已停止的 Hermes；命名验证结果见新交接记录。

# Storyboard Flow — remaining verification and product work

This file records remaining scope, not permission to start it. This source integration does not promise that the entire application or all platforms have been accepted.

- Active Hermes refactor: follow `docs/refactor/README.md`, not the historical implementation
  tasks below. Wave 1 delivers isolated cores; full feature integration, actual GUI and Mac/Windows
  performance acceptance follow coordinator review. Keep this historical list on main only.

- 2026-10-29 save/provenance/EPIPE repair: implemented in original and attached source worktrees. Real 31-shot draw/autosave/Save/Undo/Save/normal Close/fresh editable reopen passed, with zero unfinished-operation prompts. Exact restored PNG hash and raw evidence are in the newest context-handoff section. Final suite/build results recorded there. Large retained-project Save/Close preparation remains slow and needs separately measured performance work; do not bypass native/recovery checks to make it faster. Independent acceptance, installed-app packaging and other-platform/filesystem acceptance remain TODO: verify.

- 2026-10-28 editable autosave/original Save: user approved silent healthy Close and explicit Save updating original root images with first backups. Implemented and self-tested: all 355 allowed files / 2541 tests covered across full invocation plus corrected caller-binding rerun, complete build, preload/resources, and actual isolated multi-project GUI (no Save → Close → editable reopen, explicit Save/root updates/exact backup, zero normal Close prompts). True failures remain protected. Details/limits in newest context-handoff.md section. This supersedes earlier unsaved-import Close-refusal and no-original-overwrite-on-Save notes. Independent acceptance and installed-app update remain TODO: verify.

- 2026-10-28 managed child: old-folder conversion now uses `.storyboard-flow/` inside the original folder, no Destination picker; source address/recents remain stable and reopening resolves the editable child. Existing projects and ordinary image/script Import remain in place. Final self-verification: full invocation 352 files / 2535 tests, focused final 10 files / 76 tests (including the newly enumerated recent-handler file), both-typecheck build, preload sync and actual synthetic multi-project Import/draw/Save/Close/reopen passed. All 353 allowed files are covered across the logs. Details are recorded in the newest context-handoff.md section; previous outside-destination notes below are historical. Real user media, installation and independent acceptance remain TODO: verify.

- 2026-10-28 inline Import: old-folder modal removed; source preview is in the main workspace and top-left Import converts into a new folder. Full allowed tests 352 files / 2515 tests and complete build passed. After the startup-probe correction, 11 affected files / 79 tests and a rebuilt actual GUI verified conversion, painting, exact source preservation, dirty-project switching, Save-all → normal Close and fresh-process reopen. The full native suite was not repeated after that last narrow correction. Native chooser remains TODO: verify. An unsaved imported project held in another slot refuses Close until its obligations can be certified; retain this boundary and do not turn it into a successful Close by suppressing the failure. Detailed final lifecycle checks and raw evidence are in context-handoff.md.

- 2026-10-28 simplification/browser: legacy equivalence migration is retired, but old root images remain browsable. Explicit Import creates a new project outside the original folder. Isolated actual GUI browse→Import passed; expanded regression 166 files / 1393 tests passed. TODO: real destination chooser, converted-project drawing/Save/reopen, edited-current-project switching, and a clean full-suite run on final source in an environment permitted to read native memory metrics. Full-run failures and focused reruns are recorded in context-handoff.md. Keep native recovery/permission and Close simplification separate; their responsibilities still protect current projects and have not been proven redundant.

- Independent acceptance of the integrated source and final GitHub delivery follow the existing task/release gates; source self-tests are not independent approval or publication.
- Windows native owner/group/DACL/SACL/audit/integrity restrictions, clean-machine setup and cross-computer usage remain unverified. Safe refusal on unknown policy is not Windows support.
- Actual installers, full Python/vendor portability and real Photoshop, Trash, clipboard and device workflows need separately scoped verification. Packaging source contracts and generated ZIP validator fixtures do not substitute for installing/running a package.
- Add/Paste/drawing/History interactions across project switches, ABA/reload, in-flight preparations and post-write metadata failure need the remaining full application matrix.
- Import lock and shortcut behavior, Pending materialization/restoration, scene inheritance and empty-board dimensions retain their remaining interaction coverage.
- Large-scene marquee/scroll/zoom/pan, drawing transforms/blur, layer gestures, animation/timeline/Onion Skin and mixed aspect ratios need real-user-operation coverage at representative scale.
- Additional external TIFF/Markdown changes, rename/rollback collisions, partial JSON/MD/TIFF/Trash cleanup and actual Save-and-Close failure combinations remain beyond the bounded verified cases.
- Cross-process hostile competition, crashes/power loss, fsync durability, alias/ABA and all hidden-root/legacy/million-record behavior are not universal guarantees.
- The 8GiB recovery budget is a disk policy, not an application RAM ceiling. Broader performance/resource claims require measured evidence.

Built-in AI generation is retired. Ordinary Pending is not retired. PSD-first interchange, full-fidelity Photoshop round-trip, PDF/image-sequence export, SQLite/cloud/collaboration and new AI tooling require new product decisions.

Do not remove failures/recovery namespaces, widen access controls, enable dormant origin features or skip required assertions to complete this list. Preserve prior evidence and authorization boundaries; verify only the affected remaining scope with appropriate independent review.
