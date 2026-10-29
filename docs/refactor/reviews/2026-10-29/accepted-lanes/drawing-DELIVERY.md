# Hermes delivery — drawing

Status: COMPLETE (correction round for review D1/D2 — see "Correction round" below; headless core only, GUI/Windows not claimed)

- Worktree / branch: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing` / `codex/hermes-drawing-wave1`
- Shared base / briefing commit: `c7630b3543bb6c7e7aa18bf9159aa97046a8970e` / `2d2f91a` (briefing)
- Review input: `docs/refactor/reviews/2026-10-29/REVIEW.md` (main checkout, read-only), items **D1** and **D2** only
- Tested implementation SHA: `8374441` (D1/D2 fix) — supersedes `ae766c7`, whose gates stay listed below as history
- Report HEAD (report-only commits after verification): `40da46a`, `e71e5c4`, `0c8a138` and the `DELIVERY.md`-only commit carrying this correction round
- Implementation commits to integrate (exclude briefing commit): `ae766c7` — "Add standalone image-document editing core (drawing wave 1)"; `71ac1c1` — "Add failing regressions for review items D1 and D2"; `8374441` — "Fix review items D1 and D2"

## Result

`src/core/drawing/index.ts` exports exactly one symbol:

```ts
applyImageEdit(image: ImageDocumentV1, edit: ImageEditV1): ResultV1<ImageEditResultV1>
```

It implements the CONTRACTS.md image-document Interface over the coordinator-owned types in
`electron/shared/refactorV1.ts` (imported, not copied): `insertLayer`, `removeLayer`, `moveLayer`,
`setLayer` (name/visible/locked/opacity/blendMode) and `replacePixels` (immutable asset reference).
Pure synchronous functions: no React, Electron, DOM, canvas, `sharp`, filesystem, timers, IPC or
storyboard project. `src/core/drawing/validation.ts` holds the private runtime validators; there is no
other seam and no undo stack (a test asserts the module's only export).

Callers today: **none.** The production app still uses the old drawing path —
`src/renderer/SketchPad.tsx`, `bitmapLayerCanvas.ts`, `bitmapLayerPaintingController.ts`,
`bitmapLayerActions.ts`, `src/shared/projectOps.ts`, `electron/main/bitmapLayers.ts` are untouched.
No brush engine, GUI, Save path, dependency or config was changed.

Owned files added: `src/core/drawing/{index.ts,validation.ts,index.test.ts,workload.test.ts,EXTRACTION.md}`,
`QUESTIONS.md`, `DELIVERY.md`.

Documented decisions worth review (detail and alternatives in `QUESTIONS.md`):
- locked layers refuse pixel replacement, removal *and* reordering, and refuse name/opacity/blend-mode
  patches with an explicit `locked` error (legacy silently dropped them) while visibility and the lock
  toggle stay editable;
- opacity out of `[0,1]`, unknown fields, unknown edit kinds and malformed asset ids are `invalid-input`
  rather than clamped or silently ignored;
- a changed edit returns a **fully cloned** document (no layer object shared with the input), so
  mutating the result cannot corrupt the caller's document; a no-op returns the supplied document as
  both `before` and `after`;
- array order is authoritative: no legacy `kind` sorting and no pinned matte/dialogue overlay layers.

`src/core/drawing/EXTRACTION.md` maps brush, eraser, fill, blur, selection transform, merge,
matte/dialogue overlay, compositing/rendering and layer-PNG persistence to proposed future owners, with
current entry points, DOM/React/filesystem dependencies, existing test coverage and the real-GUI check
each still needs. It states explicitly that nothing is extracted yet.

## Acceptance evidence

| TASK case | Test/scenario | Result | Raw evidence |
|---|---|---|---|
| Insert/remove/move preserve exact final ordering | `index.test.ts` "inserts at the bottom, middle and top…", "removes a layer from any position…", "moves a layer to the bottom, top and middle…" | PASS | focused log lines for `src/core/drawing/index.test.ts` (32 tests) |
| Last-layer removal fails | "fails removing the final layer with invalid-input, not not-found" (also for a single *locked* layer) | PASS (`invalid-input`) | same log |
| Name/lock-only edits change metadata without a visual claim | "renames without claiming a visual change…", "toggles the lock without claiming a visual change" | PASS (`changed:true`, `visualChanged:false`) | same log |
| Visibility/opacity/blend/pixel reference mark visual impact | "marks visibility, opacity and blend-mode changes as visual", "adopts a new asset reference and marks the image visual", mixed `{name,visible}` case | PASS (`visualChanged:true`) | same log |
| Values equal to current ones are no-ops | "treats identical values and empty patches as no-ops…" (7 patches incl. `{}`), "is a no-op when the layer already sits at the requested index", "is a no-op for the current asset" | PASS (`changed:false`, `after === before`, no revision bump) | same log |
| Locked pixel replacement/removal fails; visibility and lock toggle still work | "reports an unknown layer as not-found and a locked layer as locked", "refuses to reorder a locked layer…", "keeps a locked layer's name/opacity/blend mode while allowing visibility and unlock", "is a no-op for the current asset and a locked failure for a different one" | PASS (`locked`) | same log |
| Invalid IDs/indices/sizes/opacity/modes/duplicates/missing targets return explicit errors | "rejects duplicate ids, out-of-range indices, wrong sizes and malformed values", "rejects invalid opacity, modes, field names and unknown layers", "rejects malformed asset references", "rejects malformed documents with invalid-input", "rejects unknown edit kinds and extra edit fields" | PASS (`invalid-input`/`not-found`) | same log |
| Runtime validation, not only TypeScript types | every rejection above passes untyped values through `asEdit`/`asImage` casts; `null`, `[]`, `1.5`, `NaN`, `Infinity`, `-1`, `"bad id!"`, 63/65-char and uppercase asset ids, `layers: "not-an-array"` | PASS | same log |
| `before`/input unchanged; unrelated properties preserved | "returns the supplied document as before and leaves the input deeply unchanged" (5 edit kinds, JSON snapshot compare per edit), "works on a deep-frozen document" (all five kinds on `Object.freeze`d input) | PASS | same log |
| Mutating the returned structure cannot mutate the input | "isolates the result from the input…": every layer object and the array are distinct, then `after.layers[0].name`, `assetId`, `push`, `revision`, `width` are mutated and the input is re-compared | PASS | same log |
| Every actual edit increments the revision once; no-op/failure does not | "counts revisions exactly once per successful edit across a mixed sequence" (10 edits: 5 changes, 3 no-ops, 2 failures — `not-found` and `locked`) | PASS | same log |
| Undo restores exact prior metadata and asset references from `before`; no hidden undo stack | "offers no hidden undo stack: the caller restores by reinstalling result.before" (walks the `before` chain `after`→`before`→original) and "exports only applyImageEdit" | PASS | same log |
| Repeated operations on 5- and 100-layer images, workload recorded | `workload.test.ts`: 2000 sequences × 6 edits per size, invariants checked every iteration | PASS | see Performance below |
| EXTRACTION.md is concrete | reviewed file; every row names a real entry point, its dependencies, existing tests (all 16 cited legacy test files verified to exist on disk) and the remaining GUI check | delivered | `src/core/drawing/EXTRACTION.md` |

## Correction round — review 2026-10-29 (items D1, D2)

Both items are in this lane's owned files; P1/P2/P3 (persistence) and S1 (storyboard) are not mine and
were not touched. No naming, shared-contract, dependency or production-wiring change was made.

**D1 — invalid command could throw instead of returning `Result`.** `validateEdit` accepted a command
name via `kind in editKeys`, which is true for inherited `Object` names (`constructor`, `toString`,
`valueOf`, `__proto__`). Their values are not key lists, so the next step threw
`TypeError: allowed.includes is not a function` instead of returning `invalid-input`.
Fix: own-key check (`Object.hasOwn`) in `src/core/drawing/validation.ts`; unsupported commands — inherited
or ordinary (`deleteImage`) — now return `invalid-input` and leave the input document unchanged.

**D2 — no-op failed at the maximum valid revision.** The revision-overflow refusal ran at the top of
`applyImageEdit`, before any edit was analysed, so at `Number.MAX_SAFE_INTEGER` a name equal to the
current one, an empty patch, a move to the current index or the current `assetId` were all refused as
`invalid-input` although no increment was needed. Fix: the refusal moved into the private `commitEdit`
helper that only runs for an actual change (`src/core/drawing/index.ts`). No-ops at the maximum revision
return `changed:false` with the same `before`/`after`; a genuine change that would overflow still returns
`invalid-input` and applies nothing.

Red evidence (regressions committed first, at `71ac1c1`, on the reviewed candidate code):

```sh
node ./node_modules/vitest/vitest.mjs run src/core/drawing/index.test.ts   # exit 1
# Test Files  1 failed (1) · Tests  3 failed | 33 passed (36)
#   D1 > returns invalid-input for inherited Object property names .... TypeError: allowed.includes is not a function
#   D1 > does not throw when the inherited value is not a key list .... TypeError: allowed.includes is not a function
#   D2 > accepts every no-op at the maximum revision .................. invalid-input: image.revision cannot advance beyond Number.MAX_SAFE_INTEGER
```

Raw log (kept outside the checkout, per TESTING.md §2 — failed-test evidence must not live in the
worktree): `/Users/xiali/.hermes/cache/scratch/drawing-wave1-red-71ac1c1/red-index.log` (vitest exit 1,
282 ms). The failing tests are reproducible at `71ac1c1` with the command above; the reviewed candidate
`0c8a138`/`ae766c7` has identical implementation code.

A scripted `hermes-verify.py focused --lane drawing` red run was attempted first but returned **exit 75**
(shared slot held by `codex/hermes-persistence-wave1`, phase `full`); the lock was not touched and the
red run was recorded as the direct Vitest log above instead. The green gates were run once the slot
released; history below.

Green evidence on the corrected code (`8374441`): focused 37/37 tests, full suite and build rows in the
Verification table below.

## Verification

All commands run through `scripts/hermes-verify.py --lane drawing` from the worktree root, with
`/opt/homebrew/bin` first on PATH (Node v25.9.0, npm 11.12.1) on macOS 26.6.2 / Apple M1 Max, 10 cores.

| Command | Tested SHA | Exit | Counts / duration | Log / receipt |
|---|---|---|---|---|
| `focused` baseline before any of my code existed | `2d2f91a` | 1 | `No test files found` — expected, **not** a PASS (TESTING.md §1) | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T110434.413661Z-focused/` |
| `focused --lane drawing` | `ae766c7` | 0 | 2 files / 33 tests passed, 1.23 s test time (runner 1.907 s) | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T110844.945535Z-focused/` |
| `full --lane drawing` | `ae766c7` | 0 | 361 files / 2619 tests passed, 0 failed, 0 skipped, 1309.49 s | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T110903.219825Z-full/` |
| `build --lane drawing` | `ae766c7` | 0 | `tsc --noEmit` + `tsc -p tsconfig.electron.json --noEmit` clean; vite 2021 modules / 947.67 kB in 1.99 s; `build:electron` clean; 10.496 s total | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T110849.085295Z-build/` |
| `git diff --check` | `ae766c7` (and after the report commits) | 0 | no whitespace errors | this report |
| `focused` re-run at report HEAD | `e71e5c4` | 0 | 2 files / 33 tests passed, 1.17 s (first attempt returned **exit 75**: the shared slot was held by `codex/hermes-persistence-wave1`, phase `full`, owner `pid 940`; the lock was left untouched and the run was retried after it released) | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T115233.884535Z-focused/` |
| **correction round:** `focused --lane drawing` | `8374441` | 0 | 2 files / 37 tests passed (32→36 in `index.test.ts` plus 1 workload), 1.24 s | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T133621.022176Z-focused/` |
| **correction round:** `full --lane drawing` | `8374441` | 0 | 361 files / 2623 tests passed (2619 + 4 new), 0 failed, 0 skipped, 1153.71 s | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T133626.639455Z-full/` |
| **correction round:** `build --lane drawing` | `8374441` | 0 | both typechecks clean; vite 2021 modules / 947.67 kB in 1.84 s; `build:electron` clean; 9.103 s total | `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers/.worktrees/hermes-drawing/.hermes/evidence/20261029T135616.883850Z-build/` |
| **correction round:** `git diff --check` | `8374441` + report commit | 0 | no whitespace errors | this report |

