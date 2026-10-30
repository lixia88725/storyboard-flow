## Wave-one worktrees archived — 2026-10-30

User approved retirement. The three completed Hermes checkouts were fully archived and verified,
then removed; their branches/commits remain. Git now lists only original main. The cleanup-backup
and kickoff directories were relocated intact into `.hermes/archive/2026-10-30-wave1/` alongside
lane archives and audit manifests. Historical paths below refer to the pre-retirement locations.
Details: `docs/refactor/reviews/2026-10-30/WORKTREE-RETIREMENT.md`.
No agents restarted or next-wave worktrees created. Prepare new tasks/contracts before reopening lanes.

# Hermes wave 1 worktrees

Status: wave-one implementation and correction deliveries have been reviewed and integrated on main. Keep all three worktrees for provenance; no next-wave assignment has been launched. See [RECHECK.md](reviews/2026-10-29/RECHECK.md).
The assignments and start prompts below are historical wave-one setup instructions, not a request to restart completed work.

## Assignments

| Lane | Branch | Checkout | Briefing commit (exclude from integration) |
| --- | --- | --- | --- |
| drawing | `codex/hermes-drawing-wave1` | [/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing](/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing) | `2d2f91a80e1ffa6b6450bc43606b0939a7be547d` |
| storyboard | `codex/hermes-storyboard-wave1` | [/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard](/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-storyboard) | `faebc0ef267539cfbfc3668459cf47021b225a9e` |
| persistence | `codex/hermes-persistence-wave1` | [/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence](/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-persistence) | `decb251145b5ff3fbac196e724c1ae879af70f5a` |

Common implementation base: `c7630b3543bb6c7e7aa18bf9159aa97046a8970e`. Pre-existing source work preserved in `235145c22d66ce500a8ea60ef6e4e7a7f21aee2c`.

## Start each Hermes

Set the agent working directory to its assigned checkout above. Give each agent this prompt:

> 请阅读本目录 AGENTS.md，按 TASK.md 完成本轮任务。遵守 docs/refactor/CONTRACTS.md 和 docs/refactor/TESTING.md，开发中做模块测试，交付前执行完整允许测试集及完整构建。仅在本分支提交，不推送、不改 main。完成后提供 DELIVERY.md、最终提交 SHA 和原始测试日志。遇到跨模块契约问题写 QUESTIONS.md，不自行扩大范围。

Drawing owns image/layer edits and the extraction map; storyboard owns project commands/history and view integration mapping; persistence owns synthetic checkpoint storage and platform file primitives. Detailed ownership and acceptance are in each TASK.md. This wave does not replace production UI or Save.

## Review and integration

The user reports completion; do not automatically launch or message agents. Review DELIVERY.md, QUESTIONS.md, implementation commits, raw evidence and scope. Independently review file publication, history and error paths. Integrate only implementation commits after the briefing commit; never merge an entire lane branch because its briefing deletes historical documents and replaces AGENTS.md. Re-run combined tests/build before later UI integration. Keep original launchers. No pushes.

## Setup evidence

- Backup and setup evidence: [/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-kickoff-20261029](/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-kickoff-20261029). Baseline patch/archive contain preserved pre-existing changes; restricted fixture was excluded.
- `npm run build`: exit 0, full log `setup-build.log`, exit file `setup-build.exit`. Vite reports a bundle-size warning.
- `git diff --check`, runner syntax/help, branch/clean-state checks, shared-contract equality, historical-document placement and launcher byte/mode verification passed. See `setup-validation.json` (before this registry-only commit).
- Complete tests were not freshly run for this setup. There is no new module implementation yet. Hermes must produce the required module/full/build results; GUI and Windows remain later acceptance gates.
- Existing dependencies are linked read-only, with no installation. Local Git exclude hides the node_modules symlink. Heavy verification commands share a lock and store evidence under each checkout’s `.hermes/evidence/`.
- Both launchers retain mode 0755. SHA256: `启动测试.command` = `c0316015a4682196c760730c941067786a4cfb04d63b944c12285fbf22dabbe0`; `scripts/test-launch.sh` = `05953bb703a813d578fa3067084de888e4e4e27a41109ac3f65826099f1bc83c`.
- Old context-handoff.md, todo.md, decisions.md and docs/architecture/SYSTEM.md remain on main and in Git. Only lane briefing commits remove their copies to prevent stale task instructions.
