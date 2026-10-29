# Wave-1 independent review — 2026-10-29

Status: **CHANGES_REQUIRED**, not accepted or integrated. No runtime, shared contract,
branch implementation or naming changes made by the coordinator during this review.
Main review base: `eea2488`. This is bounded review evidence, not certification of all behavior.

## Candidate identities and evidence

| Lane | Implementation | Observed tip | Audit |
| --- | --- | --- | --- |
| drawing | ae766c7ddcbb5eb3887506adc5f13a2bdd7097b3 | 0c8a138 | clean; implementation also adds root QUESTIONS.md; later commits change DELIVERY.md only |
| storyboard | b98cc27 | 99a84462ac63d4894cbbec0c2e5bae1797236861 | clean; later changes only DELIVERY.md / QUESTIONS.md |
| persistence | 33be777 + 3474912 | ccd2e90 | clean; report-only difference is DELIVERY.md |

Read actual receipt JSON and raw log tails, not just the submitted narrative. Drawing focused/full/build
receipts show exit 0 on ae766c7 (full 361 files / 2619 tests); persistence receipts show exit 0 on
3474912 (full 368 files / 2655 tests). Reports and new tests were inspected; this does not imply that
all tested behaviors or platform claims have been independently established.

The shared verification lock was **absent** at coordinator inspection. No lock was removed.
Storyboard focused rerun at unchanged report HEAD 99a8446 passed (8 tests); the implementation
is byte-identical to b98cc27. Full verification was then started on that same checkout.
See VERIFICATION.md for the final or still-running status; do not equate started with passed.

Local audit and probes: `.hermes/review-20261029/gate-audit.json`, `probes.json`.
The probes generated only a private temporary fixture; its path is in probes.json. No personal
media, GUI, clipboard, Trash, global configuration or dependencies were accessed/changed.
The prohibited uncertified fixture was not read/copied/hashed/executed.

## Reproducing the independent findings

The checked-in reproduction uses actual public interfaces from the three named worktrees.
Keep those worktrees at the reviewed SHAs when reproducing; inspect Git status/HEAD first.
It deliberately reports actual results rather than treating a successful script exit as a test PASS.

From main, using existing dependencies:

```sh
mkdir -p .hermes/review-20261029
node -e "require('esbuild').buildSync({entryPoints:['docs/refactor/reviews/2026-10-29/reproduce.ts'],outfile:'.hermes/review-20261029/probes.cjs',bundle:true,platform:'node',packages:'external'})"
node .hermes/review-20261029/probes.cjs > .hermes/review-20261029/probes.json
```

Do not run this during edits to the reviewed files. Integrate each failing scenario into the
owning lane's real regression suite; do not merely change this demonstration's expected output.

## Required corrections

### D1 — invalid command can throw instead of returning Result (P2)

`src/core/drawing/validation.ts:256`: `kind in editKeys` accepts inherited property names.
`applyImageEdit(validImage, {kind: 'constructor'})` throws
`TypeError: allowed.includes is not a function` at the key check rather than invalid-input.
Test constructor, toString and __proto__ plus an ordinary unknown kind. Accept only own supported
command keys; ensure failure leaves input unchanged. This violates the explicit runtime-input contract.

### D2 — no-op incorrectly fails at the maximum valid revision (P2)

`src/core/drawing/index.ts:86`: overflow refusal runs before no-op detection.
At Number.MAX_SAFE_INTEGER, setting the existing name returns invalid-input although no increment
is needed. Move-to-current, same asset and empty patch need the same treatment. Reject a genuine
change requiring overflow; preserve no-op semantics and return the same before/after.

### P1 — reused asset dimensions bypass validation (P1)

`electron/core/persistence/assets.ts:121`: the existing-blob branch verifies digest then returns
before checking the current claim's dimensions. A 2×2 PNG is admitted normally at revision 0;
revision 1 changes both image and layer width to 3 while retaining that asset. Save returns success
and load returns width 3. The hash proves bytes are unchanged, not that the new descriptor is correct.