Each evidence directory holds `output.log` (raw stdout/stderr) and `receipt.json` (branch, HEAD,
`statusBefore`/`statusAfter`, command, child pid, exit code, duration, temp root). In the original
round, receipts show an empty `git status --short` before and after both the full run and the build
run: the suite left no files in the checkout. In the correction round, `focused` and `build` also show
an empty status before and after; the correction-round **full** receipt shows `statusBefore` empty and
`statusAfter: "M DELIVERY.md"` because this report was being written while that run executed — no
source file changed during it (the implementation was already committed at `8374441`, and the only
modified path afterwards is `DELIVERY.md`).

Development-run failures (kept for honesty, not preserved as files — the D1/D2 red run above is the
exception, its log is kept outside the checkout): three intermediate focused runs
failed while the tests were being authored — (1) a no-op patch was applied to a layer whose current
opacity was 0.5, (2) a mixed-sequence test expected only `not-found` but a `locked` failure also occurs,
(3) two workload expectations were miscomputed (`changes` is 5 per sequence, and the ordering invariant
was asserted inside the insert/remove window). Each was a defect in the test, corrected in the test,
not in the implementation; the runs were direct `node ./node_modules/vitest/vitest.mjs run
src/core/drawing` invocations and are not in `.hermes/evidence`. The first scripted focused run
(`20261029T110844…`) is the first green run.

