# When and how Hermes tests

> Historical Hermes wave-one runner protocol. Its evidence and fixture rules remain useful; lane commands below target retired Hermes branches. Use current task instructions and coordinator gates for today's verification assignment.
> [Current navigation](wave2/COORDINATOR-GATES.md).

## 1. Before editing

Record branch/HEAD and `git status --short`; inspect owned definitions and relevant existing
permitted tests. Run `python3 scripts/hermes-verify.py focused --lane <lane>` once to establish
baseline evidence. Before new tests exist, the baseline may report no tests (not a PASS).
Never read, copy, hash, execute or publish `src/renderer/normalSaveMetadataHistory.test.ts`.
Existing Vitest and TypeScript exclusions stay unchanged. No broad fixture collection.

## 2. During implementation

Add a focused behavior regression before fixing a discovered bug when feasible. Exercise public
Interfaces, real state transitions, no-ops, invalid input, and failures; do not just assert a
mock was called. Re-run affected tests after meaningful changes. Keep pixel/metadata equality
assertions and explain numeric tolerances. Test doubles are not real OS or GUI evidence.

New tests live only in the owned implementation directories and match `*.test.ts`. Small
synthetic fixture data may live there; licensed external corpus downloads need a separate decision.
Temporary filesystem tests use `test/temporaryWorkspace.ts` as documented in
`docs/testing/temporary-workspaces.md`. Failed test evidence stays outside the checkout.

## 3. Before delivery

Freeze implementation edits, commit them locally on the assigned branch, then run:

```sh
python3 scripts/hermes-verify.py focused --lane drawing
python3 scripts/hermes-verify.py full --lane drawing
python3 scripts/hermes-verify.py build --lane drawing
git diff --check
```

Replace drawing with storyboard or persistence. The script uses existing dependencies, captures
raw logs and receipts under ignored `.hermes/evidence/`, and serializes commands across these
worktrees. Exit 75 means another lane holds the verification slot: retry after it finishes;
never delete a live lock or terminate another lane. If an interrupted owner leaves a stale lock,
report it to the coordinator instead of guessing ownership.

`full` runs the complete currently allowed `npm run test` suite, preserving the prohibited-file
exclusion. `build` runs `npm run build`, including both typechecks. Dependency symlinks are
pre-provisioned; treat their contents as read-only. No npm ci, npm install, pip install, package
changes or global configuration edits. A dependency/platform failure is BLOCKED/NEEDS_VALIDATION,
not successful completion. Report the command, exit, failed test and whether it predates your
changes; do not weaken assertions or fix unrelated baseline code to make a green run.

If code changes after verification, repeat the affected focused checks and required final gates
against the final code. A report-only DELIVERY.md commit afterward is acceptable; record both
the tested implementation SHA and report HEAD. A timeout does not mean success or cancellation.

## 4. Evidence and scope

- Use docs/refactor/DELIVERY-TEMPLATE.md; link raw logs and receipts by absolute path.
- State actual counts, duration, exit codes and skipped cases. Preserve failures and reruns.
- Wave 1 acceptance is headless core functionality. Do not claim GUI, Photoshop, installer,
  1,000-board performance or Windows acceptance from these tests.
- GUI and all personal media/userData/clipboard/Trash operations are out of this wave. Inspect
  smoke scripts before any later authorized use; never run them because a package script exists.
- Performance evidence uses synthetic data, states workload and machine, and reports measurements
  without invented speedups. New metadata/core tests do not establish drawing responsiveness.
- Complete only when TASK.md acceptance cases, focused tests, full allowed suite and full build
  pass on your final code. Otherwise deliver a precise BLOCKED or NEEDS_VALIDATION report.

## Coordinator acceptance after return

Check ownership diff and contract compatibility, independently review risky writes and history,
then integrate implementation commits without lane briefing commits. Re-run combined tests/build
and the later actual synthetic GUI chain. Mac and Windows filesystem checks are separate gates.
