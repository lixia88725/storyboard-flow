# Storyboard Flow refactor

Current status (2026-10-30): wave-two foundations are integrated; the first isolated
existing-component editor workflow is implemented and self-tested on main. Final complete
suite: 379 files / 2829 tests; full build and 11 real two-process Electron cases passed.
See [first editor record](reviews/2026-10-30/G2-FIRST-EDITOR.md) for exact scope and evidence.
This small host is not the full production App; normal startup remains unchanged. Next:
application-shell adapters and remaining G2 interactions, then G3 TIFF/output integration.
All three old worktrees are retired; only main remains. See
[retirement](reviews/2026-10-30/WAVE2-RETIREMENT.md) for recovery. No parallel lanes needed.
Follow [current gates](wave2/COORDINATOR-GATES.md). The wave-one text below is historical.

## Historical wave-one assignment

2026-10-30: wave-one worktrees retired after verified full archives; only original main remains.
Branches and local evidence are preserved. See [retirement record](reviews/2026-10-30/WORKTREE-RETIREMENT.md).
Next-wave contracts/tasks are not yet assigned.

Status: wave-one cores independently reviewed and integrated on main; 372 files / 2711 tests and full build passed on `72f4011`. The new core is not connected to the app.
See [final recheck](reviews/2026-10-29/RECHECK.md) for evidence and remaining limits.
User authority (2026-10-29): redesign the internal format without old-project compatibility,
preserve current interactions, prepare isolated Hermes worktrees, allow local commits and
coordinator integration. No push or release. The user launches Hermes and reports completion.

## Read order

1. The worktree's root `AGENTS.md`: branch, ownership and execution rules.
2. `TASK.md`: this worktree's bounded deliverable and acceptance cases.
3. `docs/refactor/CONTRACTS.md`: shared data and operation semantics.
4. `docs/refactor/TESTING.md`: commands, evidence and completion gates.

`electron/shared/refactorV1.ts` is the coordinator-owned compile-time contract. It lives under
electron/shared so both existing TypeScript compilation targets can use it without changing
their output layout. It has no Node, Electron, DOM or React dependencies.

Historical handoffs are preserved on main and in the baseline commit. In each Hermes worktree,
the old root context-handoff.md, todo.md, decisions.md and docs/architecture/SYSTEM.md are removed
by a separate briefing commit. They describe the old implementation, not this assignment.
Read existing implementation and relevant permitted tests on demand. Do not start historical
todos. `docs/testing/temporary-workspaces.md` remains applicable to temporary test data.

## Target and sequence

- Project: one scene per portable folder; 1,000-board target, reference M1 / 32 GB.
- Preserve ordinary grid and Japanese storyboard views, existing drawing feel, text, sorting,
  layers and Pending. No timing/audio expansion, PSD work, SQLite, Rust, new dependencies or UI redesign in wave 1.
- Project model, editable pixels, interchange TIFF and disposable previews have separate roles.
- New modules: storyboard, drawing, persistence/formats/platform; UI is a client.
- Wave 1: independently testable foundations using one shared contract. Existing production
  entry points and the latest launch scripts remain unchanged.
- Wave 2, assigned after review: compose the cores, connect one synthetic draw/undo/checkpoint/
  reopen/explicit-TIFF-save workflow, then integrate both views and remaining tools.
- Final acceptance: focused and complete allowed tests, full build, actual isolated GUI,
  real filesystem failure cases and separate Mac/Windows evidence. Wave 1 is not that acceptance.

## Ownership

| Lane | Editable implementation paths |
|---|---|
| drawing | src/core/drawing/** |
| storyboard | src/core/storyboard/** |
| persistence | electron/core/persistence/**, electron/core/platform/** |

All lanes may create their own `DELIVERY.md`, `QUESTIONS.md`, and ignored `.hermes/evidence/`.
The coordinator owns shared contracts, configuration, dependencies, production wiring, and main.
An unresolved contract issue belongs in QUESTIONS.md with a concrete proposed change; continue
independent owned work, but do not duplicate or silently change the contract.

## Integration discipline

Baseline source preservation commit: `235145c22d66ce500a8ea60ef6e4e7a7f21aee2c`.
Common contract commit and lane briefing SHAs are recorded in the coordinator's
`docs/refactor/WORKTREES.md` after setup.
Each lane has a separate briefing commit changing AGENTS.md and removing old context entrances.
Implementation commits follow it and must not include those setup changes. The coordinator
cherry-picks reviewed implementation commits; whole-branch merging would replace main's
instructions and remove its historical records. Hermes must not merge into main or push.

## Delivery

Use `docs/refactor/DELIVERY-TEMPLATE.md` for DELIVERY.md. State the exact implementation SHA,
changed files, every acceptance case with evidence, tests/build exits, limitations and
remaining integration work. A test double or a passing build is not GUI/platform acceptance.
Return the branch, worktree path, DELIVERY.md path and commit SHA to the user. Stop after this
wave; the user brings the result back to the coordinator.

## Coordinator integration preparation

While Hermes implements wave 1, main holds the source-informed
[acceptance checklist](ACCEPTANCE.md) and [integration plan](INTEGRATION-PLAN.md).
These are future integration proposals and NOT_RUN cases, not amendments to active lane
contracts or evidence of completed behavior. They identify missing feature fields, composite
commands, pixel asset ownership and Save/session concerns before production routing.
