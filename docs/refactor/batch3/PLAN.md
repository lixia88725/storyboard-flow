# Parallel batch 3 — 2026-10-30

Baseline: main after G2 Japanese integration (implementation 4c8cd8a, report ee1206e).
User requested three new Codex sessions/worktrees, one Sol and two Terra. Coordinator
owns main, reviews deliveries and connects the real app. This batch is bounded module
implementation, not complete production migration.

## Ownership

- Board (gpt-6.1-terra): src/core/storyboard/**, src/core/session/**.
  May extend only Board command unions in electron/shared/refactorV1.ts and
  electron/shared/flowWave2.ts. Other shared fields/interfaces remain coordinator-owned.
- Drawing (gpt-6.1-terra): src/renderer/drawing/** and src/core/drawing/**.
  New pixel-tool types live inside the owned module; keep existing FlowPixels compatible.
- TIFF (gpt-6.1-sol): new electron/core/formats/**. Expose module-local types.
- Each lane may create docs/refactor/batch3/<LANE>-DELIVERY.md and <LANE>-QUESTIONS.md.
  UI hosts, preload, main entry, persistence/platform, manifests/dependencies/config,
  launch scripts and other docs remain coordinator-owned. Ask via QUESTIONS when needed.

## Workflow and completion

1. Read AGENTS.md, latest context-handoff.md/todo.md, this plan, assigned task and relevant
   architecture/definitions/callers. Historical tasks do not supersede this assignment.
2. Verify worktree is isolated from original main. Use its absolute path for commands.
   Existing main node_modules may be symlinked into the worktree if absent; no installation.
   Build outputs and evidence stay in this worktree. Never modify another checkout.
3. Implement the bounded task through public interfaces. Preserve unsupported/failed
   results honestly; no success stub, removed assertion, hidden fallback or second owner.
4. Run focused regression during development. Real filesystem/Canvas checks use synthetic
   data and isolated userData only, with cleanup restricted to owned processes/resources.
   Preserve all prior scenarios. Never touch the forbidden fixture named in AGENTS.md.
5. Freeze an implementation commit. Run full allowed suite and complete build on unchanged
   code using scripts/wave2-verify.py full/build --lane session (Board), pixels (Drawing),
   assets (TIFF). This uses the common Git heavy-check lock: exit 75 means wait and retry,
   not failure or permission to delete a lock. Full suite is about 24 minutes per lane;
   stagger full/build runs, keep owner alive until child settles. If blocked by a genuinely
   orphaned lock, record evidence for coordinator, never remove another owner's lock.
   Focused commands may directly name only owned test paths; do not use runner focused
   for TIFF because its old assets mapping excludes the new formats module.
6. DELIVERY records exact implementation SHA(s), command/log/receipt paths, acceptance
   cases, failures/skips, GUI/platform limits and git diff --check. Report-only commit
   must identify tested implementation SHA. Clean owned worktree; no merge/push.
   If required evidence is missing mark INCOMPLETE. Stop after this bounded delivery.

No SQLite/PSD/audio/PDF/cloud, dependency installs, real user projects, native Trash or
clipboard. Worktree-local tests are self-tests; coordinator integration and real combined
UI acceptance follow. No automatic production routing or deletion of old implementations.
