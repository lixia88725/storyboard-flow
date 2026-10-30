# Wave-two worktree retirement — 2026-10-30

User authorized archiving and retiring the three completed Codex worktrees before
coordinator-owned UI integration on original main. No application source changes,
agent restarts, new worktrees, dependency installs or push in this retirement.

## Evidence and preservation

- Main started clean at `a80dffb2258b63f710505af40ab36762535f534c`.
- All three chats were idle/completed. All three checkouts were clean at their
  recorded final report HEADs. Read-only process inspection found no relevant
  running worktree or verification processes (apart from the inspection itself).
- Implementation source was already independently accepted on main `124ac1a`;
  see WAVE2-BATCH1.md and `.hermes/wave2-review/source-equivalence.json`.
- Every filesystem entry except the root Git administrative pointer was archived,
  including ignored logs, generated files, reports and dependency symlinks. Links
  were preserved without traversal. The prohibited fixture was absent; it was not
  read, copied, hashed or executed. Nested Git repositories would have stopped the audit.
- Verified exact archive entry sets, file hashes/sizes/modes and link targets,
  then re-inventoried live contents and rechecked HEAD/clean status. Before deletion,
  rechecked archive hashes and clean HEADs. No uncommitted changes were discarded.
- The archive tool only supports this chat's attached worktrees; list_artifacts
  returned none. Used Git after explicit archival instead. `git worktree remove
  --force` permits the verified archived ignored files, not discarded source work.

## Recovery inventory

Local archive root: `.hermes/archive/2026-10-30-wave2/` (Git-ignored).

| Lane | Original checkout | Final HEAD | Archive entries | Retained branch |
| --- | --- | --- | --- | --- |
| session | /Users/xiali/.codex/worktrees/98de/appshot-bitmap-layers | 0fbc311353da7d6b36eff19e23e9fb23854d2120 | 1332 | codex/archive-wave2-session |
| pixels | /Users/xiali/.codex/worktrees/0a45/appshot-bitmap-layers | c51953c63679ed7726f920436b3e11fa688d520e | 1182 | codex/archive-wave2-pixels |
| assets | /Users/xiali/.codex/worktrees/9591/appshot-bitmap-layers | adfaff7620216f4da4379b2bb5c307696543f2d9 | 1195 | codex/archive-wave2-assets |

`session.tar.gz`, `pixels.tar.gz` and `assets.tar.gz` preserve complete permitted
checkout contents. `verification.json` holds per-entry manifests and archive hashes;
`removal-result.json` records successful removals and the sole remaining main checkout.
`lane-commits.bundle` passed `git bundle verify` and contains the three retained branch
histories. `preserve.py` records the preservation procedure. These are local recovery
artifacts, not an off-machine backup.

To recover, create a separate checkout from the retained branch (or import the bundle
if necessary), and restore needed ignored evidence from its tar archive. Do not
extract over main or overwrite Git administrative data. Chat histories remain intact;
their original checkout paths are now historical, and old task prompts must not resume.

## Next work

Coordinator stays on main; no parallel lanes are needed for the first G2 interface
integration. Begin with the current entry/controller and Main/preload connections,
using COORDINATOR-GATES.md G2 and the accepted core contracts. Preserve one writable
Project per session and existing interaction behavior. Keep checkpoint, TIFF Save
and Close certification distinct. G2 implementation and actual GUI acceptance are
not completed by this directory cleanup. No application test rerun was needed for
archive/document-only changes; prior 376-file / 2821-test and full build evidence stands.
