# Storyboard Flow refactor

Start with the newest entries in [current handoff](../../context-handoff.md) and
[remaining work](../../todo.md), then the [coordinator gates](wave2/COORDINATOR-GATES.md).
Those describe implementation, self-test and independent-acceptance state. Dated reports
prove only their recorded candidate; task plans do not authorize restarting old lanes.

## Find the relevant design

| Work | Read |
| --- | --- |
| Core project/image rules | [Contracts](CONTRACTS.md), [shared types](../../electron/shared/refactorV1.ts) |
| Session, assets and pixels | [Wave-two interface decisions](wave2/IMPLEMENTATION-1.md), [shared session types](../../electron/shared/flowWave2.ts) |
| TIFF folder opening | [Import lifecycle](TIFF-IMPORT.md) |
| Ordered TIFF filenames | [Save naming](SAVE-NAMING.md) |
| Pending membership and output | [Pending policy](PENDING.md) |
| Project switching and stale callbacks | [Project switching](PROJECT-SWITCHING.md) |
| Verification scope | [Coordinator gates](wave2/COORDINATOR-GATES.md), [temporary fixtures](../testing/temporary-workspaces.md) |
| Existing production runtime | [System map](../architecture/SYSTEM.md) |

The isolated editor and the production App are separate integration states. Use the
handoff and gates to establish which route a change affects before changing callers.

## Historical work and evidence

- [Wave-one overview snapshot](archive/2026-10-31-overview.md), [worktree registry](WORKTREES.md),
  and `tasks/`: completed Hermes assignments and original ownership.
- [Wave two](wave2/README.md): design/implementation briefs and retirement records;
  `COORDINATOR-GATES.md` remains the current acceptance entry.
- [Batch three](batch3/PLAN.md): completed Board/Drawing/TIFF assignments; evidence is in
  [integration acceptance](reviews/2026-10-30/batch3/ACCEPTANCE.md).
- `reviews/YYYY-MM-DD/`: candidate-specific reviews, test receipts and limits. Retain
  them when newer code supersedes a milestone.
- [Initial acceptance catalogue](ACCEPTANCE.md) and [integration proposal](INTEGRATION-PLAN.md):
  source-informed baselines, not a current PASS/NOT_RUN dashboard.

Old worktree tables are provenance, not live inventory. Run `git worktree list` when
coordinating or retiring checkouts. Return to the [documentation index](../README.md)
for naming, release and repository-maintenance references.