Every current reference must match decoded PNG dimensions, including reused files and multiple
references to the same asset. Retain the previous head on failure. Cache/deduplicate decoding within
one operation if useful, but do not silently drop this check. Cover a reused blob, two references
with differing sizes, and an already-present hash-named non-PNG blob in a fresh synthetic store.

### P2 — legal image ID can disappear with successful Save (P1)

`electron/core/persistence/validate.ts:196`: assigning `images['__proto__']` into `{}` changes the
object prototype instead of creating an own entry. The contract allows that ID. A retained image
with this ID disappears from the manifest; Save still returns ok and load omits it. This is silent
loss, not a rejected input. Active shots referencing it are rejected even though the ID is valid.

Use dictionary construction that preserves all allowed own keys. Test active and retained images
with __proto__, constructor and toString through save/load; compare exact own key sets and values.
Do not narrow the shared identifier contract independently to sidestep the case.

### P3 — persisted project can be rejected by the storyboard core (P2)

`electron/core/persistence/validate.ts:199`: existing image references are checked, but uniqueness
of editable image ownership across active+parked shots is not. Two distinct shots referencing `i`
are saved successfully. The identical project returns invalid-input in applyStoryboardEdit.
Reject shared image ownership before filesystem writes, as CONTRACTS.md requires; keep retained
unreferenced images legal. Add active-active and active-pending cases.

### S1 — Undo/Redo of pure reordering loses affected shot IDs (P2)

`src/core/storyboard/index.ts:209`: restored shotIds compare object content and membership but
not position. Move s after t, then Undo: order is true but shotIds is empty. The forward edit names
s. A caller using affected IDs receives no affected shots during history restoration.

Define one consistent semantic rule for affected IDs on ordering changes and use it for forward,
Undo and Redo. At minimum include the shots whose order changed; return IDs deterministically,
with no duplicates. Cover active and Pending reorder, crossing membership, and ordinary no-op.
A conservative superset is acceptable; this does not require changing the shared type.

## Additional integration notes — not scope expansion

- The storyboard grid/Japanese test currently compares two identical map expressions. It proves
  neither real view behavior nor independent projection equivalence; label it as core-only and
  leave actual two-view GUI verification to integration. Do not rewrite the GUI in this correction.
- Immutable version manifests are acceptable for this foundational wave; they are not persisted
  user Undo history or a storage growth solution.
- Hard-link-only publication is a documented filesystem constraint, not Windows/FAT/exFAT support.
  Keep the limitation explicit; no unreviewed fallback in these corrections.
- Directory fsync guarantees need closer review before crash-durability claims: assets are linked
  without an explicit assets-directory flush, while versions/head have flush calls. No power-loss
  or universal POSIX durability acceptance is granted by the current tests.
- Separate private validators disagree already (P3; persistence also adds size/text limits).
  Freeze shared admission semantics before UI integration. Avoid prematurely exporting a broad
  validator API or adding dependencies merely to remove textual duplication.
- New format/path naming stays unchanged while these correctness fixes land. Product branding
  remains Storyboard Flow. The coordinator will handle path naming in a separate reviewed change.
- Do not cherry-pick root QUESTIONS.md/DELIVERY.md from multiple branches onto one another.
  Archive lane reports separately; exclude briefing commits and keep main's original AGENTS/history.

## Correction handoff

Each lane: read this review and its own numbered items; write regressions that fail on the reviewed
candidate, make the smallest owned correction, commit locally, rerun focused/full/build on final
code, update DELIVERY.md with red/green raw logs and exact SHAs, then stop. No push, other-lane edits,
shared contract change, naming migration, production wiring or new dependencies.

Storyboard: do not modify the checkout while the coordinator's verification in VERIFICATION.md
is still running. After it settles, new code requires fresh final gates; the original candidate's
successful gates cannot certify corrected code. Completed background jobs do not need killing.
