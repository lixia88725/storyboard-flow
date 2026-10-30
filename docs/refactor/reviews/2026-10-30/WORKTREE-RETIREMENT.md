# Wave-one worktree retirement — 2026-10-30

User approved retiring the completed three Hermes worktrees. Original checkout remains on main.
No new worktree/agent launched, no application source modified, no push or branch deletion.

## Preservation and audit

- All three lane checkouts had clean tracked/untracked Git status. A read-only process listing found
  no other process command referencing their paths or the shared verifier.
- Owned implementation paths match their accepted snapshots (drawing 8374441, storyboard 6ae4547,
  persistence bbbdf7d), and those snapshots match integrated candidate 72f4011 in the same paths.
  Current main additionally contains the separately tested naming changes.
- Archived every filesystem entry except the .git administrative pointer, including ignored test logs,
  generated files, task/report documents and dependency symlinks. Links were preserved, never followed.
  The prohibited uncertified fixture was absent and was not read/copied/hashed/executed.
- Verified archive entry sets, file SHA-256, sizes, modes and link targets against live inventories,
  then rechecked clean status, branch HEAD and archive digest before removal.
- `git worktree remove --force` removed only these verified archived checkouts; force permits their
  ignored files/dependency links. Branches and all commits remain. Git now lists only original main.

## Local archives

All paths below are relative to `.hermes/archive/2026-10-30-wave1/` (Git-ignored).

| Original | Archive / retained directory |
| --- | --- |
| .worktrees/hermes-drawing | hermes-drawing.tar.gz (920 entries) |
| .worktrees/hermes-storyboard | hermes-storyboard.tar.gz (937 entries) |
| .worktrees/hermes-persistence | hermes-persistence.tar.gz (951 entries) |
| .worktrees/cleanup-backup-20261029 | cleanup-backup-20261029/ |
| .worktrees/hermes-kickoff-20261029 | hermes-kickoff-20261029/ |

The latter two are ordinary backup directories, not worktrees. Cleanup-backup retains pre-consolidation
source and verification for the two older worktrees; kickoff retains pre-wave uncommitted source,
setup/briefing evidence and build logs. Relocated without deleting contents, with hash/link/mode checks.
Their historical references now resolve through this mapping. Finder metadata was also retained as
worktrees.DS_Store; the empty .worktrees container was removed.

`verification.json` contains exact branch tips and per-entry manifests, `removal-result.json` records
removal exits and remaining worktrees; `*-relocation.json` records backup directory relocations.
Recovery: create a checkout at the retained branch if needed; restore required ignored evidence from
its archive while preserving symbolic links. Do not overwrite main or replace Git administrative files.
These are local archives, not off-machine backups or published artifacts.

## Next step

Prepare second-wave contracts and bounded tasks on main, then create new worktrees from that baseline.
Old task prompts are historical and must not be restarted. No application test rerun for directory
retirement/documentation; prior implementation acceptance remains recorded in NAMING.md and RECHECK.md.
