# Initial documentation cleanup — 2026-10-31

Scope: documentation only, based on main `e08f0e1`, prepared in `codex/docs-cleanup`.
This is an inventory and navigation cleanup, not runtime deletion or verification.

## Changes and preservation

- Added [documentation entry](../README.md) and replaced the outdated
  [refactor entry](../refactor/README.md) with pointers to current handoff, gates and
  workflow references. Status/test counts are not duplicated into the new indexes.
- Relocated the complete former `docs/refactor/README.md` body into
  [overview snapshot](../refactor/archive/2026-10-31-overview.md). Only relative Markdown
  links were adjusted for its new parent; its historical assertions, SHAs, counts and
  instructions remain intact under an explicit historical banner.
- Preserved these paths and bodies, adding only a historical-context banner:
  `docs/refactor/{ACCEPTANCE,INTEGRATION-PLAN,TESTING,WORKTREES}.md`,
  `docs/refactor/tasks/{DRAWING,PERSISTENCE,STORYBOARD}.md`,
  `docs/refactor/wave2/{README,IMPLEMENTATION-1,SESSIONS}.md`, and
  `docs/refactor/batch3/{PLAN,SESSIONS,BOARD,DRAWING,TIFF}.md`.
- No file was deleted. Dated review reports, lane deliveries/questions, contracts,
  current coordinator gates and current workflow documents were preserved. No source,
  launcher, dependency, configuration, test or recovery evidence was modified.

Keeping old briefing paths is deliberate. For example,
[scripts/wave2-verify.py](../../scripts/wave2-verify.py) checks that
`docs/refactor/wave2/IMPLEMENTATION-1.md` exists before running. Root instructions and
historical reports also refer to these paths. Marking their dispatch scope historical
removes ambiguity without breaking live tooling or rewriting provenance.

## Root inventory and later cleanup candidates

Root inventory used filenames and Git tracked/ignored status only; it did not descend
into ignored directories. At inspection, all top-level entries were tracked or ignored;
there were no untracked top-level files. The launcher `启动测试.command` is tracked.
Ignored root entries were `.DS_Store`, `.hermes`, `.worktrees`, `dist`, `dist-electron`,
`dist-resources`, and `node_modules`. `.git` is repository metadata. Ignored does not
mean disposable: `.hermes` includes evidence and archives; worktrees require a separate
unique-change audit. No ignored data was removed or its contents inspected in this lane.

| Candidate | Evidence and recommendation |
| --- | --- |
| Root `context-handoff.md` / `todo.md` | At this baseline, 454 / 302 lines, with repeated dated milestones. Coordinator owns their compaction: archive exact old files, keep handoff focused on current candidate/route/evidence/limits, and todo on unfinished gates. This lane did not edit or archive them. |
| `scripts/hermes-verify.py` | CLI accepts only retired wave-one lanes and enforces `codex/hermes-<lane>-wave1`; current validation uses `wave2-verify.py`. Candidate for later historical tooling archive, after checking old-branch reproduction needs and updating the retained testing instructions. Preserved now. |
| `scripts/photoshop-layered-tiff-spike.py` | Referenced by the [original spike report](../photoshop-layered-tiff-spike.md); not a package script. Candidate for a research subdirectory with that reference updated, not evidence-free deletion. Preserved now. |
| `vitest.full.config.ts` | No filename references found in the inspected source, scripts, workflows, docs or package manifest; `package.json` runs `vitest run`. This may be an operator-invoked configuration. Confirm the intended verification path before consolidation; no deletion proposed as proven safe. |
| `scripts/flow-core-composition.mjs` | Historical G1 harness documented by [wave-two evidence](../refactor/reviews/2026-10-30/WAVE2-BATCH1.md). Later GUI harnesses cover more behavior but do not prove this harness has no distinct value. Keep until coverage is compared. |
| `scripts/normal-save-reopen-probe.mjs` | Still called by `electron/main/normalSaveScriptImportChain.test.ts`; retain. |
| Native permission and TIFF import/export scripts | Current `electron/main/main.ts`, `managedSourceSave.ts` and other native writers reference them. They are active dependencies, not cleanup candidates merely because the new core exists. |
| Build outputs and installed dependencies | Generated/ignored does not establish safe removal while main is building or running. Any eventual cleanup should be coordinator-owned and limited to confirmed inactive reproducible outputs. |

Reference search was restricted to tracked source/scripts/docs/workflows and excluded
the uncertified fixture specified by AGENTS.md. No fixture contents were read, copied,
hashed or executed. No recursive scan of `.worktrees`, `.hermes`, `node_modules`, `vendor`
or Git metadata was used to infer obsolescence.

## Validation and handoff

- `git diff --check`: passed.
- Relative Markdown link targets in every changed/new document: checked against this
  checkout; no newly broken local target. Historical absolute worktree hyperlinks in
  `WORKTREES.md` already pointed at retired locations and remain provenance.
- Historical-body comparison: banner-only files match the base body exactly after
  removing the new banner; archived overview matches the former entry after reversing
  its relative-link relocation. Dated review/delivery evidence has no diff.
- Full tests, build and GUI: **not run**, as this lane changes documentation only.
  This report does not claim runtime acceptance.
- No coordinator-owned link correction is required: all original task paths remain.
  The coordinator can optionally link the root README to `docs/README.md` and compact
  root handoff/todo using the outline above after reviewing this commit.

Raw lane validation: `/tmp/flow-docs-cleanup-validation.json`. Review the scoped commit
before integration; a historical status or dispatch banner grants no new execution authority.

## Coordinator integration and root review

Lane commit `06f340f` was reviewed and integrated as `038f148`. Coordinator commit
`ef42d29` archives exact former AGENTS/handoff/todo under
`../archive/coordinator/2026-10-31/` and keeps root current guidance concise (76 / 38 /
40 lines at that commit). README links the documentation index; CLAUDE remains a
symlink to AGENTS. The launcher is byte-identical to baseline.

Independent read-only review of `ef42d29` found no actionable issues: all three archives
match `e08f0e1` byte-for-byte, all 23 root relative links resolve in the commit tree, and
all active safeguards remain except approved current-scope/Pending clarifications.
Coordinator integration checked 97 changed non-archive relative links with zero missing.
This accepts documentation cleanup only. Runtime naming changes are a separate candidate.
No runtime, old worktree, evidence directory or installed dependency was deleted.
