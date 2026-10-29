# Hermes delivery — storyboard

Status: S1 correction verified on the committed headless core; **awaiting supervisor re-review, not integrated or GUI-accepted**

- Worktree / branch: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard` / `codex/hermes-storyboard-wave1`
- Shared base / briefing commit: `c7630b3543bb6c7e7aa18bf9159aa97046a8970e` / `faebc0ef267539cfbfc3668459cf47021b225a9e`
- Tested implementation SHA (focused/full/build): `6ae4547e95b325024195d42184b693cb2db56b33`
- Report HEAD: report-only commit (`git log -1`; cannot embed its own hash self-referentially).
- Implementation commits to integrate (exclude briefing/report commits): `b98cc27f2acbc8b8f33632983e3b157946312d1f`, `6ae4547e95b325024195d42184b693cb2db56b33`

## Result

`src/core/storyboard/index.ts` supplies `applyStoryboardEdit`, `createProjectHistory({maxEntries})` (`current/apply/undo/redo`, typed `ResultV1`), and `precedingActiveImages`. S1 fix: `ChangeSetV1.shotIds` for order/membership reports every changed (active/Pending, index), in resulting active-then-Pending order, with removed IDs appended in prior order, without duplicates. Forward edit, Undo and Redo use the same rule; unchanged position is not marked solely because a shot was selected. Content/image changes remain represented on Undo/Redo. The new regression covers active order, Pending order, cross-membership and no-op. `INTEGRATION.md` records the affected-ID semantics. **Production views and Save are not wired or tested.** No dependencies or shared files changed.

## Acceptance evidence

| TASK case | Test/scenario | Result | Raw evidence |
|---|---|---|---|
| Insert/delete/multi-selection reorder/Pending, edges, identity | `index.test.ts`: insert/delete and grouped transitions | Pass at `6ae4547` | Final focused/full logs below |
| S1 position-affected IDs (forward, Undo, Redo) | `index.test.ts`: active reorder, Pending reorder, cross-membership, no-op | Pass; exact deterministic arrays and flags asserted; old candidate reproduced as failure in supervisor REVIEW.md | Final focused/full logs below |
| Unicode text/dialogue, no pixel mutation, shared snapshot reading | `index.test.ts`: Unicode/dialogue and two identical core projections | Pass, **core-only**; no independent view/GUI proof | Final focused/full logs below |
| No-op/failure, invalid IDs/references, no revision/history | `index.test.ts`: invalid and unchanged commands | Pass | Final focused/full logs below |
| Complete image baseline including ABA and fabricated flags | `index.test.ts`: typed drawing result | Pass | Final focused/full logs below |
| Mixed undo/redo, redo clearing, bounded eviction, deletion retention | `index.test.ts`: mixed history and deleted image retention | Pass | Final focused/full logs below |
| Preceding active images, Pending exclusion, reorder | `index.test.ts`: active neighbor lookup | Pass | Final focused/full logs below |
| 1,000-shot synthetic metadata workload | Reorder three noncontiguous IDs, text edit, two undos | Pass; 57.9 ms in focused run, process-wide heapUsed 16 MiB; no UI frame-rate claim | Final focused log below |

## Verification

| Command | Tested SHA | Exit | Counts / duration | Log / receipt |
|---|---|---:|---|---|
| Initial `focused --lane storyboard` (old Node) | `faebc0e` | 1 | Node v16 cannot import Vite `node:fs/promises` constants | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T110537.035705Z-focused/output.log` |
| Initial `PATH=/opt/homebrew/bin:$PATH` focused | `faebc0e` | 1 | No tests in owned directory; baseline is **not a pass** | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T110558.621948Z-focused/output.log` |
| Development `focused --lane storyboard` | Before `b98cc27` final edits | 0 | 1 file, 8 tests; 487 ms; synthetic workload 65.1 ms, MacBookPro18,2 arm64 | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T110838.708176Z-focused/output.log` |
| Original candidate supervisor focused | `99a8446` (implementation `b98cc27`) | 0 | 8 tests, 1 file, 0.781 s receipt | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T125640.617347Z-focused/{output.log,receipt.json}` |
| Original candidate supervisor full | `99a8446` (implementation `b98cc27`) | 1 | 5 files failed / 355 passed; 13 tests failed / 2581 passed; 1191.755 s. Nine cold-read cases lacked `dist-electron/main/preparedWorkspaceSave.js`; four others raised RAM_ADMISSION. **Pre-correction, not a pass and not evidence of S1 fix.** | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T125649.293291Z-full/{output.log,receipt.json}` |
| Corrected `focused --lane storyboard` | `6ae4547e95b325024195d42184b693cb2db56b33` | 0 | 1 file / 9 tests; 0.966 s receipt; 342 ms Vitest | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T135552.253045Z-focused/{output.log,receipt.json}` |
| Preflight `build --lane storyboard` (creates required `dist-electron` for cold-read suite) | `6ae4547e95b325024195d42184b693cb2db56b33` | 0 | 9.127 s; both typechecks, Vite and Electron emit | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T135705.805427Z-build/{output.log,receipt.json}` |
| Corrected `full --lane storyboard` | `6ae4547e95b325024195d42184b693cb2db56b33` | 0 | 360 files / 2595 tests passed; 1137.499 s receipt (Vitest 1136.89 s) | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T135725.261024Z-full/{output.log,receipt.json}` |
| Final `build --lane storyboard` | `6ae4547e95b325024195d42184b693cb2db56b33` | 0 | 8.927 s; both typechecks, Vite and Electron emit | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard/.hermes/evidence/20261029T141826.585025Z-build/{output.log,receipt.json}` |
| `git diff --check` | `6ae4547` | 0 | No whitespace errors | Terminal output in this handoff session |

No test exclusions changed; the prohibited metadata-history test was not read, copied, hashed or executed. The full suite uses the existing exclusion. No application, smoke, GUI, personal media, userData, clipboard or Trash was accessed. Before editing, the coordinator's full process was confirmed finished by its receipt (`exitCode: 1`) and absent PID. Other lanes' live locks were respected; none was removed or its process terminated. The S1 regression was written before the fix but could not be run red while another lane held the verification slot; the supervisor's independently reproduced old-candidate failure is recorded in REVIEW.md. The earlier failing full run is retained above, not relabeled as passing. The corrected full run passed after a build preflight produced the previously missing Electron output. No fixture cleanup outside verifier-owned temporary roots was performed.

## Integration notes

`QUESTIONS.md` retains the deferred cross-shot dialogue transaction decision; it is not part of S1. Performance numbers cover synthetic metadata on a MacBookPro18,2 arm64 only; heapUsed is process-wide, not isolated memory cost. No drawing responsiveness, production workflow, independent grid/Japanese projection, GUI, Windows or filesystem acceptance. The supervisor must independently re-review S1 and later coordinate production wiring; this lane stops here.