Performance (metadata operations only — **not** brush, canvas, rendering or GUI performance):

| Workload | Edits | Real changes | Total | Per edit | Slowest single edit |
|---|---|---|---|---|---|
| 5 layers, 2000 sequences (insert, set, no-op set, move, replacePixels, remove) | 12,000 | 10,000 | 139.5 ms | 12 µs | 445 µs |
| 100 layers, same sequence | 12,000 | 10,000 | 502.8 ms | 42 µs | 173 µs |

Numbers above are from the correction-round full run at `8374441` (`20261029T133626…-full`); the earlier
run at `ae766c7` measured 158.6 ms / 572.2 ms on the same machine. Measured inside `workload.test.ts`
with `performance.now()`; the test asserts a
loose 20,000 ms ceiling so a slow box cannot turn this into a flaky failure, and prints the numbers
into the raw log. Per-edit cost is dominated by the intentional O(layers) clone that provides mutation
isolation; single-edit outliers (hundreds of µs to a few ms) are JIT/allocation noise, not a trend.

## Integration notes

- **Dependency changes:** none. No npm install, no config change, no new package.
- **Review correction (D1/D2):** two P2 findings fixed in the owned files only, with regressions committed
  red first (`71ac1c1`) and green second (`8374441`). No naming change, no shared-contract edit, no new
  export, no production wiring. The review's P1/P2/P3 (persistence) and S1 (storyboard) items belong to
  other lanes and were not touched.
- **Contract questions:** `QUESTIONS.md` lists 10 items, each with the implemented default and impact.
  The ones that matter before wiring call sites: Q6 (kind/overlay pinning is dropped — confirm), Q7
  (`activeLayerId` has no home in `ImageDocumentV1`, so UI selection needs an owner), Q8 (whether
  `validateImageDocument` should become a shared export for the storyboard lane instead of being
  duplicated). None of them blocked this wave.
- **Not implemented by design:** no PSD integration, no raster/tile work, no Rust, no canvas
  replacement, no production wiring, no reference-counted asset deletion.
- **Limitations / missing evidence:** this is headless evidence only. Unit tests here do not prove
  GUI behavior, brush feel, the real Save chain, macOS filesystem semantics or Windows behavior; none
  of that was claimed. The workload numbers are synthetic metadata operations, not drawing
  responsiveness. `EXTRACTION.md` is a map, not a claim that brush/eraser/blur/selection/merge/overlay
  behavior has been extracted.
- **Process hygiene:** no application launch, no smoke script, no GUI automation, no personal media or
  userData access; `src/renderer/normalSaveMetadataHistory.test.ts` was never read, copied or run, and
  the existing Vitest exclusions are unchanged. Temporary verification roots were created by the
  runner under its own `TMPDIR` and no test artifact was left in the checkout.
- **Next integration work:** (1) decide Q6/Q7/Q8; (2) give drawing a pixel asset sink so
  `replacePixels` can adopt freshly encoded PNG bytes; (3) route `LayerPanel`/`ShotCard` metadata
  actions through `applyImageEdit` via a project-level facade; (4) then move brush → eraser → fill →
  blur → selection transform behind the boundary, one tool at a time, with a real-GUI check each.
